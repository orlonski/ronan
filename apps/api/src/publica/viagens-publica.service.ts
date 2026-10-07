import { Injectable, Logger } from "@nestjs/common";
import { AcaoAuditoria, MotivoDivergencia, Prisma, StatusViagem } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { PrecificacaoService } from "../admin/tabelas-preco/precificacao.service";
import { ProgramacaoService } from "../admin/pedidos/programacao.service";
import { ConferenciaFilaService } from "../conferencia-ticket/conferencia-fila.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { Divergencias } from "../common/divergencias";
import { resolverModoServico, carimbarFaltasDoModo } from "../common/tipo-servico";
import { resolverTransportadora } from "../common/transportadora";
import { carimbosDaDispensa, dispensaConferencia } from "../common/conferencia-dispensada";
import { ehRecenteParaProgramacao, POLITICA_DA_ORIGEM, type CampoDaIntegracao } from "../common/viagem-origem";
import { ymdSaoPaulo } from "../common/timezone";
import { comoSistema, contaIdAtual } from "../common/conta/conta-context";
import type { AuthIntegracao } from "./integracao.guard";
import { ErroPublico, type DetalheErro } from "./erros";
import type { z } from "zod";
import type { AlteracoesQuery, AlteracoesV1, AtualizarViagemV1, CriarViagemV1, ListarViagensQuery, ListaViagensV1, ViagemV1 } from "./contrato";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import { aplicarMinimos, resolverRegraMinimo } from "../common/viagem-minimos";
import { externosPorIds, idPorExterno, travarNumero, vincular } from "./vinculos";

type Aviso = { codigo: string; mensagem: string };
export type RespostaGravar = { status: 200 | 201; corpo: { criada: boolean; viagem: ViagemV1; avisos: Aviso[] } };

const IDEMPOTENCIA_HORAS = 24;

/** Os status que uma pessoa (ou a regra que dispensa) já decidiu: a integração não mexe mais. */
const DECIDIDOS: ReadonlySet<StatusViagem> = new Set([
  StatusViagem.OK,
  StatusViagem.AJUSTADA,
  StatusViagem.DIVERGENTE,
]);

const VIAGEM_SELECT = {
  id: true,
  clientId: true,
  origemIntegracaoId: true,
  status: true,
  data: true,
  toneladas: true,
  km: true,
  kmOrigem: true,
  kmMotorista: true,
  ticket: true,
  revisadoEm: true,
  revisadoPorId: true,
  conferidoPorIaEm: true,
  conferenciaDispensadaEm: true,
  sincronizadoEm: true,
  alteradoEm: true,
  motorista: { select: { id: true, nome: true } },
  veiculo: { select: { id: true, placa: true } },
  localCarga: { select: { id: true, nome: true } },
  localDescarga: { select: { id: true, nome: true } },
  material: { select: { id: true, nome: true } },
  cliente: { select: { id: true, nome: true, empresaId: true } },
  valor: { select: { valorFrete: true, valorPedagio: true, valorTotal: true } },
  divergencias: { where: { resolvidoEm: null }, select: { motivo: true, detalhe: true } },
} satisfies Prisma.ViagemSelect;
type ViagemLida = Prisma.ViagemGetPayload<{ select: typeof VIAGEM_SELECT }>;

/** O que a viagem vira no banco, já resolvido (ids nossos, divergências, status). */
type Resolvido = {
  campos: Record<CampoDaIntegracao, unknown>;
  divs: Divergencias;
  avisos: Aviso[];
  statusBase: StatusViagem;
  tipoServicoId: string | null;
  dispensada: boolean;
  duplicadoDeId: string | null;
};

/**
 * A porta da viagem que vem do sistema de outra empresa.
 *
 * Mesmas regras de negócio de quem entra pelo app — pendência em vez de
 * recusa, sem peso é AGUARDANDO_PESO (nunca 0 t), dispensa de conferência
 * pelo material, preço da NOSSA tabela — com os efeitos da linha INTEGRACAO
 * de `common/viagem-origem.ts`: ninguém é avisado no celular, o robô de km não
 * troca o km dela, programação só casa com viagem recente.
 *
 * O caminho do app NÃO passa por aqui e não mudou: ele é o outbox do
 * motorista, onde trocar um `void` por `await` derruba lançamento.
 */
@Injectable()
export class ViagensPublicaService {
  private readonly log = new Logger(ViagensPublicaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly precificacao: PrecificacaoService,
    private readonly programacao: ProgramacaoService,
    private readonly conferencia: ConferenciaFilaService,
    private readonly roteamento: RoteamentoService,
  ) {}

