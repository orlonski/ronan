import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolverCamposDoTipo,
  type AtualizarDespesaInput,
  type CriarDespesaInput,
  type DespesaDoMotorista,
  type DespesasDoMotoristaResposta,
  type ListarDespesasMotoristaQuery,
  type VincularDespesasInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { contaIdAtual } from "../common/conta/conta-context";
import { garantirCadastro } from "../common/item-inexistente";
import { exigirFotosDoMotorista } from "../common/despesa-acesso";
import {
  chaveDeComprovante,
  decisaoInicial,
  diaSP,
  editavelPeloMotorista,
  marcasDoLancamento,
  situacaoParaMotorista,
} from "../common/despesa-regras";
import { dentroDeEmprego, periodosDeEmprego } from "../common/regime-vigente";
import { DespesasNucleoService } from "../despesas/despesas-nucleo.service";
import { LancamentosResgatadosService } from "../lancamentos-resgatados/lancamentos-resgatados.service";
import { mesRange } from "./viagens.service";

export const DESPESA_INCLUDE_MOTORISTA = {
  tipoDespesa: {
    select: {
      id: true,
      slug: true,
      nome: true,
      icone: true,
      ativo: true,
      devolve: true,
      aprovaSozinhoAte: true,
      devolveNoMaximo: true,
      manutencao: true,
      campos: true,
    },
  },
  viagem: {
    select: {
      id: true,
      clientId: true,
      data: true,
      localCarga: { select: { nome: true } },
      localDescarga: { select: { nome: true } },
    },
  },
  veiculo: { select: { id: true, placa: true } },
  fotos: { select: { id: true, sha256: true }, orderBy: { criadoEm: "asc" } },
  itensAcerto: {
    select: { acerto: { select: { id: true, periodoInicio: true, periodoFim: true, status: true, pagoEm: true } } },
  },
} satisfies Prisma.DespesaInclude;

type DespesaCompleta = Prisma.DespesaGetPayload<{ include: typeof DESPESA_INCLUDE_MOTORISTA }>;

const dec = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** "Pedreira Bela Vista → Arena" — o que o motorista reconhece. */
export function resumoDaViagem(v: {
  data: Date | null;
  localCarga: { nome: string } | null;
  localDescarga: { nome: string } | null;
}): string {
  const rota = [v.localCarga?.nome, v.localDescarga?.nome].filter(Boolean).join(" → ");
  const dia = v.data ? v.data.toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/") : null;
  return [dia, rota || "viagem"].filter(Boolean).join(" · ");
}

/**
 * O gasto de viagem do lado do motorista (/m/despesas).
 *
 * As portas (cadastro aprovado e módulo contratado) ficam no controller; aqui
 * mora a regra: idempotência pelo `clientId`, nunca recusar por configuração
 * (carimba), valor lançado intocável, vínculo que separa "sem resposta" de
 * "fora de viagem".
 */
