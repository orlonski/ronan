import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import {
  resolverCamposDoTipo,
  sugerirViagens,
  textoJanela,
  type AprovarDespesaInput,
  type ListarDespesasAdminQuery,
  type PontoAtencaoDespesa,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { inicioDoDiaBR } from "../../common/timezone";
import { diaSP, temAtencao, validarDecisao } from "../../common/despesa-regras";
import { DespesasNucleoService } from "../../despesas/despesas-nucleo.service";
import { resumoDaViagem } from "../../motorista/despesas.service";

const INCLUDE_ADMIN = {
  motorista: { select: { id: true, nome: true } },
  veiculo: { select: { id: true, placa: true } },
  tipoDespesa: {
    select: {
      id: true,
      slug: true,
      nome: true,
      icone: true,
      ativo: true,
      devolve: true,
      devolveNoMaximo: true,
      manutencao: true,
      podeCobrarCliente: true,
      campos: true,
    },
  },
  viagem: {
    select: {
      id: true,
      data: true,
      localCarga: { select: { nome: true } },
      localDescarga: { select: { nome: true } },
    },
  },
  fotos: { select: { id: true, rotacao: true }, orderBy: { criadoEm: "asc" } },
  decididoPor: { select: { id: true, nome: true } },
  duplicadaDe: { select: { id: true, tipoNome: true, valorInformado: true, data: true } },
  itensAcerto: {
    select: { acerto: { select: { id: true, periodoInicio: true, periodoFim: true, status: true } } },
  },
} satisfies Prisma.DespesaInclude;

type DespesaAdmin = Prisma.DespesaGetPayload<{ include: typeof INCLUDE_ADMIN }>;
type Sugestao = { viagemId: string; resumo: string; janela: string } | null;

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmm = (d: Date) => diaSP(d).split("-").reverse().slice(0, 2).join("/");

/**
 * Painel do gasto de viagem: a fila "Conferir", a aba "Todos", decisões e
 * vínculo com a viagem. Toda decisão é humana e com autor; o valor lançado
 * pelo motorista nunca muda (o aprovado é outra coluna).
 */
@Injectable()
export class DespesasAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly nucleo: DespesasNucleoService,
  ) {}

  private where(q: Partial<ListarDespesasAdminQuery>, escopo: EscopoAdmin): Prisma.DespesaWhereInput {
    const w: Prisma.DespesaWhereInput = {};
    if (q.status) w.status = q.status;
    if (q.motoristaId) w.motoristaId = q.motoristaId;
    if (q.veiculoId) w.veiculoId = q.veiculoId;
    if (q.viagemId) w.viagemId = q.viagemId;
    if (q.tipoDespesaId) w.tipoDespesaId = q.tipoDespesaId;
    if (q.podeCobrarCliente) w.tipoDespesa = { podeCobrarCliente: q.podeCobrarCliente === "true" };
    if (q.de || q.ate) {
      w.data = {
        ...(q.de ? { gte: inicioDoDiaBR(q.de) } : {}),
        ...(q.ate ? { lt: new Date(inicioDoDiaBR(q.ate).getTime() + 86_400_000) } : {}),
      };
    }
    // O gasto não tem coluna de frota: o recorte vem do motorista (como o acerto).
    if (escopo) w.motorista = filtroEscopo(escopo) as Prisma.MotoristaWhereInput;
    return w;
  }

  /** Sugestão de viagem pros gastos sem resposta — a MESMA função que o app usa. */
  private async sugestoes(itens: DespesaAdmin[]): Promise<Map<string, Sugestao>> {
    const soltos = itens.filter((d) => d.vinculo === "SEM_RESPOSTA");
    const mapa = new Map<string, Sugestao>();
    if (!soltos.length) return mapa;
    const tempos = soltos.map((d) => d.data.getTime());
    const de = new Date(`${diaSP(new Date(Math.min(...tempos)))}T00:00:00Z`);
    const ate = new Date(`${diaSP(new Date(Math.max(...tempos)))}T00:00:00Z`);
    const viagens = await this.prisma.viagem.findMany({
      where: {
        motoristaId: { in: [...new Set(soltos.map((d) => d.motoristaId))] },
        data: { gte: new Date(de.getTime() - 86_400_000), lte: new Date(ate.getTime() + 86_400_000) },
      },
      select: {
        id: true,
        motoristaId: true,
        veiculoId: true,
        data: true,
        iniciadoEm: true,
        status: true,
        localCarga: { select: { nome: true } },
        localDescarga: { select: { nome: true } },
      },
      take: 2000,
    });
    for (const d of soltos) {
      const [s] = sugerirViagens(
        { data: d.data, motoristaId: d.motoristaId, veiculoId: d.veiculoId },
        viagens,
      );
      mapa.set(
        d.id,
        s ? { viagemId: s.viagem.id, resumo: resumoDaViagem(s.viagem), janela: textoJanela(s.janela) } : null,
      );
    }
    return mapa;
  }

  private pontos(d: DespesaAdmin, sugestao: Sugestao | undefined): PontoAtencaoDespesa[] {
    const p: PontoAtencaoDespesa[] = [];
    const m = d.marcas;
    if (m.includes("SEM_COMPROVANTE")) p.push({ tipo: "SEM_COMPROVANTE", motivo: d.semComprovanteMotivo });
    if (m.includes("ACIMA_DO_MAXIMO")) {
      p.push({ tipo: "ACIMA_DO_MAXIMO", maximo: d.tipoDespesa.devolveNoMaximo?.toFixed(2) ?? "0.00" });
    }
    if (m.includes("POSSIVEL_REPETIDO")) {
      const o = d.duplicadaDe;
      p.push({
        tipo: "POSSIVEL_REPETIDO",
        despesaId: o?.id ?? null,
        resumo: o ? `${o.tipoNome} ${brl(Number(o.valorInformado))} de ${ddmm(o.data)}` : null,
        confirmouQueEOutro: d.confirmouQueEOutro,
      });
    }
    if (m.includes("CAMPO_EXIGIDO_AUSENTE")) p.push({ tipo: "CAMPO_EXIGIDO_AUSENTE" });
    if (m.includes("TIPO_INATIVO")) p.push({ tipo: "TIPO_INATIVO" });
    // "Sem viagem" só é ponto de atenção quando há viagem PARECIDA — gasto de
    // quem não estava viajando não precisa de ninguém olhando.
    if (d.vinculo === "SEM_RESPOSTA" && sugestao) p.push({ tipo: "SEM_VIAGEM", sugestao });
    return p;
  }

  private paraPainel(d: DespesaAdmin, sugestao: Sugestao | undefined) {
    const pontos = this.pontos(d, sugestao);
    const acerto = d.itensAcerto[0]?.acerto ?? null;
    return {
      id: d.id,
      clientId: d.clientId,
      motorista: d.motorista,
      veiculo: d.veiculo,
      tipo: {
        id: d.tipoDespesa.id,
        slug: d.tipoDespesa.slug,
        nome: d.tipoNome,
        icone: d.tipoDespesa.icone,
        devolve: d.tipoDespesa.devolve,
        podeCobrarCliente: d.tipoDespesa.podeCobrarCliente,
        manutencao: d.tipoDespesa.manutencao,
      },
      camposDoTipo: resolverCamposDoTipo(d.tipoDespesa),
      valorInformado: d.valorInformado.toFixed(2),
      valorAprovado: d.valorAprovado?.toFixed(2) ?? null,
      data: d.data.toISOString(),
      sincronizadoEm: d.sincronizadoEm.toISOString(),
      status: d.status,
      motivo: d.motivo,
      decididoAutomatico: d.decididoAutomatico,
      decididoPor: d.decididoPor,
      decididoEm: d.decididoEm?.toISOString() ?? null,
      vinculo: d.vinculo,
      viagem: d.viagem ? { id: d.viagem.id, resumo: resumoDaViagem(d.viagem) } : null,
      viagemClientId: d.viagemClientId,
      descricao: d.descricao,
      litros: d.litros?.toString() ?? null,
      odometro: d.odometro,
      onde: d.onde,
      semComprovanteMotivo: d.semComprovanteMotivo,
      chaveFiscal: d.chaveFiscal,
      fotos: d.fotos,
      marcas: d.marcas,
      pontos,
      /** Pode ir no "aprovar em lote": com o escritório, sem nenhum ponto de atenção. */
      semAtencao: d.status === "COM_ESCRITORIO" && pontos.length === 0,
      acerto: acerto
        ? {
            id: acerto.id,
            status: acerto.status,
            periodoInicio: acerto.periodoInicio.toISOString().slice(0, 10),
            periodoFim: acerto.periodoFim.toISOString().slice(0, 10),
          }
        : null,
    };
  }

  /**
   * A fila "Conferir": com o escritório, de tipo que devolve, mais antigos
   * primeiro. Sem paginação (a fila é a mesa de trabalho do dia; teto de 500)
   * porque o filtro "só sem ponto de atenção" depende da sugestão de viagem,
   * que é calculada aqui e não no banco.
   */
  async fila(q: Partial<ListarDespesasAdminQuery>, escopo: EscopoAdmin) {
    await this.nucleo.amarrarPendentes();
    const linhas = await this.prisma.despesa.findMany({
      where: { ...this.where({ ...q, status: undefined }, escopo), status: "COM_ESCRITORIO" },
      include: INCLUDE_ADMIN,
      orderBy: [{ data: "asc" }, { id: "asc" }],
      take: 500,
    });
    const sug = await this.sugestoes(linhas);
    let itens = linhas.map((d) => this.paraPainel(d, sug.get(d.id)));
    if (q.semAtencao === "true") itens = itens.filter((i) => i.semAtencao);
    return {
      itens,
      total: itens.length,
      totalValor: itens.reduce((a, i) => a + Number(i.valorInformado), 0).toFixed(2),
    };
  }

  /** A aba "Todos": tudo, paginado, com filtros. Só leitura. */
  async todos(q: ListarDespesasAdminQuery, escopo: EscopoAdmin) {
    await this.nucleo.amarrarPendentes();
    const where = this.where(q, escopo);
    const [total, linhas, soma] = await Promise.all([
      this.prisma.despesa.count({ where }),
      this.prisma.despesa.findMany({
        where,
        include: INCLUDE_ADMIN,
        orderBy: [{ data: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.despesa.aggregate({ where, _sum: { valorInformado: true, valorAprovado: true } }),
    ]);
    const sug = await this.sugestoes(linhas);
    return {
      data: linhas.map((d) => this.paraPainel(d, sug.get(d.id))),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalInformado: soma._sum.valorInformado?.toFixed(2) ?? "0.00",
      totalAprovado: soma._sum.valorAprovado?.toFixed(2) ?? "0.00",
    };
  }

  private async carregar(id: string, escopo: EscopoAdmin) {
    const d = await this.prisma.despesa.findFirst({
      where: { id, ...(escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {}) },
      include: INCLUDE_ADMIN,
    });
    if (!d) throw new NotFoundException("Gasto não encontrado.");
    return d;
  }

  async detalhe(id: string, escopo: EscopoAdmin) {
    const d = await this.carregar(id, escopo);
    const sug = await this.sugestoes([d]);
    // "Este mês do Carlos: 6 gastos · R$ 410,00 · 1 não reembolsado".
    const mes = diaSP(d.data).slice(0, 7);
    const ini = inicioDoDiaBR(`${mes}-01`);
    const [a, m] = mes.split("-").map(Number) as [number, number];
    const fim = inicioDoDiaBR(m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`);
    const doMes = await this.prisma.despesa.findMany({
      where: { motoristaId: d.motoristaId, data: { gte: ini, lt: fim } },
      select: { status: true, valorInformado: true, decididoAutomatico: true },
    });
    return {
      ...this.paraPainel(d, sug.get(d.id)),
      doMes: {
        quantidade: doMes.length,
        total: doMes.reduce((s, x) => s + Number(x.valorInformado), 0).toFixed(2),
        naoReembolsados: doMes.filter((x) => x.status === "NAO_REEMBOLSADA" && !x.decididoAutomatico).length,
      },
    };
  }

  private exigirForaDeAcertoFechado(d: DespesaAdmin) {
    const fechado = d.itensAcerto.find((i) => i.acerto.status !== "ABERTO");
    if (fechado) {
      throw new ConflictException({
        code: "DESPESA_EM_ACERTO_FECHADO",
        message: "Este gasto já está num acerto fechado. Acerto fechado não muda — corrija no próximo acerto.",
      });
    }
  }

  private exigirComEscritorio(d: DespesaAdmin) {
    if (d.status !== "COM_ESCRITORIO") {
      const quem = d.decididoAutomatico ? "pela regra do tipo" : d.decididoPor ? `por ${d.decididoPor.nome}` : "";
      const quando = d.decididoEm ? ` em ${ddmm(d.decididoEm)}` : "";
      throw new ConflictException({
        code: "DESPESA_JA_DECIDIDA",
        message: `Este gasto já foi decidido ${quem}${quando}.`.replace(/\s+\./, "."),
      });
    }
  }

  async aprovar(id: string, input: AprovarDespesaInput, usuarioId: string, escopo: EscopoAdmin) {
    const d = await this.carregar(id, escopo);
    this.exigirComEscritorio(d);
    this.exigirForaDeAcertoFechado(d);
    const r = validarDecisao({
      acao: "APROVAR",
      valorInformado: Number(d.valorInformado),
      valorAprovado: input.valorAprovado,
      motivo: input.motivo,
    });
    if (!r.ok) throw new BadRequestException(r.erro);
    await this.prisma.despesa.update({
      where: { id },
      data: {
        status: "APROVADA",
        valorAprovado: new Prisma.Decimal(r.valorAprovado!.toFixed(2)),
        motivo: r.motivo,
        decididoPorId: usuarioId,
        decididoEm: new Date(),
        decididoAutomatico: false,
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Despesa",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "status",
      valorAntes: { status: d.status, valorAprovado: d.valorAprovado?.toFixed(2) ?? null },
      valorDepois: { status: "APROVADA", valorAprovado: r.valorAprovado!.toFixed(2) },
      motivo: r.motivo ?? "Gasto aprovado",
    });
    return this.detalhe(id, escopo);
  }

  async naoReembolsar(id: string, motivo: string, usuarioId: string, escopo: EscopoAdmin) {
    const d = await this.carregar(id, escopo);
    this.exigirComEscritorio(d);
    this.exigirForaDeAcertoFechado(d);
    const r = validarDecisao({ acao: "NAO_REEMBOLSAR", valorInformado: Number(d.valorInformado), motivo });
    if (!r.ok) throw new BadRequestException(r.erro);
    await this.prisma.despesa.update({
      where: { id },
      data: {
        status: "NAO_REEMBOLSADA",
        valorAprovado: null,
        motivo: r.motivo,
        decididoPorId: usuarioId,
        decididoEm: new Date(),
        decididoAutomatico: false,
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Despesa",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "status",
      valorAntes: { status: d.status },
      valorDepois: { status: "NAO_REEMBOLSADA" },
      motivo: r.motivo,
    });
    return this.detalhe(id, escopo);
  }

  /** O "Desfazer" do toast: volta pra fila. Só fora de acerto fechado. */
  async desfazer(id: string, usuarioId: string, escopo: EscopoAdmin) {
    const d = await this.carregar(id, escopo);
    this.exigirForaDeAcertoFechado(d);
    if (d.status === "COM_ESCRITORIO") return this.detalhe(id, escopo);
    await this.prisma.despesa.update({
      where: { id },
      data: {
        status: "COM_ESCRITORIO",
        valorAprovado: null,
        motivo: null,
        decididoPorId: null,
        decididoEm: null,
        decididoAutomatico: false,
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Despesa",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "status",
      valorAntes: { status: d.status },
      valorDepois: { status: "COM_ESCRITORIO" },
      motivo: "Decisão desfeita — voltou pra conferência",
    });
    return this.detalhe(id, escopo);
  }

  /**
   * Aprovar em lote: SÓ o que está com o escritório e sem nenhum ponto de
   * atenção — a regra é conferida de novo aqui (a tela pode estar velha).
   * O que não passar volta na lista `pulados`, com o porquê.
   */
  async aprovarLote(ids: string[], usuarioId: string, escopo: EscopoAdmin) {
    const linhas = await this.prisma.despesa.findMany({
      where: { id: { in: ids }, ...(escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {}) },
      include: INCLUDE_ADMIN,
    });
    const sug = await this.sugestoes(linhas);
    const aprovados: string[] = [];
    const pulados: { id: string; motivo: string }[] = [];
    for (const d of linhas) {
      const p = this.paraPainel(d, sug.get(d.id));
      if (d.status !== "COM_ESCRITORIO") {
        pulados.push({ id: d.id, motivo: "Já foi decidido." });
        continue;
      }
      if (!p.semAtencao || temAtencao(d.marcas)) {
        pulados.push({ id: d.id, motivo: "Tem ponto de atenção — confira um por um." });
        continue;
      }
      if (d.itensAcerto.some((i) => i.acerto.status !== "ABERTO")) {
        pulados.push({ id: d.id, motivo: "Já está num acerto fechado." });
        continue;
      }
      await this.prisma.despesa.update({
        where: { id: d.id },
        data: {
          status: "APROVADA",
          valorAprovado: d.valorInformado,
          motivo: null,
          decididoPorId: usuarioId,
          decididoEm: new Date(),
          decididoAutomatico: false,
        },
      });
      aprovados.push(d.id);
    }
    for (const id of ids) if (!linhas.some((l) => l.id === id)) pulados.push({ id, motivo: "Não encontrado." });
    if (aprovados.length) {
      await this.auditoria.log({
        usuarioId,
        entidade: "Despesa",
        entidadeId: aprovados[0]!,
        acao: AcaoAuditoria.UPDATE,
        campo: "status",
        motivo: `Aprovação em lote de ${aprovados.length} gasto(s)`,
        metadata: { ids: aprovados },
      });
    }
    return { aprovados: aprovados.length, pulados };
  }

  /**
   * O escritório liga (ou desliga, com `null`) o gasto a uma viagem. Não aprova
   * nada e não mexe no acerto (o vínculo nunca decide pagamento).
   */
  async vincular(id: string, viagemId: string | null, usuarioId: string, escopo: EscopoAdmin) {
    const d = await this.carregar(id, escopo);
    let veiculoId = d.veiculoId;
    if (viagemId) {
      const v = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: { id: true, motoristaId: true, veiculoId: true },
      });
      if (!v) throw new NotFoundException("Viagem não encontrada.");
      if (v.motoristaId !== d.motoristaId) {
        throw new BadRequestException("Essa viagem é de outro motorista.");
      }
      veiculoId = veiculoId ?? v.veiculoId;
    }
    await this.prisma.despesa.update({
      where: { id },
      data: {
        vinculo: viagemId ? "VIAGEM" : "SEM_RESPOSTA",
        vinculoPor: viagemId ? "ESCRITORIO" : null,
        vinculadoEm: new Date(),
        viagemId,
        viagemClientId: null,
        veiculoId,
        marcas: DespesasNucleoService.comMarca(d.marcas, "VIAGEM_NAO_ACHADA", false),
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Despesa",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "viagemId",
      valorAntes: d.viagemId,
      valorDepois: viagemId,
      motivo: viagemId ? "Escritório ligou o gasto à viagem" : "Escritório tirou o gasto da viagem",
    });
    return this.detalhe(id, escopo);
  }

  /** Cartão "Gastos desta viagem" na ficha da viagem. */
  async daViagem(viagemId: string, escopo: EscopoAdmin) {
    const linhas = await this.prisma.despesa.findMany({
      where: { viagemId, ...(escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {}) },
      include: INCLUDE_ADMIN,
      orderBy: { data: "asc" },
    });
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { motoristaId: true, data: true },
    });
    // Soltos do mesmo motorista no dia da viagem (±1): "Vincular gasto sem viagem".
    const soltos =
      viagem?.data != null
        ? await this.prisma.despesa.findMany({
            where: {
              motoristaId: viagem.motoristaId,
              vinculo: "SEM_RESPOSTA",
              data: {
                gte: new Date(inicioDoDiaBR(viagem.data.toISOString().slice(0, 10)).getTime() - 86_400_000),
                lt: new Date(inicioDoDiaBR(viagem.data.toISOString().slice(0, 10)).getTime() + 2 * 86_400_000),
              },
            },
            select: { id: true, tipoNome: true, valorInformado: true, data: true },
            orderBy: { data: "asc" },
          })
        : [];
    return {
      itens: linhas.map((d) => this.paraPainel(d, undefined)),
      total: linhas.reduce((s, d) => s + Number(d.valorInformado), 0).toFixed(2),
      soltos: soltos.map((s) => ({
        id: s.id,
        resumo: `${s.tipoNome} · ${brl(Number(s.valorInformado))} · ${ddmm(s.data)}`,
      })),
    };
  }

  /**
   * Pro aviso do acerto: "2 gastos ainda em conferência (R$ 72,40) não entram
   * neste acerto". Mesmo recorte de data do acerto (dia civil de SP).
   */
  async emConferencia(motoristaId: string, de: string, ate: string) {
    const r = await this.prisma.despesa.aggregate({
      where: {
        motoristaId,
        status: "COM_ESCRITORIO",
        tipoDespesa: { devolve: true },
        data: { gte: inicioDoDiaBR(de), lt: new Date(inicioDoDiaBR(ate).getTime() + 86_400_000) },
      },
      _count: { _all: true },
      _sum: { valorInformado: true },
    });
    return { quantidade: r._count._all, total: r._sum.valorInformado?.toFixed(2) ?? "0.00" };
  }

  async foto(id: string, fotoId: string, escopo: EscopoAdmin, mini: boolean) {
    await this.carregar(id, escopo);
    return this.nucleo.fotoBuffer(id, fotoId, mini);
  }

  async girarFoto(id: string, fotoId: string, rotacao: number, escopo: EscopoAdmin) {
    await this.carregar(id, escopo);
    const r = await this.prisma.despesaFoto.updateMany({ where: { id: fotoId, despesaId: id }, data: { rotacao } });
    if (!r.count) throw new NotFoundException("Foto não encontrada");
    return { ok: true };
  }
}