  // ------------------------------------------------------------ entrada --

  /** POST /v1/viagens. */
  async criar(integ: AuthIntegracao, corpo: CriarViagemV1, chaveIdem: string | undefined): Promise<RespostaGravar> {
    if (!corpo.externo && !chaveIdem) throw new ErroPublico("IDENTIFICACAO_OBRIGATORIA");
    const { externo, ...resto } = corpo;
    return this.comIdempotencia(integ, chaveIdem, corpo, () => this.gravar(integ, externo ?? null, resto));
  }

  /** PUT /v1/viagens/externo/{idExterno}: cria ou atualiza pelo número de vocês. */
  async gravarPorExterno(
    integ: AuthIntegracao,
    idExterno: string,
    corpo: AtualizarViagemV1,
    chaveIdem: string | undefined,
  ): Promise<RespostaGravar> {
    return this.comIdempotencia(integ, chaveIdem, { idExterno, corpo }, () => this.gravar(integ, idExterno, corpo));
  }

  private async gravar(integ: AuthIntegracao, idExterno: string | null, corpo: AtualizarViagemV1): Promise<RespostaGravar> {
    const resolvido = await this.resolver(integ, corpo);
    const contaId = contaIdAtual();

    const { viagemId, criada, mudouKm } = await this.prisma.$transaction(async (tx) => {
      // Marca a transação: o gatilho anota que foi ESTA integração, e o aviso
      // não volta pra ela. `true` = só nesta transação (não gruda na conexão).
      await tx.$executeRaw`SELECT set_config('movatruck.integracao', ${integ.integracaoId}, true)`;
      if (idExterno) {
        await travarNumero(tx, contaId, integ.sistema, "viagem", idExterno);
        const existente = await idPorExterno(tx, integ.sistema, "viagem", idExterno);
        if (existente) {
          const r = await this.atualizarDentro(tx, integ, existente, resolvido);
          return { viagemId: existente, criada: false, mudouKm: r.mudouKm };
        }
      }
      const id = await this.criarDentro(tx, integ, resolvido);
      if (idExterno) {
        await vincular(tx, { sistema: integ.sistema, entidade: "viagem", entidadeId: id, idExterno, integracaoId: integ.integracaoId });
      }
      return { viagemId: id, criada: true, mudouKm: false };
    });

    await this.auditoria.log({
      entidade: "Viagem",
      entidadeId: viagemId,
      acao: criada ? AcaoAuditoria.INTEGRACAO_CRIOU : AcaoAuditoria.INTEGRACAO_ALTEROU,
      integracaoId: integ.integracaoId,
      metadata: { integracao: integ.nome, sistema: integ.sistema, idExterno, avisos: resolvido.avisos.map((a) => a.codigo) },
    });
    if (mudouKm) {
      await this.auditoria.log({
        entidade: "Viagem",
        entidadeId: viagemId,
        acao: AcaoAuditoria.INTEGRACAO_ALTEROU_KM,
        campo: "km",
        valorDepois: resolvido.campos.km ?? null,
        integracaoId: integ.integracaoId,
        metadata: { integracao: integ.nome },
      });
    }

    this.dispararEfeitos(viagemId, criada, resolvido);

    const viagem = await this.ler(integ, viagemId);
    if (!viagem) throw new ErroPublico("ERRO_INTERNO");
    return { status: criada ? 201 : 200, corpo: { criada, viagem, avisos: resolvido.avisos } };
  }