@Injectable()
export class DespesasMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nucleo: DespesasNucleoService,
    private readonly resgates: LancamentosResgatadosService,
  ) {}

  private async periodosEmprego(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({ where: { id: motoristaId }, select: { cpf: true } });
    return periodosDeEmprego(this.prisma, m?.cpf ?? "");
  }

  paraMotorista(
    d: DespesaCompleta,
    periodos: { inicio: Date; fim: Date | null }[],
  ): DespesaDoMotorista {
    const acerto = d.itensAcerto.map((i) => i.acerto)[0] ?? null;
    const foraDoAcerto = dentroDeEmprego(periodos, new Date(`${diaSP(d.data)}T00:00:00Z`));
    const { situacao, somaPraReceber } = situacaoParaMotorista({
      status: d.status,
      valorInformado: Number(d.valorInformado),
      valorAprovado: dec(d.valorAprovado),
      motivo: d.motivo,
      decididoAutomatico: d.decididoAutomatico,
      acerto,
      foraDoAcerto,
    });
    return {
      id: d.id,
      clientId: d.clientId,
      tipo: { id: d.tipoDespesa.id, slug: d.tipoDespesa.slug, nome: d.tipoNome, icone: d.tipoDespesa.icone },
      valorInformado: d.valorInformado.toFixed(2),
      valorAprovado: d.valorAprovado ? d.valorAprovado.toFixed(2) : null,
      data: d.data.toISOString(),
      status: d.status,
      situacao,
      motivo: d.motivo,
      vinculo: d.vinculo,
      viagemId: d.viagemId,
      viagemClientId: d.viagemClientId,
      viagem: d.viagem
        ? { id: d.viagem.id, clientId: d.viagem.clientId, data: ymd(d.viagem.data), resumo: resumoDaViagem(d.viagem) }
        : null,
      veiculo: d.veiculo,
      descricao: d.descricao,
      litros: d.litros ? d.litros.toString() : null,
      odometro: d.odometro,
      onde: d.onde,
      semComprovanteMotivo: d.semComprovanteMotivo,
      fotos: d.fotos.map((f) => ({ id: f.id })),
      acerto: acerto
        ? {
            id: acerto.id,
            periodoInicio: ymd(acerto.periodoInicio)!,
            periodoFim: ymd(acerto.periodoFim)!,
            status: acerto.status,
            pagoEm: acerto.pagoEm ? acerto.pagoEm.toISOString() : null,
          }
        : null,
      somaPraReceber,
      editavel: editavelPeloMotorista({
        status: d.status,
        decididoAutomatico: d.decididoAutomatico,
        emAcerto: d.itensAcerto.length > 0,
      }),
    };
  }

  private async buscar(motoristaId: string, idOuClientId: string) {
    return this.prisma.despesa.findFirst({
      where: { motoristaId, OR: [{ id: idOuClientId }, { clientId: idOuClientId }] },
      include: DESPESA_INCLUDE_MOTORISTA,
    });
  }

  private async devolver(motoristaId: string, id: string): Promise<DespesaDoMotorista> {
    const d = await this.prisma.despesa.findUnique({ where: { id }, include: DESPESA_INCLUDE_MOTORISTA });
    if (!d) throw new NotFoundException("Gasto não encontrado.");
    return this.paraMotorista(d, await this.periodosEmprego(motoristaId));
  }

  /** O que o tipo, o lançamento e os vizinhos dizem — marcas e decisão de nascimento. */
  private async avaliar(args: {
    id?: string;
    motoristaId: string;
    tipo: DespesaCompleta["tipoDespesa"];
    valor: number;
    data: Date;
    fotos: { sha256: string | null }[];
    chaveFiscal: string | null;
    semComprovanteMotivo: string | null;
    descricao: string | null;
    veiculoId: string | null;
    litros: number | null;
    odometro: number | null;
    onde: string | null;
    viagemNaoAchada: boolean;
  }) {
    const repetido = await this.nucleo.procurarRepetido({
      id: args.id,
      motoristaId: args.motoristaId,
      tipoDespesaId: args.tipo.id,
      valor: args.valor,
      data: args.data,
      chaveFiscal: args.chaveFiscal,
      sha256s: args.fotos.map((f) => f.sha256).filter((h): h is string => !!h),
    });
    const marcas = marcasDoLancamento({
      cfg: resolverCamposDoTipo(args.tipo),
      tipoAtivo: args.tipo.ativo,
      devolveNoMaximo: dec(args.tipo.devolveNoMaximo),
      dados: {
        valor: args.valor,
        temFoto: args.fotos.length > 0,
        semComprovanteMotivo: args.semComprovanteMotivo,
        descricao: args.descricao,
        veiculoId: args.veiculoId,
        litros: args.litros,
        odometro: args.odometro,
        onde: args.onde,
      },
      repetido: !!repetido,
      viagemNaoAchada: args.viagemNaoAchada,
    });
    const decisao = decisaoInicial({
      devolve: args.tipo.devolve,
      aprovaSozinhoAte: dec(args.tipo.aprovaSozinhoAte),
      valor: args.valor,
      marcas,
    });
    return { repetido, marcas, decisao };
  }

  private async tipoOu409(tipoDespesaId: string) {
    const tipo = await this.prisma.tipoDespesa.findUnique({
      where: { id: tipoDespesaId },
      select: DESPESA_INCLUDE_MOTORISTA.tipoDespesa.select,
    });
    // Tipo de outra conta a trava não acha; tipo apagado não existe (só se
    // desativa). Desativado é aceito e carimbado (TIPO_INATIVO).
    if (!tipo) await garantirCadastro(async () => null, "tipoDespesaId");
    return tipo!;
  }

  async create(motoristaId: string, input: CriarDespesaInput): Promise<DespesaDoMotorista> {
    const existente = await this.prisma.despesa.findUnique({
      where: { motoristaId_clientId: { motoristaId, clientId: input.clientId } },
      select: { id: true },
    });
    if (existente) return this.devolver(motoristaId, existente.id);

    const contaId = contaIdAtual();
    const tipo = await this.tipoOu409(input.tipoDespesaId);
    if (input.veiculoId) {
      await garantirCadastro(
        () => this.prisma.veiculo.findUnique({ where: { id: input.veiculoId! }, select: { id: true } }),
        "veiculoId",
      );
    }
    const fotos = exigirFotosDoMotorista(input.fotoKeys ?? [], contaId, motoristaId);
    const viagem = await this.nucleo.resolverViagem(motoristaId, input.viagemId, input.viagemClientId);
    const temViagem = !!(viagem.viagemId || viagem.viagemClientId);
    const veiculoId = input.veiculoId ?? viagem.veiculoId ?? null;
    const chaveFiscal = chaveDeComprovante(input.chaveFiscal);
    const { repetido, marcas, decisao } = await this.avaliar({
      motoristaId,
      tipo,
      valor: input.valor,
      data: input.data,
      fotos,
      chaveFiscal,
      semComprovanteMotivo: input.semComprovanteMotivo ?? null,
      descricao: input.descricao ?? null,
      veiculoId,
      litros: input.litros ?? null,
      odometro: input.odometro ?? null,
      onde: input.onde ?? null,
      viagemNaoAchada: viagem.naoAchada,
    });

    let criado: { id: string };
    try {
      criado = await this.prisma.despesa.create({
        data: {
          clientId: input.clientId,
          motoristaId,
          tipoDespesaId: tipo.id,
          tipoNome: tipo.nome,
          valorInformado: new Prisma.Decimal(input.valor.toFixed(2)),
          valorAprovado: decisao.valorAprovado != null ? new Prisma.Decimal(decisao.valorAprovado.toFixed(2)) : null,
          data: input.data,
          vinculo: temViagem ? "VIAGEM" : input.foraDeViagem ? "FORA_DE_VIAGEM" : "SEM_RESPOSTA",
          vinculoPor: temViagem || input.foraDeViagem ? "MOTORISTA" : null,
          vinculadoEm: temViagem || input.foraDeViagem ? new Date() : null,
          viagemId: viagem.viagemId,
          viagemClientId: viagem.viagemClientId,
          veiculoId,
          descricao: input.descricao ?? null,
          litros: input.litros != null ? new Prisma.Decimal(input.litros) : null,
          odometro: input.odometro ?? null,
          onde: input.onde ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          precisao: input.precisao ?? null,
          semComprovanteMotivo: input.semComprovanteMotivo ?? null,
          chaveFiscal,
          camposVersao: input.camposVersao ?? null,
          status: decisao.status,
          motivo: decisao.motivo,
          decididoAutomatico: decisao.automatico,
          decididoEm: decisao.automatico ? new Date() : null,
          marcas,
          duplicadaDeId: repetido?.despesaId ?? null,
          repetidoPor: repetido?.sinal ?? null,
          confirmouQueEOutro: input.confirmouQueEOutro === true,
          criadoOfflineEm: input.criadoOfflineEm ?? null,
          fotos: { create: fotos.map((f) => ({ storageKey: f.storageKey, sha256: f.sha256 })) },
        },
        select: { id: true },
      });
    } catch (e) {
      // Duas tentativas do outbox ao mesmo tempo: a segunda bate no unique.
      // É o mesmo gasto — devolve o que entrou, nunca 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const ja = await this.prisma.despesa.findUnique({
          where: { motoristaId_clientId: { motoristaId, clientId: input.clientId } },
          select: { id: true },
        });
        if (ja) return this.devolver(motoristaId, ja.id);
      }
      throw e;
    }
    void this.resgates.marcarQueSubiu(input.clientId);
    return this.devolver(motoristaId, criado.id);
  }

  async update(motoristaId: string, idOuClientId: string, input: AtualizarDespesaInput): Promise<DespesaDoMotorista> {
    const atual = await this.exigirEditavel(motoristaId, idOuClientId);
    const contaId = contaIdAtual();
    const tipo = input.tipoDespesaId ? await this.tipoOu409(input.tipoDespesaId) : atual.tipoDespesa;
    if (input.veiculoId) {
      await garantirCadastro(
        () => this.prisma.veiculo.findUnique({ where: { id: input.veiculoId! }, select: { id: true } }),
        "veiculoId",
      );
    }
    const fotos =
      input.fotoKeys !== undefined
        ? exigirFotosDoMotorista(input.fotoKeys, contaId, motoristaId)
        : atual.fotos.map((f) => ({ storageKey: null as string | null, sha256: f.sha256 }));

    // Vínculo: só muda se o app mandou algum dos três campos.
    const mexeuVinculo =
      input.viagemId !== undefined || input.viagemClientId !== undefined || input.foraDeViagem !== undefined;
    let vinculo = {
      vinculo: atual.vinculo,
      viagemId: atual.viagemId,
      viagemClientId: atual.viagemClientId,
      naoAchada: atual.marcas.includes("VIAGEM_NAO_ACHADA"),
      veiculoDaViagem: null as string | null,
    };
    if (mexeuVinculo) {
      const v = await this.nucleo.resolverViagem(motoristaId, input.viagemId, input.viagemClientId);
      const temViagem = !!(v.viagemId || v.viagemClientId);
      vinculo = {
        vinculo: temViagem ? "VIAGEM" : input.foraDeViagem ? "FORA_DE_VIAGEM" : "SEM_RESPOSTA",
        viagemId: v.viagemId,
        viagemClientId: v.viagemClientId,
        naoAchada: v.naoAchada,
        veiculoDaViagem: v.veiculoId,
      };
    }
    const pega = <T>(novo: T | undefined, velho: T): T => (novo === undefined ? velho : novo);
    const valor = input.valor ?? Number(atual.valorInformado);
    const data = input.data ?? atual.data;
    const descricao = pega(input.descricao, atual.descricao) ?? null;
    const veiculoId = pega(input.veiculoId, atual.veiculoId) ?? vinculo.veiculoDaViagem ?? null;
    const litros = input.litros !== undefined ? input.litros : dec(atual.litros);
    const odometro = pega(input.odometro, atual.odometro) ?? null;
    const onde = pega(input.onde, atual.onde) ?? null;
    const semComprovanteMotivo = pega(input.semComprovanteMotivo, atual.semComprovanteMotivo) ?? null;
    const chaveFiscal =
      input.chaveFiscal !== undefined ? chaveDeComprovante(input.chaveFiscal) : atual.chaveFiscal;

    const { repetido, marcas, decisao } = await this.avaliar({
      id: atual.id,
      motoristaId,
      tipo,
      valor,
      data,
      fotos,
      chaveFiscal,
      semComprovanteMotivo,
      descricao,
      veiculoId,
      litros,
      odometro,
      onde,
      viagemNaoAchada: vinculo.naoAchada,
    });

    await this.prisma.$transaction(async (tx) => {
      if (input.fotoKeys !== undefined) {
        await tx.despesaFoto.deleteMany({ where: { despesaId: atual.id } });
        if (fotos.length) {
          await tx.despesaFoto.createMany({
            data: fotos.map((f) => ({ despesaId: atual.id, storageKey: f.storageKey!, sha256: f.sha256 })),
          });
        }
      }
      await tx.despesa.update({
        where: { id: atual.id },
        data: {
          tipoDespesaId: tipo.id,
          tipoNome: tipo.nome,
          // Ainda é o motorista corrigindo a PRÓPRIA palavra: o lançado muda.
          valorInformado: new Prisma.Decimal(valor.toFixed(2)),
          valorAprovado: decisao.valorAprovado != null ? new Prisma.Decimal(decisao.valorAprovado.toFixed(2)) : null,
          data,
          vinculo: vinculo.vinculo,
          ...(mexeuVinculo
            ? { vinculoPor: vinculo.vinculo === "SEM_RESPOSTA" ? null : "MOTORISTA", vinculadoEm: new Date() }
            : {}),
          viagemId: vinculo.viagemId,
          viagemClientId: vinculo.viagemClientId,
          veiculoId,
          descricao,
          litros: litros != null ? new Prisma.Decimal(litros) : null,
          odometro,
          onde,
          ...(input.lat !== undefined ? { lat: input.lat } : {}),
          ...(input.lng !== undefined ? { lng: input.lng } : {}),
          ...(input.precisao !== undefined ? { precisao: input.precisao } : {}),
          semComprovanteMotivo,
          chaveFiscal,
          ...(input.camposVersao !== undefined ? { camposVersao: input.camposVersao } : {}),
          status: decisao.status,
          motivo: decisao.motivo,
          decididoAutomatico: decisao.automatico,
          decididoEm: decisao.automatico ? new Date() : null,
          decididoPorId: null,
          marcas,
          duplicadaDeId: repetido?.despesaId ?? null,
          repetidoPor: repetido?.sinal ?? null,
          ...(input.confirmouQueEOutro !== undefined ? { confirmouQueEOutro: input.confirmouQueEOutro } : {}),
        },
      });
    });
    return this.devolver(motoristaId, atual.id);
  }

  private async exigirEditavel(motoristaId: string, idOuClientId: string) {
    const d = await this.prisma.despesa.findFirst({
      where: { OR: [{ id: idOuClientId }, { clientId: idOuClientId, motoristaId }] },
      include: DESPESA_INCLUDE_MOTORISTA,
    });
    if (!d) throw new NotFoundException("Gasto não encontrado.");
    if (d.motoristaId !== motoristaId) throw new ForbiddenException("Esse gasto não é seu.");
    if (
      !editavelPeloMotorista({
        status: d.status,
        decididoAutomatico: d.decididoAutomatico,
        emAcerto: d.itensAcerto.length > 0,
      })
    ) {
      throw new ConflictException({
        code: "DESPESA_JA_DECIDIDA",
        message: "O escritório já decidiu este gasto. Pra mudar, fale com o escritório.",
      });
    }
    return d;
  }

  /** Idempotente: gasto que já não existe responde como apagado. */
  async delete(motoristaId: string, idOuClientId: string): Promise<void> {
    const d = await this.prisma.despesa.findFirst({
      where: { OR: [{ id: idOuClientId }, { clientId: idOuClientId, motoristaId }] },
      select: { id: true },
    });
    if (!d) return;
    const atual = await this.exigirEditavel(motoristaId, d.id);
    await this.prisma.despesa.delete({ where: { id: atual.id } });
  }

  async vincular(motoristaId: string, input: VincularDespesasInput): Promise<{ itens: DespesaDoMotorista[] }> {
    const alvos = await this.prisma.despesa.findMany({
      where: { motoristaId, OR: [{ id: { in: input.despesas } }, { clientId: { in: input.despesas } }] },
      select: { id: true, veiculoId: true, marcas: true },
    });
    const v =
      input.acao === "VIAGEM"
        ? await this.nucleo.resolverViagem(motoristaId, input.viagemId, input.viagemClientId)
        : { viagemId: null, viagemClientId: null, veiculoId: null, naoAchada: false };
    const agora = new Date();
    for (const a of alvos) {
      await this.prisma.despesa.update({
        where: { id: a.id },
        data: {
          vinculo: input.acao === "VIAGEM" ? "VIAGEM" : input.acao === "FORA_DE_VIAGEM" ? "FORA_DE_VIAGEM" : "SEM_RESPOSTA",
          vinculoPor: input.acao === "DESFAZER" ? null : "MOTORISTA",
          vinculadoEm: agora,
          viagemId: v.viagemId,
          viagemClientId: v.viagemClientId,
          // A placa da viagem é fato da viagem: preenche só se estava vazia.
          veiculoId: a.veiculoId ?? v.veiculoId,
          marcas: DespesasNucleoService.comMarca(a.marcas, "VIAGEM_NAO_ACHADA", v.naoAchada),
        },
      });
    }
    const periodos = await this.periodosEmprego(motoristaId);
    const itens = await this.prisma.despesa.findMany({
      where: { id: { in: alvos.map((a) => a.id) } },
      include: DESPESA_INCLUDE_MOTORISTA,
      orderBy: { data: "desc" },
    });
    return { itens: itens.map((d) => this.paraMotorista(d, periodos)) };
  }

  async detalhe(motoristaId: string, idOuClientId: string): Promise<DespesaDoMotorista> {
    await this.nucleo.amarrarPendentes(motoristaId);
    const d = await this.buscar(motoristaId, idOuClientId);
    if (!d) throw new NotFoundException("Gasto não encontrado.");
    return this.paraMotorista(d, await this.periodosEmprego(motoristaId));
  }

  async foto(motoristaId: string, despesaId: string, fotoId: string) {
    const d = await this.prisma.despesa.findFirst({ where: { id: despesaId, motoristaId }, select: { id: true } });
    if (!d) throw new NotFoundException("Gasto não encontrado.");
    return this.nucleo.fotoBuffer(d.id, fotoId);
  }

  async list(motoristaId: string, q: ListarDespesasMotoristaQuery): Promise<DespesasDoMotoristaResposta> {
    await this.nucleo.amarrarPendentes(motoristaId);
    const where: Prisma.DespesaWhereInput = { motoristaId };
    if (q.mes) {
      const { inicio, fim } = mesRange(q.mes);
      // `mesRange` devolve meia-noite UTC; o gasto é instante → ancora em SP (+3h).
      where.data = { gte: new Date(inicio.getTime() + 3 * 3_600_000), lt: new Date(fim.getTime() + 3 * 3_600_000) };
    }
    const linhas = await this.prisma.despesa.findMany({
      where,
      include: DESPESA_INCLUDE_MOTORISTA,
      orderBy: [{ data: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const periodos = await this.periodosEmprego(motoristaId);
    const temMais = linhas.length > q.limit;
    const pagina = temMais ? linhas.slice(0, q.limit) : linhas;
    const resposta: DespesasDoMotoristaResposta = {
      itens: pagina.map((d) => this.paraMotorista(d, periodos)),
      nextCursor: temMais ? pagina[pagina.length - 1]!.id : null,
    };
    if (!q.cursor) resposta.resumo = await this.resumo(motoristaId, periodos);
    return resposta;
  }

  /** "Pra receber de volta": o que ainda não entrou em acerto fechado. */
  private async resumo(motoristaId: string, periodos: { inicio: Date; fim: Date | null }[]) {
    const vivas = await this.prisma.despesa.findMany({
      where: {
        motoristaId,
        status: { in: ["COM_ESCRITORIO", "APROVADA"] },
        itensAcerto: { none: { acerto: { status: { in: ["FECHADO", "PAGO"] } } } },
      },
      include: DESPESA_INCLUDE_MOTORISTA,
    });
    let aprovado = 0;
    let comEscritorio = 0;
    for (const d of vivas) {
      const m = this.paraMotorista(d, periodos);
      if (!m.somaPraReceber) continue;
      if (d.status === "APROVADA") aprovado += Number(d.valorAprovado ?? 0);
      else comEscritorio += Number(d.valorInformado);
    }
    const semViagem = await this.prisma.despesa.count({
      where: {
        motoristaId,
        vinculo: "SEM_RESPOSTA",
        itensAcerto: { none: { acerto: { status: { in: ["FECHADO", "PAGO"] } } } },
      },
    });
    return {
      praReceber: (aprovado + comEscritorio).toFixed(2),
      aprovado: aprovado.toFixed(2),
      comEscritorio: comEscritorio.toFixed(2),
      semViagem,
    };
  }
}
