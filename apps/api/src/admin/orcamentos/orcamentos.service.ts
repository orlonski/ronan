import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma, type StatusOrcamento } from "@prisma/client";
import type {
  AprovarOrcamentoInput,
  CriarOrcamentoInput,
  SugestaoItemOrcamento,
  SugestaoItemOrcamentoQuery,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { ymdSaoPaulo } from "../../common/timezone";
import { RoteamentoService } from "../../roteamento/roteamento.service";
import { PrecificacaoService } from "../tabelas-preco/precificacao.service";
import type { AuthAdminUser } from "../../auth/types";
import {
  itensParaPedidos,
  passouDaValidade,
  planoTabelaPreco,
  podeAprovar,
  podeEditar,
  podeExcluir,
  podeRecusar,
  statusAposEditar,
  sugerirPrecoItem,
  totalOrcamento,
  valorItem,
  SEM_VALOR_TEXTO,
} from "../../common/orcamento";

export function hojeSP(): string {
  return ymdSaoPaulo()
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
}

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const diaOuNull = (iso: string | null | undefined) => (iso ? dia(iso) : null);

const LOCAL = { select: { id: true, nome: true, cidade: true, uf: true } } as const;

const INCLUDE = {
  empresa: { select: { id: true, nome: true, contato: true } },
  cliente: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
  itens: {
    orderBy: { ordem: "asc" },
    include: {
      material: { select: { id: true, nome: true, densidadeTonM3: true } },
      tipoServico: { select: { id: true, nome: true } },
      localCarga: LOCAL,
      localDescarga: LOCAL,
      pedido: { select: { id: true, numero: true, status: true } },
    },
  },
} satisfies Prisma.OrcamentoInclude;

type OrcamentoCompleto = Prisma.OrcamentoGetPayload<{ include: typeof INCLUDE }>;

type ListParams = PaginationQuery & { status?: StatusOrcamento; empresaId?: string };

/**
 * Orçamento: a proposta comercial que vira pedido. As regras (total, sugestão
 * de preço, ciclo, conversão e o preço que vai pra tabela) moram em
 * `common/orcamento.ts`; aqui é só banco e permissão.
 */
@Injectable()
export class OrcamentosService {
  private readonly log = new Logger(OrcamentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roteamento: RoteamentoService,
    private readonly precificacao: PrecificacaoService,
  ) {}

  /** Total e o valor de cada item, calculados na leitura — nunca guardados. */
  private comTotais(o: OrcamentoCompleto) {
    const linhas = o.itens.map((it) => {
      const r = valorItem({ ...it, densidadeTonM3: it.material?.densidadeTonM3 ?? null });
      return {
        ...it,
        valor: r.valor ? r.valor.toFixed(2) : null,
        semValorMotivo: r.valor ? null : SEM_VALOR_TEXTO[r.motivo],
      };
    });
    const t = totalOrcamento(o.itens.map((it) => ({ ...it, densidadeTonM3: it.material?.densidadeTonM3 ?? null })));
    return {
      ...o,
      itens: linhas,
      total: t.total,
      itensSemValor: t.itensSemValor,
      /** Nome de quem recebe: cliente cadastrado ou prospect. */
      destinatario: o.empresa?.nome ?? o.prospectNome ?? "—",
    };
  }

  async list(params: ListParams) {
    const where: Prisma.OrcamentoWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.empresaId) where.empresaId = params.empresaId;
    const paged = await paginate(this.prisma.orcamento, {
      params,
      where: where as Record<string, unknown>,
      // Proposta é da relação com o cliente, não de uma frota.
      escopo: SEM_ESCOPO,
      searchFields: ["prospectNome", "empresa.nome", "cliente.nome", "condicoes"],
      sortable: { numero: "numero", validadeEm: "validadeEm", criadoEm: "criadoEm" },
      defaultSort: { field: "numero", order: "desc" },
      include: INCLUDE,
    });
    return {
      ...paged,
      data: (paged.data as OrcamentoCompleto[]).map((o) => this.comTotais(o)),
    };
  }

  async findOne(id: string) {
    const o = await this.prisma.orcamento.findUnique({ where: { id }, include: INCLUDE });
    if (!o) throw new NotFoundException("Orçamento não encontrado.");
    return this.comTotais(o);
  }

  /** Pro PDF e pro link: o orçamento com o nome e a logo da transportadora. */
  async paraDocumento(id: string) {
    const o = await this.prisma.orcamento.findUnique({
      where: { id },
      include: { ...INCLUDE, conta: { select: { nome: true, logoKey: true, cnpj: true } } },
    });
    if (!o) throw new NotFoundException("Orçamento não encontrado.");
    return { ...this.comTotais(o), conta: o.conta };
  }

  // ───────────────────────────── sugestão ─────────────────────────────

  /**
   * O km da rota e o preço da tabela do cliente pra um item. Tudo degrada: sem
   * locais, sem coordenada ou sem OSRM → sem km; sem cliente cadastrado ou sem
   * linha que sirva → sem preço. Nada aqui lança: é ajuda, não validação.
   */
  async sugestao(q: SugestaoItemOrcamentoQuery): Promise<SugestaoItemOrcamento> {
    let kmEstimado: string | null = null;
    let kmMotivo: string | null = null;
    if (q.localCargaId && q.localDescargaId) {
      try {
        const r = await this.roteamento.calcularKm(q.localCargaId, q.localDescargaId);
        kmEstimado = r.km;
        kmMotivo = r.km == null ? (r.erro ?? "Não deu pra calcular a rota.") : null;
      } catch (e) {
        this.log.warn(`rota do orçamento falhou: ${(e as Error).message}`);
        kmMotivo = "Não deu pra calcular a rota agora.";
      }
    } else {
      kmMotivo = "Escolha onde carrega e onde entrega pra ver a distância.";
    }

    if (!q.empresaId) {
      return { kmEstimado, kmMotivo, preco: null, precoMotivo: "Cliente ainda não cadastrado: informe o preço." };
    }
    const tabelas = await this.prisma.tabelaPreco.findMany({ where: { empresaId: q.empresaId, ativo: true } });
    const s = sugerirPrecoItem(tabelas, {
      empresaId: q.empresaId,
      materialId: q.materialId ?? null,
      tipoServicoId: q.tipoServicoId ?? null,
      kmEstimado,
      hoje: hojeSP(),
    });
    return {
      kmEstimado,
      kmMotivo,
      preco: s.linha
        ? { precoUnitario: Number(s.linha.precoUnitario).toFixed(2), base: s.linha.base, tabelaPrecoId: s.linha.id }
        : null,
      precoMotivo: s.linha ? null : s.motivo,
    };
  }

  // ───────────────────────────── escrita ─────────────────────────────

  private async validarRefs(data: CriarOrcamentoInput) {
    if (data.empresaId) {
      const e = await this.prisma.empresa.findUnique({ where: { id: data.empresaId }, select: { id: true } });
      if (!e) throw new BadRequestException("Cliente não encontrado.");
    }
    if (data.clienteId) {
      const c = await this.prisma.cliente.findUnique({ where: { id: data.clienteId }, select: { empresaId: true } });
      if (!c) throw new BadRequestException("Obra não encontrada.");
      if (!data.empresaId || c.empresaId !== data.empresaId) {
        throw new BadRequestException("A obra escolhida não é desse cliente.");
      }
    }
    const ids = <K extends "materialId" | "tipoServicoId" | "localCargaId" | "localDescargaId">(k: K) => [
      ...new Set(data.itens.map((i) => i[k]).filter((v): v is string => !!v)),
    ];
    const conferir = async (nome: string, lista: string[], contar: (ids: string[]) => Promise<number>) => {
      if (lista.length && (await contar(lista)) !== lista.length) {
        throw new BadRequestException(`${nome} de algum item não foi encontrado.`);
      }
    };
    await conferir("O material", ids("materialId"), (l) => this.prisma.material.count({ where: { id: { in: l } } }));
    await conferir("O tipo de serviço", ids("tipoServicoId"), (l) =>
      this.prisma.tipoServico.count({ where: { id: { in: l } } }),
    );
    const locais = [...new Set([...ids("localCargaId"), ...ids("localDescargaId")])];
    await conferir("O local", locais, (l) => this.prisma.local.count({ where: { id: { in: l } } }));
  }

  private dadosCabecalho(data: CriarOrcamentoInput) {
    return {
      empresaId: data.empresaId ?? null,
      clienteId: data.empresaId ? (data.clienteId ?? null) : null,
      prospectNome: data.prospectNome?.trim() || null,
      prospectContato: data.prospectContato?.trim() || null,
      validadeEm: dia(data.validadeEm),
      condicoes: data.condicoes?.trim() || null,
      inicioPrevistoEm: diaOuNull(data.inicioPrevistoEm),
      prazoEm: diaOuNull(data.prazoEm),
    };
  }

  private dadosItens(data: CriarOrcamentoInput) {
    return data.itens.map((it, ordem) => ({
      ordem,
      materialId: it.materialId ?? null,
      tipoServicoId: it.tipoServicoId ?? null,
      localCargaId: it.localCargaId ?? null,
      localDescargaId: it.localDescargaId ?? null,
      descricao: it.descricao?.trim() || null,
      quantidade: new Prisma.Decimal(it.quantidade),
      unidade: it.unidade,
      base: it.base,
      precoUnitario: new Prisma.Decimal(it.precoUnitario),
      kmEstimado: it.kmEstimado == null ? null : new Prisma.Decimal(it.kmEstimado),
    }));
  }

  async create(data: CriarOrcamentoInput, usuarioId: string) {
    await this.validarRefs(data);
    if (passouDaValidade(data.validadeEm, hojeSP())) {
      throw new BadRequestException("A validade não pode ser antes de hoje.");
    }
    // Numeração por conta, como no pedido: `max + 1` dentro da transação.
    const criado = await this.prisma.$transaction(async (tx) => {
      const ultimo = await tx.orcamento.aggregate({ _max: { numero: true } });
      return tx.orcamento.create({
        data: {
          ...this.dadosCabecalho(data),
          numero: (ultimo._max.numero ?? 0) + 1,
          criadoPorId: usuarioId,
          itens: { create: this.dadosItens(data) },
        },
        select: { id: true },
      });
    });
    return this.findOne(criado.id);
  }

  async update(id: string, data: CriarOrcamentoInput) {
    const atual = await this.ensureExists(id);
    if (!podeEditar(atual.status)) {
      throw new ConflictException(`Orçamento ${atual.status === "APROVADO" ? "aprovado" : "recusado"} não muda mais.`);
    }
    await this.validarRefs(data);
    const hoje = hojeSP();
    // Mexer na validade pra trás de hoje deixaria a proposta vencida na hora —
    // só aceita se ela já não estava valendo antes (edição de um vencido).
    if (passouDaValidade(data.validadeEm, hoje) && atual.status !== "VENCIDO") {
      throw new BadRequestException("A validade não pode ser antes de hoje.");
    }
    const status = statusAposEditar(atual.status, data.validadeEm, hoje);
    await this.prisma.$transaction(async (tx) => {
      // Itens trocados por inteiro: a proposta é um documento, e reconciliar
      // linha a linha não acrescenta nada enquanto nenhum item virou pedido.
      await tx.orcamentoItem.deleteMany({ where: { orcamentoId: id } });
      await tx.orcamento.update({
        where: { id },
        data: {
          ...this.dadosCabecalho(data),
          status,
          vencidoEm: status === "VENCIDO" ? atual.vencidoEm : null,
          itens: { create: this.dadosItens(data) },
        },
      });
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    const atual = await this.ensureExists(id);
    if (!podeExcluir(atual.status)) {
      throw new ConflictException("Só rascunho pode ser apagado. O que já foi pro cliente pode ser marcado como recusado.");
    }
    await this.prisma.orcamento.delete({ where: { id } });
  }

  /**
   * Sair o link pro cliente É mandar a proposta: rascunho vira ENVIADO aqui.
   * Não envia nada sozinho — quem manda é a pessoa, pelo WhatsApp dela.
   */
  async marcarEnviado(id: string) {
    const atual = await this.ensureExists(id);
    if (atual.status === "VENCIDO" || passouDaValidade(atual.validadeEm, hojeSP())) {
      throw new ConflictException("Esta proposta já venceu. Prorrogue a validade antes de mandar.");
    }
    if (atual.status === "RASCUNHO") {
      await this.prisma.orcamento.update({ where: { id }, data: { status: "ENVIADO", enviadoEm: new Date() } });
    }
    return atual;
  }

  async recusar(id: string, motivo: string) {
    const atual = await this.ensureExists(id);
    if (!podeRecusar(atual.status)) throw new ConflictException("Este orçamento já tem resposta.");
    await this.prisma.orcamento.update({
      where: { id },
      data: { status: "RECUSADO", recusadoEm: new Date(), motivoRecusa: motivo.trim() },
    });
    return this.findOne(id);
  }

  /**
   * Aprovar: cada item vira um Pedido; opcionalmente o preço vai pra tabela do
   * cliente. Tudo numa transação — pedido criado pela metade, ou preço na
   * tabela sem o pedido, seria pior que não aprovar.
   *
   * O orçamento não é atalho de permissão: criar pedido exige `pedidos.criar`,
   * cadastrar o cliente exige `empresas.criar`, e mexer na tabela exige
   * `tabelas-preco.criar` — as mesmas chaves das telas de cada coisa.
   */
  async aprovar(id: string, input: AprovarOrcamentoInput, user: AuthAdminUser) {
    const exigir = (chave: string, oQue: string) => {
      if (!user.permissoes.includes(chave)) {
        throw new ForbiddenException(`Você não tem permissão pra ${oQue}.`);
      }
    };
    exigir("pedidos.criar", "criar pedido");
    if (input.usarPrecoNaTabela) exigir("tabelas-preco.criar", "mexer na tabela de preço do cliente");

    const o = await this.prisma.orcamento.findUnique({ where: { id }, include: INCLUDE });
    if (!o) throw new NotFoundException("Orçamento não encontrado.");
    if (!podeAprovar(o.status)) {
      throw new ConflictException(
        o.status === "VENCIDO"
          ? "Esta proposta venceu. Prorrogue a validade antes de aprovar."
          : "Este orçamento já tem resposta.",
      );
    }
    const hoje = hojeSP();
    if (passouDaValidade(o.validadeEm, hoje)) {
      throw new ConflictException("Esta proposta venceu. Prorrogue a validade antes de aprovar.");
    }

    // Quem paga o pedido. Prospect precisa virar cliente (novo ou existente).
    let empresaId = o.empresaId;
    let clienteId = o.clienteId;
    if (!empresaId) {
      if (input.empresaId) {
        const e = await this.prisma.empresa.findUnique({ where: { id: input.empresaId }, select: { id: true } });
        if (!e) throw new BadRequestException("Cliente não encontrado.");
        empresaId = e.id;
      } else if (input.cadastrarCliente) {
        exigir("empresas.criar", "cadastrar cliente");
        if (!o.prospectNome) throw new BadRequestException("O orçamento não tem o nome do cliente pra cadastrar.");
      } else {
        throw new BadRequestException(
          "Esse cliente ainda não está cadastrado. Escolha um cliente ou marque pra cadastrá-lo agora.",
        );
      }
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      if (!empresaId) {
        // Mesmo jeito do cadastro de cliente: nasce com a primeira obra, de
        // mesmo nome — o motorista escolhe OBRA no app, e cliente sem obra
        // não aparece pra ele (empresas.service).
        const empresa = await tx.empresa.create({
          data: { nome: o.prospectNome!, contato: o.prospectContato, criadoPorId: user.id },
        });
        const obra = await tx.cliente.create({
          data: { nome: empresa.nome, empresaId: empresa.id, criadoPorId: user.id },
        });
        empresaId = empresa.id;
        clienteId = obra.id;
      }

      const planos = itensParaPedidos(o, o.itens, { empresaId: empresaId!, clienteId, hoje });
      const ultimo = await tx.pedido.aggregate({ _max: { numero: true } });
      let numero = ultimo._max.numero ?? 0;
      const pedidos: { id: string; numero: number }[] = [];
      for (const p of planos) {
        const pedido = await tx.pedido.create({
          data: {
            numero: ++numero,
            empresaId: p.empresaId,
            clienteId: p.clienteId,
            materialId: p.materialId,
            tipoServicoId: p.tipoServicoId,
            localCargaId: p.localCargaId,
            localDescargaId: p.localDescargaId,
            quantidadeAlvo: p.quantidadeAlvo,
            unidadeAlvo: p.unidadeAlvo,
            inicioEm: dia(p.inicioEm),
            prazoEm: diaOuNull(p.prazoEm),
            observacao: p.observacao,
            criadoPorId: user.id,
          },
          select: { id: true, numero: true },
        });
        await tx.orcamentoItem.update({ where: { id: p.itemId }, data: { pedidoId: pedido.id } });
        pedidos.push(pedido);
      }

      const tabela: { itemId: string; resultado: string }[] = [];
      const criadasAgora: string[] = [];
      if (input.usarPrecoNaTabela) {
        for (const it of o.itens) {
          // Relê a cada item: dois itens do mesmo material na mesma faixa
          // têm que enxergar a linha que o anterior acabou de criar.
          const existentes = await tx.tabelaPreco.findMany({ where: { empresaId: empresaId!, ativo: true } });
          const plano = planoTabelaPreco(existentes, it, hoje, { criadasAgora });
          if (plano.acao === "ERRO") {
            throw new BadRequestException(`${it.material?.nome ?? "Item"}: ${plano.motivo}`);
          }
          if (plano.acao === "NADA") {
            tabela.push({ itemId: it.id, resultado: plano.motivo });
            continue;
          }
          for (const f of plano.fechar) {
            // Só o FIM da vigência muda; o preço da linha antiga fica intacto.
            await tx.tabelaPreco.update({ where: { id: f.id }, data: { vigenciaAte: dia(f.vigenciaAte) } });
          }
          const nova = await tx.tabelaPreco.create({
            data: {
              empresaId: empresaId!,
              materialId: it.materialId,
              tipoServicoId: it.tipoServicoId,
              kmFaixaDe: new Prisma.Decimal(plano.criar.kmFaixaDe),
              kmFaixaAte: plano.criar.kmFaixaAte == null ? null : new Prisma.Decimal(plano.criar.kmFaixaAte),
              base: it.base,
              precoUnitario: it.precoUnitario,
              vigenciaDe: dia(plano.criar.vigenciaDe),
              criadoPorId: user.id,
            },
            select: { id: true },
          });
          criadasAgora.push(nova.id);
          await tx.orcamentoItem.update({ where: { id: it.id }, data: { tabelaPrecoCriadaId: nova.id } });
          tabela.push({ itemId: it.id, resultado: "Preço novo na tabela do cliente a partir de hoje." });
        }
      }

      await tx.orcamento.update({
        where: { id },
        data: {
          status: "APROVADO",
          aprovadoEm: new Date(),
          aprovadoPorId: user.id,
          empresaId,
          clienteId,
        },
      });
      return { pedidos, tabela };
    });

    // Preço novo vale pras viagens de hoje em diante já lançadas, igual à tela
    // da tabela. Fora da transação: é recálculo de fundo e não pode desfazer a
    // aprovação se falhar — o cron da madrugada cobre o que sobrar.
    if (resultado.tabela.some((t) => t.resultado.startsWith("Preço novo"))) {
      await this.precificacao.recalcularDaEmpresa(empresaId!, { de: dia(hoje) }).catch((e: Error) => {
        this.log.warn(`recálculo depois do orçamento falhou: ${e.message}`);
      });
    }
    return { ...(await this.findOne(id)), pedidosCriados: resultado.pedidos, tabela: resultado.tabela };
  }

  // ───────────────────────────── cron ─────────────────────────────

  /** Marca VENCIDO o que passou da validade sem resposta. 00:10 de SP. */
  @Cron("0 10 0 * * *", { name: "orcamentos-vencidos", timeZone: "America/Sao_Paulo" })
  async vencerAtrasados(): Promise<void> {
    try {
      await comLockDeCron(this.prisma, "orcamentos-vencidos", async () => {
        await paraCadaConta(this.prisma, async () => {
          await this.vencerDaConta();
        });
      });
    } catch (e) {
      this.log.error(`vencimento de orçamentos falhou: ${(e as Error).message}`);
    }
  }

  /** Dentro do contexto da conta (a trava filtra). Exposto pro teste. */
  async vencerDaConta(hoje = hojeSP()): Promise<number> {
    const r = await this.prisma.orcamento.updateMany({
      where: { status: { in: ["RASCUNHO", "ENVIADO"] }, validadeEm: { lt: dia(hoje) } },
      data: { status: "VENCIDO", vencidoEm: new Date() },
    });
    return r.count;
  }

  private async ensureExists(id: string) {
    const o = await this.prisma.orcamento.findUnique({ where: { id } });
    if (!o) throw new NotFoundException("Orçamento não encontrado.");
    return o;
  }
}