  /**
   * Traduz o corpo pros ids nossos. Motorista e caminhão são obrigatórios
   * (a viagem não existe sem eles: 422). O resto que não for achado entra
   * como pendência + aviso — a viagem nunca é recusada por isso.
   */
  private async resolver(integ: AuthIntegracao, c: AtualizarViagemV1): Promise<Resolvido> {
    const divs = new Divergencias();
    const avisos: Aviso[] = [];
    const faltando: DetalheErro[] = [];

    const motoristaId = await this.acharMotorista(integ, c.motorista);
    if (!motoristaId) faltando.push({ campo: "motorista", codigo: "nao_encontrado", mensagem: "Motorista não encontrado nesta empresa." });
    const veiculoId = await this.acharVeiculo(integ, c.veiculo);
    if (!veiculoId) faltando.push({ campo: "veiculo", codigo: "nao_encontrado", mensagem: "Caminhão não encontrado nesta empresa." });
    if (faltando.length) throw new ErroPublico("REFERENCIA_OBRIGATORIA", undefined, faltando);

    const localCargaId = c.localCarga ? await this.acharLocal(integ, c.localCarga) : null;
    if (c.localCarga && !localCargaId) {
      avisos.push({ codigo: "LOCAL_CARGA_NAO_ACHADO", mensagem: "Local de carga não encontrado; a viagem entrou sem ele." });
    }
    const localDescargaId = c.localDescarga ? await this.acharLocal(integ, c.localDescarga) : null;
    if (c.localDescarga && !localDescargaId) {
      divs.add(MotivoDivergencia.FALTA_LOCAL_DESCARGA, undefined, `O sistema ${integ.nome} mandou um local de descarga que não existe aqui.`);
      avisos.push({ codigo: "LOCAL_DESCARGA_NAO_ACHADO", mensagem: "Local de descarga não encontrado; a viagem ficou com pendência." });
    }

    const materiais = c.material
      ? await this.prisma.material.findMany({
          where: c.material.id ? { id: c.material.id } : { nome: { equals: c.material.nome!, mode: "insensitive" } },
          select: { id: true, nome: true, exigeTicket: true, dispensaConferencia: true },
          take: 2,
        })
      : [];
    const material = materiais.length === 1 ? materiais[0]! : null;
    if (c.material && !material) {
      divs.add(MotivoDivergencia.FALTA_MATERIAL, undefined, `O sistema ${integ.nome} mandou o material "${c.material.nome ?? c.material.id}", que não existe no cadastro.`);
      avisos.push({ codigo: "MATERIAL_NAO_ACHADO", mensagem: "Material não encontrado; a viagem ficou com pendência." });
    }

    const obras = c.obra
      ? await this.prisma.cliente.findMany({
          where: c.obra.id ? { id: c.obra.id } : { nome: { equals: c.obra.nome!, mode: "insensitive" } },
          select: { id: true, empresaId: true },
          take: 2,
        })
      : [];
    // Nome que casa com duas obras: escolher uma seria o sistema afirmando o
    // que não sabe. Fica pendente pra uma pessoa decidir.
    const obra = obras.length === 1 ? obras[0]! : null;
    if (!obra) {
      const detalhe = c.obra
        ? obras.length > 1
          ? `O sistema ${integ.nome} mandou a obra "${c.obra.nome}", e há mais de uma com esse nome.`
          : `O sistema ${integ.nome} mandou a obra "${c.obra.nome ?? c.obra.id}", que não existe no cadastro.`
        : undefined;
      divs.add(MotivoDivergencia.FALTA_CLIENTE, undefined, detalhe);
      if (c.obra) avisos.push({ codigo: obras.length > 1 ? "OBRA_AMBIGUA" : "OBRA_NAO_ACHADA", mensagem: detalhe! });
    }

    const modo = await resolverModoServico(this.prisma, null, divs);
    const aguardandoPeso = c.toneladas == null;
    carimbarFaltasDoModo(
      divs,
      { aguardandoPeso, toneladas: c.toneladas ?? null, materialId: material?.id ?? null, km: c.km ?? null, localDescargaId },
      modo,
    );

    // Ticket: a mesma régua do app. Número repetido não recusa, só aponta.
    const ticket = c.ticket ?? null;
    if (!aguardandoPeso && !ticket && modo.exigeTicket && material?.exigeTicket !== false) {
      divs.add(MotivoDivergencia.FALTA_TICKET);
    }
    const duplicado =
      ticket && obra
        ? await this.prisma.viagem.findFirst({
            where: { ticket, cliente: { empresaId: obra.empresaId } },
            orderBy: { sincronizadoEm: "asc" },
            select: { id: true },
          })
        : null;
    if (duplicado) avisos.push({ codigo: "TICKET_REPETIDO", mensagem: "Já existe viagem com este ticket pro mesmo cliente; ficou sinalizada pra conferência." });

    const statusBase = divs.statusFinal(aguardandoPeso ? StatusViagem.AGUARDANDO_PESO : StatusViagem.ENVIADA);
    return {
      campos: {
        data: new Date(`${c.data}T00:00:00Z`),
        motoristaId,
        veiculoId,
        localCargaId,
        localDescargaId,
        materialId: material?.id ?? null,
        clienteId: obra?.id ?? null,
        toneladas: c.toneladas ?? null,
        km: c.km ?? null,
        ticket,
        observacao: c.observacao ?? null,
      },
      divs,
      avisos,
      statusBase,
      tipoServicoId: modo.id,
      dispensada: dispensaConferencia({ materialDispensa: material?.dispensaConferencia, statusDesejado: statusBase }),
      duplicadoDeId: duplicado?.id ?? null,
    };
  }

