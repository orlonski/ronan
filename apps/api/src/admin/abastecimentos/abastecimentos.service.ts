import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, type Prisma, type TipoCombustivel } from "@prisma/client";
import type { AtualizarAbastecimentoInput } from "@ronan/shared-types";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";
import { UploadsService } from "../../uploads/uploads.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { inicioDoDiaBR } from "../../common/timezone";

type ListAbastecimentosParams = PaginationQuery & {
  motoristaId?: string;
  veiculoId?: string;
  empresaId?: string;
  semEmpresa?: "true" | "false";
  transportadoraId?: string;
  tipo?: TipoCombustivel;
  /** Nome exato do posto, sem diferenciar caixa. Usado pelo drill-down do relatório. */
  posto?: string;
  semPosto?: "true" | "false";
  de?: string;
  ate?: string;
};

@Injectable()
export class AbastecimentosAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly auditoria: AuditoriaService,
    private readonly push: PushService,
  ) {}

  async list(params: ListAbastecimentosParams, escopo: EscopoAdmin) {
    const where: Prisma.AbastecimentoWhereInput = {};
    if (params.motoristaId) where.motoristaId = params.motoristaId;
    if (params.veiculoId) where.veiculoId = params.veiculoId;
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.semEmpresa === "true") where.empresaId = null;
    if (params.transportadoraId) where.transportadoraId = params.transportadoraId;
    if (params.tipo) where.tipo = params.tipo;
    // Posto é texto livre: comparação exata mas insensível a caixa, igual à
    // chave de agrupamento do relatório — senão o drill-down de "Posto Shell"
    // volta vazio porque o motorista digitou "posto shell".
    if (params.posto) where.postoNome = { equals: params.posto, mode: "insensitive" };
    // O grupo "(sem posto informado)" junta null e string vazia/em branco.
    if (params.semPosto === "true") {
      where.OR = [{ postoNome: null }, { postoNome: { equals: "" } }];
    }
    if (params.de || params.ate) {
      // data é timestamp: ancorar nas fronteiras do dia civil de Brasília.
      // `lt` no dia seguinte do "ate" pra incluir o último dia inteiro.
      where.data = {};
      if (params.de) where.data.gte = inicioDoDiaBR(params.de);
      if (params.ate) where.data.lt = new Date(inicioDoDiaBR(params.ate).getTime() + 86_400_000);
    }

    const [paged, totais] = await Promise.all([
      paginate(this.prisma.abastecimento, {
        params,
        where: where as Record<string, unknown>,
        escopo,
        searchFields: ["postoNome", "observacao", "motorista.nome", "veiculo.placa", "empresa.nome"],
        sortable: {
          data: "data",
          tipo: "tipo",
          litros: "litros",
          valorTotal: "valorTotal",
          odometro: "odometro",
          motorista: "motorista.nome",
          placa: "veiculo.placa",
          empresa: "empresa.nome",
        },
        defaultSort: { field: "data", order: "desc" },
        include: {
          veiculo: { select: { id: true, placa: true, modelo: true } },
          motorista: { select: { id: true, nome: true } },
          empresa: { select: { id: true, nome: true } },
          _count: { select: { fotos: true } },
        },
      }),
      this.prisma.abastecimento.aggregate({
        // Os totais precisam do MESMO escopo do paginate — senão viriam da base
        // inteira ao lado dos dados filtrados, na mesma resposta HTTP.
        where: { ...where, ...filtroEscopo(escopo) },
        _count: { _all: true },
        _sum: { litros: true, valorTotal: true },
      }),
    ]);

    return {
      ...paged,
      totais: {
        count: totais._count._all,
        litros: (totais._sum.litros ?? "0").toString(),
        valor: (totais._sum.valorTotal ?? "0").toString(),
      },
    };
  }

  async detalhe(id: string) {
    const a = await this.prisma.abastecimento.findUnique({
      where: { id },
      include: {
        veiculo: true,
        motorista: { select: { id: true, nome: true, cpf: true } },
        empresa: { select: { id: true, nome: true } },
        fotos: true,
      },
    });
    if (!a) throw new NotFoundException("Abastecimento não encontrado");
    return a;
  }

  /**
   * Hard delete do abastecimento. Bloqueado se há linha de fechamento usando
   * abastecimentoMatchId. AbastecimentoFoto sai cascade.
   */
  async excluir(id: string) {
    const a = await this.prisma.abastecimento.findUnique({
      where: { id },
      select: { id: true, fotos: { select: { storageKey: true } } },
    });
    if (!a) throw new NotFoundException("Abastecimento não encontrado");

    const linhasMatch = await this.prisma.fechamentoLinha.count({
      where: { abastecimentoMatchId: id },
    });
    if (linhasMatch > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${linhasMatch} linha${linhasMatch === 1 ? "" : "s"} de fechamento.`,
      );
    }

    await Promise.all(
      a.fotos.map((f) => this.uploads.removeObject(f.storageKey)),
    );
    await this.prisma.abastecimento.delete({ where: { id } });
    return { ok: true };
  }

  async fotoBuffer(abastecimentoId: string, fotoId: string) {
    const foto = await this.prisma.abastecimentoFoto.findFirst({
      where: { id: fotoId, abastecimentoId },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    return { buffer, contentType };
  }

  async rotacionarFoto(abastecimentoId: string, fotoId: string, rotacao: number) {
    const foto = await this.prisma.abastecimentoFoto.findFirst({
      where: { id: fotoId, abastecimentoId },
      select: { id: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    return this.prisma.abastecimentoFoto.update({
      where: { id: fotoId },
      data: { rotacao },
    });
  }

  /**
   * Edita um abastecimento (admin dashboard). Espelha o padrão da viagem:
   * snapshot antes/depois, enriquece FK com nomes, registra logDiff
   * (1 log por campo alterado), notifica motorista com resumo.
   */
  async atualizar(id: string, input: AtualizarAbastecimentoInput, usuarioId: string) {
    const antes = await this.prisma.abastecimento.findUnique({
      where: { id },
      include: { _count: { select: { fechamentoLinhas: true } } },
    });
    if (!antes) throw new NotFoundException("Abastecimento não encontrado");
    if (antes._count.fechamentoLinhas > 0) {
      throw new ConflictException(
        "Não é possível editar: abastecimento já vinculado a fechamento. Desfaça o match primeiro.",
      );
    }

    // precoLitro é derivado de litros + valorTotal. Recalcula quando algum
    // dos dois muda. Em comboio (valorTotal null), precoLitro = null.
    const litrosNovo = input.litros ?? Number(antes.litros);
    const valorTotalNovo =
      input.valorTotal !== undefined ? input.valorTotal : antes.valorTotal != null ? Number(antes.valorTotal) : null;
    const precoLitroNovo =
      valorTotalNovo != null && litrosNovo > 0 ? valorTotalNovo / litrosNovo : null;

    const depois = await this.prisma.abastecimento.update({
      where: { id },
      data: {
        ...input,
        // valorTotal vem como `null | number | undefined` no input
        // (preserva semântica de "limpar" vs "não mexer"). Prisma aceita
        // null direto pra anular o campo.
        precoLitro: precoLitroNovo,
      },
    });

    const { _count: _ignored, ...antesPlain } = antes;
    const [antesEnriquecido, depoisEnriquecido] = await Promise.all([
      this.enriquecerCamposFK(antesPlain),
      this.enriquecerCamposFK(depois),
    ]);

    await this.auditoria.logDiff(
      { usuarioId, entidade: "Abastecimento", entidadeId: id, acao: AcaoAuditoria.UPDATE },
      antesEnriquecido,
      depoisEnriquecido,
    );

    const diffs = computarDiffAbastecimento(antesEnriquecido, depoisEnriquecido);
    if (diffs.length > 0) {
      void this.notificarMotorista({
        abastecimentoId: id,
        titulo: "Seu abastecimento foi editado",
        corpo: corpoDoDiff(diffs),
        dados: { diffs },
        criadoPorId: usuarioId,
      });
    }

    return this.detalhe(id);
  }

  async historico(abastecimentoId: string) {
    const a = await this.prisma.abastecimento.findUnique({ where: { id: abastecimentoId } });
    if (!a) throw new NotFoundException("Abastecimento não encontrado");
    return this.auditoria.historicoDe("Abastecimento", abastecimentoId);
  }

  private async notificarMotorista(args: {
    abastecimentoId: string;
    titulo: string;
    corpo: string;
    dados?: Record<string, unknown>;
    criadoPorId: string;
  }): Promise<void> {
    try {
      const ab = await this.prisma.abastecimento.findUnique({
        where: { id: args.abastecimentoId },
        select: {
          motoristaId: true,
          motorista: { select: { expoPushToken: true } },
        },
      });
      if (!ab) return;
      const token = ab.motorista?.expoPushToken;
      await this.push.enviar({
        motoristaId: ab.motoristaId,
        token: token ?? "",
        titulo: args.titulo,
        corpo: args.corpo,
        dados: { ...(args.dados ?? {}), abastecimentoId: args.abastecimentoId },
        tipo: "abastecimento-editado",
        criadoPorId: args.criadoPorId,
      });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Enriquece FK do abastecimento pra log/notificação legível.
   * Substitui id "uuid" por { id, nome|placa } onde aplicável.
   */
  private async enriquecerCamposFK(
    abastecimento: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...abastecimento };
    const veiculoId = typeof out.veiculoId === "string" ? out.veiculoId : null;
    const empresaId = typeof out.empresaId === "string" ? out.empresaId : null;

    const [veiculo, empresa] = await Promise.all([
      veiculoId
        ? this.prisma.veiculo.findUnique({
            where: { id: veiculoId },
            select: { placa: true },
          })
        : null,
      empresaId
        ? this.prisma.empresa.findUnique({
            where: { id: empresaId },
            select: { nome: true },
          })
        : null,
    ]);

    if (veiculoId) out.veiculoId = { id: veiculoId, placa: veiculo?.placa ?? null };
    if (empresaId) out.empresaId = { id: empresaId, nome: empresa?.nome ?? null };

    return out;
  }
}

// ===== Helpers de diff pra notificação =====

const CAMPOS_IGNORADOS_NOTIF_ABA = new Set([
  "id",
  "clientId",
  "motoristaId",
  "alteradoEm",
  "sincronizadoEm",
  "criadoEm",
  "criadoOfflineEm",
  "lat",
  "lng",
  "precisao",
  "precoLitro", // derivado (mostramos só litros + valorTotal)
]);

const LABEL_CAMPO_ABA: Record<string, string> = {
  data: "Data",
  tipo: "Tipo",
  litros: "Litros",
  valorTotal: "Valor",
  emComboio: "Em comboio",
  odometro: "Odômetro",
  postoNome: "Posto",
  tanqueCheio: "Tanque cheio",
  observacao: "Observação",
  veiculoId: "Veículo",
  empresaId: "Empresa",
};

type DiffCampoAba = { campo: string; label: string; antes: unknown; depois: unknown };

function computarDiffAbastecimento(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
): DiffCampoAba[] {
  const fields = new Set<string>([...Object.keys(antes), ...Object.keys(depois)]);
  const diffs: DiffCampoAba[] = [];
  for (const f of fields) {
    if (CAMPOS_IGNORADOS_NOTIF_ABA.has(f)) continue;
    if (JSON.stringify(antes[f]) === JSON.stringify(depois[f])) continue;
    diffs.push({
      campo: f,
      label: LABEL_CAMPO_ABA[f] ?? f,
      antes: antes[f],
      depois: depois[f],
    });
  }
  return diffs;
}

function formatarValorDiff(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object" && v !== null) {
    if ("nome" in v && typeof (v as { nome: unknown }).nome === "string") {
      return (v as { nome: string }).nome;
    }
    if ("placa" in v && typeof (v as { placa: unknown }).placa === "string") {
      return (v as { placa: string }).placa;
    }
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }
  return String(v);
}

function corpoDoDiff(diffs: DiffCampoAba[]): string {
  if (diffs.length === 0) return "Seu abastecimento foi atualizado.";
  const partes = diffs
    .slice(0, 2)
    .map((d) => `${d.label}: ${formatarValorDiff(d.antes)} → ${formatarValorDiff(d.depois)}`);
  let corpo = partes.join("; ");
  const extras = diffs.length - partes.length;
  if (extras > 0) corpo += ` (+${extras} ${extras === 1 ? "mudança" : "mudanças"})`;
  return corpo;
}