  private async criarDentro(tx: Prisma.TransactionClient, integ: AuthIntegracao, r: Resolvido): Promise<string> {
    const c = r.campos;
    const transportadoraId = await resolverTransportadora(tx, c.motoristaId as string, c.veiculoId as string);
    const viagem = await tx.viagem.create({
      data: {
        // Gerado por nós e aleatório: derivar do número externo colidiria no
        // dia em que alguém trocasse o vínculo no painel, e o `clientId` é
        // único no sistema todo (não pode virar oráculo entre empresas).
        clientId: `api:${randomUUID()}`,
        origemIntegracaoId: integ.integracaoId,
        motoristaId: c.motoristaId as string,
        veiculoId: c.veiculoId as string,
        transportadoraId,
        clienteId: c.clienteId as string | null,
        materialId: c.materialId as string | null,
        tipoServicoId: r.tipoServicoId,
        localCargaId: c.localCargaId as string | null,
        localDescargaId: c.localDescargaId as string | null,
        data: c.data as Date,
        toneladas: c.toneladas as number | null,
        // O km do sistema de fora vai pro faturado e fica guardado como veio.
        // NUNCA em `kmMotorista`: esse é só do que o motorista digitou no app.
        km: c.km as number | null,
        kmOrigem: c.km as number | null,
        ticket: c.ticket as string | null,
        ticketDuplicadoDeId: r.duplicadoDeId,
        observacao: c.observacao as string | null,
        ...(r.dispensada ? carimbosDaDispensa(new Date()) : { status: r.statusBase }),
        ...(r.divs.paraCreateAninhado() ? { divergencias: r.divs.paraCreateAninhado() } : {}),
      },
      select: { id: true },
    });
    return viagem.id;
  }

  /**
   * Atualiza uma viagem que ESTA integração (ou outra com o mesmo sistema, o
   * caso de quem trocou de chave) criou. Viagem do app ou do painel: só leitura.
   * Já conferida, em fechamento ou em acerto: travada. Campo que uma pessoa
   * corrigiu no painel: fica como a pessoa deixou, e a resposta avisa.
   */
  private async atualizarDentro(
    tx: Prisma.TransactionClient,
    integ: AuthIntegracao,
    viagemId: string,
    r: Resolvido,
  ): Promise<{ mudouKm: boolean }> {
    const v = await tx.viagem.findUnique({
      where: { id: viagemId },
      select: {
        status: true,
        revisadoEm: true,
        km: true,
        kmAlteradoEm: true,
        camposTravados: true,
        origemIntegracao: { select: { sistema: true } },
        _count: { select: { matchesFechamento: true } },
        itensAcerto: { where: { acerto: { status: { in: ["FECHADO", "PAGO"] } } }, select: { id: true }, take: 1 },
      },
    });
    if (!v) throw new ErroPublico("NAO_ENCONTRADO");
    if (v.origemIntegracao?.sistema !== integ.sistema) throw new ErroPublico("VIAGEM_DE_OUTRA_ORIGEM");
    if (v.revisadoEm || DECIDIDOS.has(v.status) || v._count.matchesFechamento > 0 || v.itensAcerto.length > 0) {
      throw new ErroPublico("VIAGEM_TRAVADA");
    }

    const data: Prisma.ViagemUncheckedUpdateInput = {};
    const travados = new Set(v.camposTravados);
    for (const [campo, valor] of Object.entries(r.campos) as [CampoDaIntegracao, unknown][]) {
      if (travados.has(campo)) continue;
      // km corrigido por gente no painel (com motivo) também não volta.
      if (campo === "km" && v.kmAlteradoEm) continue;
      (data as Record<string, unknown>)[campo] = valor;
    }
    const pulados = [...travados].filter((c) => c in r.campos);
    if (v.kmAlteradoEm && !travados.has("km")) pulados.push("km");
    if (pulados.length) {
      r.avisos.push({
        codigo: "CAMPO_PROTEGIDO",
        mensagem: `Não alterado porque uma pessoa corrigiu no painel: ${pulados.join(", ")}.`,
      });
    }
    if ("km" in data) data.kmOrigem = r.campos.km as number | null;

    data.ticketDuplicadoDeId = r.duplicadoDeId;
    if (r.dispensada) Object.assign(data, carimbosDaDispensa(new Date()));
    else data.status = r.statusBase;

    // As pendências passam a ser as deste envio: a que o reenvio resolveu some,
    // a nova aparece. Só as abertas — o que uma pessoa já resolveu fica.
    await tx.viagemDivergencia.deleteMany({ where: { viagemId, resolvidoEm: null } });
    const novas = r.divs.paraCreateAninhado();
    if (novas) await tx.viagemDivergencia.createMany({ data: novas.create.map((d) => ({ ...d, viagemId })) });

    await tx.viagem.update({ where: { id: viagemId }, data });
    const kmAntes = v.km?.toString() ?? null;
    const kmDepois = "km" in data && data.km != null ? Number(data.km).toFixed(2) : kmAntes;
    return { mudouKm: "km" in data && kmAntes !== kmDepois };
  }

  /** Os efeitos da linha INTEGRACAO. Best-effort: a viagem já está gravada. */
  private dispararEfeitos(viagemId: string, criada: boolean, r: Resolvido): void {
    const efeitos = POLITICA_DA_ORIGEM.INTEGRACAO;
    if (efeitos.precificar) void this.precificacao.recalcularSeguro(viagemId).catch(() => {});
    if (efeitos.conferirTicketComIa) void this.conferencia.enfileirar(viagemId, criada ? "create" : "correcao-motorista");
    if (efeitos.calcularRota && r.campos.localCargaId && r.campos.localDescargaId) {
      void this.roteamento
        .calcularKm(r.campos.localCargaId as string, r.campos.localDescargaId as string)
        .catch(() => {});
    }
    if (criada && efeitos.casarProgramacao !== "nunca") {
      const [y, m, d] = ymdSaoPaulo();
      const hoje = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dia = (r.campos.data as Date).toISOString().slice(0, 10);
      if (efeitos.casarProgramacao === "sempre" || ehRecenteParaProgramacao(dia, hoje)) {
        void this.programacao.casarComViagem(viagemId).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------- referências --

  private async acharMotorista(integ: AuthIntegracao, ref: CriarViagemV1["motorista"]): Promise<string | null> {
    if (ref.id) return (await this.prisma.motorista.findUnique({ where: { id: ref.id }, select: { id: true } }))?.id ?? null;
    if (ref.externo) return idPorExterno(this.prisma, integ.sistema, "motorista", ref.externo!);
    // CPF só DENTRO da empresa. O cadastro global de pessoas (identidade) nunca
    // é consultado pela API: "esse CPF existe em algum lugar" seria oráculo.
    return (await this.prisma.motorista.findFirst({ where: { cpf: ref.cpf as string }, select: { id: true } }))?.id ?? null;
  }

  private async acharVeiculo(integ: AuthIntegracao, ref: CriarViagemV1["veiculo"]): Promise<string | null> {
    if (ref.id) return (await this.prisma.veiculo.findUnique({ where: { id: ref.id }, select: { id: true } }))?.id ?? null;
    if (ref.externo) return idPorExterno(this.prisma, integ.sistema, "veiculo", ref.externo!);
    return (await this.prisma.veiculo.findFirst({ where: { placa: ref.placa as string }, select: { id: true } }))?.id ?? null;
  }

  /** Sem "recriar com o mesmo id" (o socorro do app offline): id que não existe é só não-achado. */
  private async acharLocal(integ: AuthIntegracao, ref: { id?: string; externo?: string }): Promise<string | null> {
    if (ref.id) return (await this.prisma.local.findUnique({ where: { id: ref.id }, select: { id: true } }))?.id ?? null;
    return idPorExterno(this.prisma, integ.sistema, "local", ref.externo!);
  }

  // -------------------------------------------------------------- leitura --

  async lerPorId(integ: AuthIntegracao, id: string): Promise<ViagemV1> {
    const v = await this.ler(integ, id);
    if (!v) throw new ErroPublico("NAO_ENCONTRADO");
    return v;
  }

  async lerPorExterno(integ: AuthIntegracao, idExterno: string): Promise<ViagemV1> {
    const id = await idPorExterno(this.prisma, integ.sistema, "viagem", idExterno);
    if (!id) throw new ErroPublico("NAO_ENCONTRADO");
    return this.lerPorId(integ, id);
  }

  /**
   * Lista paginada por cursor (alteradoEm, id). Por padrão SEM as viagens que
   * ainda não podem ser faturadas (STATUS_FORA_FECHAMENTO, a mesma régua do
   * fechamento): um ERP que somasse a lista padrão faturaria 0 t.
   */
  async listar(integ: AuthIntegracao, q: z.infer<typeof ListarViagensQuery>): Promise<z.infer<typeof ListaViagensV1>> {
    const limite = q.limite ?? 50;
    const where: Prisma.ViagemWhereInput[] = [];
    if (q.incluirIncompletas !== "true") where.push({ status: { notIn: STATUS_FORA_FECHAMENTO } });
    if (q.dataDe) where.push({ data: { gte: new Date(`${q.dataDe}T00:00:00Z`) } });
    if (q.dataAte) where.push({ data: { lte: new Date(`${q.dataAte}T00:00:00Z`) } });
    if (q.motorista) where.push({ motoristaId: q.motorista });
    if (q.placa) where.push({ veiculo: { placa: q.placa } });
    if (q.situacao) where.push({ status: { in: STATUS_DA_SITUACAO[q.situacao] } });
    if (q.cursor) {
      const c = lerCursorLista(q.cursor);
      where.push({ OR: [{ alteradoEm: { gt: c.em } }, { alteradoEm: c.em, id: { gt: c.id } }] });
    }
    const linhas = await this.prisma.viagem.findMany({
      where: { AND: where },
      orderBy: [{ alteradoEm: "asc" }, { id: "asc" }],
      take: limite + 1,
      select: VIAGEM_SELECT,
    });
    const temMais = linhas.length > limite;
    const pagina = linhas.slice(0, limite);
    const ultima = pagina[pagina.length - 1];
    return {
      dados: await this.serializar(integ, pagina),
      proximoCursor: temMais && ultima ? cursorLista(ultima.alteradoEm, ultima.id) : null,
    };
  }

  /**
   * "O que mudou desde": o registro que o gatilho do banco escreve, na ordem
   * em que o robô numerou. Inclui exclusão (que a lista não tem como mostrar)
   * e mudança feita por robô, IA ou conferente.
   */
  async alteracoes(integ: AuthIntegracao, q: z.infer<typeof AlteracoesQuery>): Promise<z.infer<typeof AlteracoesV1>> {
    const limite = q.limite ?? 50;
    const config = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({
        where: { id: "singleton" },
        select: { registroAlteracoesOrdemMinima: true, registroAlteracoesDesligadoEm: true },
      }),
    );
    const geracao = config?.registroAlteracoesOrdemMinima?.toString() ?? "0";
    let desde = 0n;
    if (q.cursor) {
      const c = lerCursorAlteracoes(q.cursor);
      // Cursor de antes de uma pausa do registro: o que mudou durante a pausa
      // não existe aqui, e seguir dali seria mentir por omissão.
      if (c.geracao !== geracao && config?.registroAlteracoesOrdemMinima != null && c.ordem <= config.registroAlteracoesOrdemMinima) {
        throw new ErroPublico("CURSOR_EXPIRADO");
      }
      // Cursor mais velho que o que guardamos (30 dias).
      const maisVelha = await comoSistema(() =>
        this.prisma.registroAlteracao.findFirst({ where: { ordem: { not: null } }, orderBy: { ordem: "asc" }, select: { ordem: true } }),
      );
      if (maisVelha?.ordem != null && c.ordem < maisVelha.ordem - 1n) throw new ErroPublico("CURSOR_EXPIRADO");
      desde = c.ordem;
    }
    const linhas = await this.prisma.registroAlteracao.findMany({
      where: { ordem: { gt: desde } },
      orderBy: { ordem: "asc" },
      take: limite + 1,
    });
    const pagina = linhas.slice(0, limite);
    const externos = await externosPorIds(this.prisma, integ.sistema, "viagem", [...new Set(pagina.map((l) => l.entidadeId))]);
    const ultima = pagina[pagina.length - 1]?.ordem ?? desde;
    return {
      dados: pagina.map((l) => ({
        entidade: "viagem" as const,
        id: l.entidadeId,
        externo: externos.get(l.entidadeId) ?? null,
        mudanca: l.operacao as "CRIADA" | "ATUALIZADA" | "EXCLUIDA",
        eventos: l.eventos,
        porEstaIntegracao: l.integracaoId === integ.integracaoId,
        quando: l.criadoEm.toISOString(),
      })),
      proximoCursor: cursorAlteracoes(ultima, geracao),
      temMais: linhas.length > limite,
    };
  }

  /** Whitelist campo a campo: o que não está aqui não sai, inclusive campo novo do banco. */
  private async ler(integ: AuthIntegracao, id: string): Promise<ViagemV1 | null> {
    // Id de outra empresa: a trava filtra, e a resposta é o mesmo "não existe".
    const v = await this.prisma.viagem.findUnique({ where: { id }, select: VIAGEM_SELECT });
    if (!v) return null;
    return (await this.serializar(integ, [v]))[0]!;
  }

  private async serializar(integ: AuthIntegracao, vs: ViagemLida[]): Promise<ViagemV1[]> {
    if (vs.length === 0) return [];
    const [viagens, motoristas, veiculos, locais, regras] = await Promise.all([
      externosPorIds(this.prisma, integ.sistema, "viagem", vs.map((v) => v.id)),
      externosPorIds(this.prisma, integ.sistema, "motorista", [...new Set(vs.map((v) => v.motorista.id))]),
      externosPorIds(this.prisma, integ.sistema, "veiculo", [...new Set(vs.map((v) => v.veiculo.id))]),
      externosPorIds(
        this.prisma,
        integ.sistema,
        "local",
        [...new Set(vs.flatMap((v) => [v.localCarga?.id, v.localDescarga?.id]).filter((x): x is string => !!x))],
      ),
      this.prisma.regraMinimo.findMany({
        where: { ativo: true },
        select: { empresaId: true, materialId: true, kmFaixaDe: true, kmFaixaAte: true, kmMinimo: true, toneladasMinimo: true },
      }),
    ]);
    const veValor = integ.escopos.includes("valores:ler");
    const local = (l: { id: string; nome: string } | null) => (l ? { id: l.id, nome: l.nome, externo: locais.get(l.id) ?? null } : null);

    return vs.map((v) => {
      // Mínimo conta, preço vale — e só pra viagem que pode ser faturada.
      const faturavel = !STATUS_FORA_FECHAMENTO.includes(v.status);
      const override =
        faturavel && v.cliente?.empresaId && v.material ? resolverRegraMinimo(regras, v.cliente.empresaId, v.material.id, v.km ?? 0) : null;
      const min = faturavel ? aplicarMinimos({ toneladas: v.toneladas, km: v.km }, override ?? undefined) : null;
      return {
        id: v.id,
        externo: viagens.get(v.id) ?? null,
        situacao: situacaoPublica(v.status),
        origem: v.origemIntegracaoId ? "INTEGRACAO" : v.clientId.startsWith("import:") ? "PAINEL" : "APP",
        data: v.data ? v.data.toISOString().slice(0, 10) : null,
        motorista: { id: v.motorista.id, nome: v.motorista.nome, externo: motoristas.get(v.motorista.id) ?? null },
        veiculo: { id: v.veiculo.id, placa: v.veiculo.placa, externo: veiculos.get(v.veiculo.id) ?? null },
        localCarga: local(v.localCarga),
        localDescarga: local(v.localDescarga),
        material: v.material ? { id: v.material.id, nome: v.material.nome } : null,
        obra: v.cliente ? { id: v.cliente.id, nome: v.cliente.nome } : null,
        toneladas: v.toneladas?.toString() ?? null,
        toneladasFaturadas: min && v.toneladas != null ? min.toneladasEfetiva : null,
        km: v.km?.toString() ?? null,
        kmFaturado: min && v.km != null ? min.kmEfetivo : null,
        kmMotorista: v.kmMotorista?.toString() ?? null,
        kmSistemaOrigem: v.kmOrigem?.toString() ?? null,
        conferidaPor: !v.revisadoEm
          ? null
          : v.conferenciaDispensadaEm
            ? "DISPENSADA"
            : v.conferidoPorIaEm && !v.revisadoPorId
              ? "AUTOMATICA"
              : "PESSOA",
        ...(veValor
          ? {
              valor: v.valor
                ? { frete: v.valor.valorFrete.toFixed(2), pedagioCobradoCliente: v.valor.valorPedagio.toFixed(2), total: v.valor.valorTotal.toFixed(2) }
                : null,
            }
          : {}),
        ticket: v.ticket,
        pendencias: v.divergencias.map((d) => ({ motivo: d.motivo, detalhe: d.detalhe })),
        criadoEm: v.sincronizadoEm.toISOString(),
        alteradoEm: v.alteradoEm.toISOString(),
      };
    });
  }

  // --------------------------------------------------------- idempotência --

  /**
   * `Idempotency-Key`: o mesmo pedido mandado de novo (deu timeout, o sistema
   * de fora tentou outra vez) devolve a MESMA resposta, sem gravar de novo.
   * Mesma chave com outro conteúdo é erro (422): é bug do lado de lá.
   */
  private async comIdempotencia(
    integ: AuthIntegracao,
    chave: string | undefined,
    conteudo: unknown,
    fazer: () => Promise<RespostaGravar>,
  ): Promise<RespostaGravar> {
    if (!chave) return fazer();
    const hashCorpo = createHash("sha256").update(JSON.stringify(conteudo)).digest("hex");
    const agora = new Date();

    try {
      await this.prisma.idempotenciaIntegracao.create({
        data: {
          integracaoId: integ.integracaoId,
          chave,
          hashCorpo,
          estado: "EM_ANDAMENTO",
          expiraEm: new Date(agora.getTime() + IDEMPOTENCIA_HORAS * 3_600_000),
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const anterior = await this.prisma.idempotenciaIntegracao.findUnique({
        where: { integracaoId_chave: { integracaoId: integ.integracaoId, chave } },
      });
      if (!anterior) return this.comIdempotencia(integ, chave, conteudo, fazer);
      if (anterior.expiraEm < agora) {
        await this.prisma.idempotenciaIntegracao.deleteMany({ where: { id: anterior.id } });
        return this.comIdempotencia(integ, chave, conteudo, fazer);
      }
      if (anterior.hashCorpo !== hashCorpo) throw new ErroPublico("IDEMPOTENCIA_CONFLITO");
      if (anterior.estado !== "CONCLUIDA" || !anterior.resposta) throw new ErroPublico("REQUISICAO_EM_ANDAMENTO");
      return { status: (anterior.statusHttp as 200 | 201) ?? 200, corpo: anterior.resposta as RespostaGravar["corpo"] };
    }

    try {
      const r = await fazer();
      await this.prisma.idempotenciaIntegracao.updateMany({
        where: { integracaoId: integ.integracaoId, chave },
        data: { estado: "CONCLUIDA", statusHttp: r.status, resposta: r.corpo as unknown as Prisma.InputJsonValue },
      });
      return r;
    } catch (err) {
      // Falhou: a chave fica livre pra tentar de novo (não guardamos erro como resposta).
      await this.prisma.idempotenciaIntegracao.deleteMany({ where: { integracaoId: integ.integracaoId, chave } }).catch(() => {});
      throw err;
    }
  }
}

export function situacaoPublica(s: StatusViagem): ViagemV1["situacao"] {
  switch (s) {
    case StatusViagem.EM_ANDAMENTO:
      return "EM_ANDAMENTO";
    case StatusViagem.AGUARDANDO_PESO:
      return "AGUARDANDO_PESO";
    case StatusViagem.INCOMPLETA:
      return "INCOMPLETA";
    case StatusViagem.DIVERGENTE:
      return "COM_DIVERGENCIA";
    case StatusViagem.OK:
    case StatusViagem.AJUSTADA:
      return "CONFERIDA";
    default:
      return "A_CONFERIR";
  }
}

const STATUS_DA_SITUACAO: Record<ViagemV1["situacao"], StatusViagem[]> = {
  EM_ANDAMENTO: [StatusViagem.EM_ANDAMENTO],
  AGUARDANDO_PESO: [StatusViagem.AGUARDANDO_PESO],
  INCOMPLETA: [StatusViagem.INCOMPLETA],
  A_CONFERIR: [StatusViagem.ENVIADA, StatusViagem.EM_CONFERENCIA, StatusViagem.RASCUNHO_OFFLINE],
  COM_DIVERGENCIA: [StatusViagem.DIVERGENTE],
  CONFERIDA: [StatusViagem.OK, StatusViagem.AJUSTADA],
};

/** Cursor opaco: o integrador guarda e devolve, não interpreta. */
function cursorLista(em: Date, id: string): string {
  return Buffer.from(`l|${em.toISOString()}|${id}`).toString("base64url");
}
function lerCursorLista(c: string): { em: Date; id: string } {
  const [tipo, em, id] = Buffer.from(c, "base64url").toString().split("|");
  const d = new Date(em ?? "");
  if (tipo !== "l" || !id || Number.isNaN(d.getTime())) throw new ErroPublico("VALIDACAO", "Cursor inválido.");
  return { em: d, id };
}
function cursorAlteracoes(ordem: bigint, geracao: string): string {
  return Buffer.from(`a|${ordem}|${geracao}`).toString("base64url");
}
function lerCursorAlteracoes(c: string): { ordem: bigint; geracao: string } {
  const [tipo, ordem, geracao] = Buffer.from(c, "base64url").toString().split("|");
  if (tipo !== "a" || !ordem || !/^\d+$/.test(ordem) || geracao === undefined) throw new ErroPublico("VALIDACAO", "Cursor inválido.");
  return { ordem: BigInt(ordem), geracao };
}
