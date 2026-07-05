import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AcaoAuditoria,
  Prisma,
  StatusEnvio,
  StatusFechamento,
} from "@prisma/client";
import ExcelJS from "exceljs";
import { AuditoriaService } from "../auditoria/auditoria.service";
import {
  aplicarMinimos,
  resolverRegraMinimo,
  type MinimoOverride,
} from "../common/viagem-minimos";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { paginate, type PaginationQuery } from "../common/pagination";
import type { ColunaLayout, ConfigLayout } from "./layout-envio.service";

type ListEnviosParams = PaginationQuery & {
  empresaId?: string;
  status?: StatusEnvio;
};

type ViagemFull = Prisma.ViagemGetPayload<{
  include: {
    veiculo: true;
    cliente: true;
    material: true;
    motorista: { select: { id: true; nome: true } };
    localCarga: { select: { nome: true; cidade: true; uf: true } };
    localDescarga: { select: { nome: true; cidade: true; uf: true } };
  };
}>;

@Injectable()
export class ExportFechamentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Gera XLSX a partir de um Fechamento existente (empresa MANDOU planilha,
   * conferimos, exportamos de volta). As linhas vem das FechamentoLinha.viagemMatch.
   */
  async gerar(input: {
    usuarioId: string;
    fechamentoId: string;
    layoutEnvioId?: string;
  }) {
    const fechamento = await this.prisma.fechamento.findUnique({
      where: { id: input.fechamentoId },
      include: {
        empresa: { include: { layoutsEnvio: { where: { padrao: true } } } },
        linhas: {
          include: {
            viagemMatch: {
              include: {
                veiculo: true,
                cliente: true,
                material: true,
                motorista: { select: { id: true, nome: true } },
                localCarga: { select: { nome: true, cidade: true, uf: true } },
                localDescarga: { select: { nome: true, cidade: true, uf: true } },
              },
            },
          },
          orderBy: { ordem: "asc" },
        },
      },
    });
    if (!fechamento) throw new NotFoundException("Fechamento não encontrado");

    const layoutId = input.layoutEnvioId ?? fechamento.empresa.layoutsEnvio[0]?.id;
    const layout = await this.carregarLayout(layoutId, fechamento.empresaId);

    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });
    const linhasParaExport = fechamento.linhas
      .filter((l) => l.viagemMatch !== null)
      .map((l) => {
        const viagem = l.viagemMatch as ViagemFull;
        return {
          viagem,
          valorTotal: l.valor ? Number(l.valor) : null,
          override: comOverride(regras, viagem),
        };
      });

    const buffer = await montarXlsx({
      empresaNome: fechamento.empresa.nome,
      periodoInicio: fechamento.periodoInicio,
      periodoFim: fechamento.periodoFim,
      linhas: linhasParaExport,
      layout,
    });
    const nomeArquivo = `${fechamento.empresa.nome.replace(/\s+/g, "_")}_${fmtDataISO(fechamento.periodoInicio)}_v${fechamento.versao}.xlsx`;

    const key = await this.uploads.putFechamentoExportado(buffer, nomeArquivo, fechamento.id);

    const envio = await this.prisma.envioFechamento.create({
      data: {
        fechamentoId: fechamento.id,
        empresaId: fechamento.empresaId,
        periodoInicio: fechamento.periodoInicio,
        periodoFim: fechamento.periodoFim,
        totalLinhas: linhasParaExport.length,
        layoutId: layout.id,
        arquivoGeradoKey: key,
        arquivoNome: nomeArquivo,
        geradoPorId: input.usuarioId,
        status: StatusEnvio.GERADO,
      },
    });

    await this.prisma.fechamento.update({
      where: { id: fechamento.id },
      data: { status: StatusFechamento.EXPORTADO },
    });

    await this.auditoria.log({
      usuarioId: input.usuarioId,
      entidade: "Fechamento",
      entidadeId: fechamento.id,
      acao: AcaoAuditoria.EXPORTAR,
      metadata: { envioId: envio.id, layout: layout.nome },
    });

    return { envio, arquivoNome: nomeArquivo };
  }

  /**
   * Gera XLSX standalone — pra empresa que SÓ RECEBE planilha (não manda).
   * Busca viagens das obras dessa empresa no período, com status OK/AJUSTADA/ENVIADA.
   */
  async gerarStandalone(input: {
    usuarioId: string;
    empresaId: string;
    periodoInicio: string;
    periodoFim: string;
    layoutEnvioId?: string;
    clienteIds?: string[];
  }) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: input.empresaId },
      include: { layoutsEnvio: { where: { padrao: true } } },
    });
    if (!empresa) throw new NotFoundException("Empresa não encontrada");

    const periodoInicio = new Date(input.periodoInicio);
    const periodoFim = new Date(input.periodoFim);
    if (Number.isNaN(periodoInicio.getTime()) || Number.isNaN(periodoFim.getTime())) {
      throw new BadRequestException("Período inválido");
    }

    const layoutId = input.layoutEnvioId ?? empresa.layoutsEnvio[0]?.id;
    const layout = await this.carregarLayout(layoutId, empresa.id);

    const filtroCliente =
      input.clienteIds && input.clienteIds.length > 0
        ? { empresaId: empresa.id, id: { in: input.clienteIds } }
        : { empresaId: empresa.id };
    const viagens = await this.prisma.viagem.findMany({
      where: {
        cliente: filtroCliente,
        data: { gte: periodoInicio, lte: periodoFim },
        status: { in: ["ENVIADA", "OK", "AJUSTADA"] },
      },
      include: {
        veiculo: true,
        cliente: true,
        material: true,
        motorista: { select: { id: true, nome: true } },
        localCarga: { select: { nome: true, cidade: true, uf: true } },
        localDescarga: { select: { nome: true, cidade: true, uf: true } },
      },
      orderBy: [{ data: "asc" }, { ticket: "asc" }],
    });

    if (viagens.length === 0) {
      const sufixo =
        input.clienteIds && input.clienteIds.length > 0
          ? ` nos ${input.clienteIds.length} cliente(s) selecionado(s)`
          : "";
      throw new BadRequestException(
        `Nenhuma viagem encontrada pra ${empresa.nome}${sufixo} entre ${input.periodoInicio} e ${input.periodoFim}.`,
      );
    }

    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });
    const linhasParaExport = viagens.map((v) => {
      const viagem = v as ViagemFull;
      return {
        viagem,
        // valor unitário do contrato vezes toneladas (aproximação) — sem fechamento real
        valorTotal: null as number | null,
        override: comOverride(regras, viagem),
      };
    });

    const buffer = await montarXlsx({
      empresaNome: empresa.nome,
      periodoInicio,
      periodoFim,
      linhas: linhasParaExport,
      layout,
    });
    const nomeArquivo = `${empresa.nome.replace(/\s+/g, "_")}_${fmtDataISO(periodoInicio)}.xlsx`;

    // putFechamentoExportado assume um fechamentoId pra organizar no MinIO.
    // Pra envio standalone usamos um prefixo "standalone-empresaId".
    const key = await this.uploads.putFechamentoExportado(
      buffer,
      nomeArquivo,
      `standalone-${empresa.id}`,
    );

    const envio = await this.prisma.envioFechamento.create({
      data: {
        fechamentoId: null,
        empresaId: empresa.id,
        periodoInicio,
        periodoFim,
        totalLinhas: linhasParaExport.length,
        layoutId: layout.id,
        arquivoGeradoKey: key,
        arquivoNome: nomeArquivo,
        geradoPorId: input.usuarioId,
        status: StatusEnvio.GERADO,
      },
    });

    await this.auditoria.log({
      usuarioId: input.usuarioId,
      entidade: "Envio",
      entidadeId: envio.id,
      acao: AcaoAuditoria.EXPORTAR,
      metadata: {
        empresa: empresa.nome,
        periodo: `${input.periodoInicio} a ${input.periodoFim}`,
        totalLinhas: linhasParaExport.length,
        layout: layout.nome,
      },
    });

    return { envio, arquivoNome: nomeArquivo, totalLinhas: linhasParaExport.length };
  }

  listar(params: ListEnviosParams) {
    const where: Prisma.EnvioFechamentoWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status;

    return paginate(this.prisma.envioFechamento, {
      params,
      where: where as Record<string, unknown>,
      searchFields: ["arquivoNome", "canalEnvio", "empresa.nome"],
      sortable: {
        geradoEm: "geradoEm",
        marcadoEnviadoEm: "marcadoEnviadoEm",
        status: "status",
        empresa: "empresa.nome",
        arquivoNome: "arquivoNome",
      },
      defaultSort: { field: "geradoEm", order: "desc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        fechamento: {
          select: { id: true, versao: true, periodoInicio: true, periodoFim: true },
        },
        layout: { select: { id: true, nome: true } },
        geradoPor: { select: { id: true, nome: true } },
      },
    });
  }

  async baixar(envioId: string) {
    const envio = await this.prisma.envioFechamento.findUnique({ where: { id: envioId } });
    if (!envio) throw new NotFoundException("Envio não encontrado");
    const buffer = await this.uploads.getObjectBuffer(envio.arquivoGeradoKey);
    return { buffer, nome: envio.arquivoNome };
  }

  /**
   * Hard delete do envio. Apaga arquivo do MinIO. Permitido em qualquer status —
   * envios marcados como ENVIADO continuam excluíveis (admin pode querer
   * limpar histórico antigo).
   */
  async excluir(envioId: string) {
    const envio = await this.prisma.envioFechamento.findUnique({ where: { id: envioId } });
    if (!envio) throw new NotFoundException("Envio não encontrado");
    await this.uploads.removeObject(envio.arquivoGeradoKey);
    await this.prisma.envioFechamento.delete({ where: { id: envioId } });
    return { ok: true };
  }

  async marcarEnviado(input: {
    usuarioId: string;
    envioId: string;
    canalEnvio: string;
    observacao?: string;
    fechamentoId?: string; // opcional — só pra validar quando vier de fluxo de fechamento
  }) {
    const envio = await this.prisma.envioFechamento.findUnique({
      where: { id: input.envioId },
    });
    if (!envio) throw new NotFoundException("Envio não encontrado");
    if (input.fechamentoId && envio.fechamentoId !== input.fechamentoId) {
      throw new BadRequestException("Envio é de outro fechamento");
    }

    const atualizado = await this.prisma.envioFechamento.update({
      where: { id: input.envioId },
      data: {
        status: StatusEnvio.ENVIADO,
        marcadoEnviadoEm: new Date(),
        canalEnvio: input.canalEnvio,
        observacao: input.observacao ?? null,
      },
    });

    await this.auditoria.log({
      usuarioId: input.usuarioId,
      entidade: envio.fechamentoId ? "Fechamento" : "Envio",
      entidadeId: envio.fechamentoId ?? envio.id,
      acao: AcaoAuditoria.MARCAR_ENVIADO,
      motivo: input.observacao ?? null,
      metadata: { envioId: envio.id, canal: input.canalEnvio },
    });

    return atualizado;
  }

  // ---------- helpers privados ----------

  private async carregarLayout(layoutId: string | undefined, empresaId: string) {
    if (!layoutId) {
      throw new BadRequestException(
        "Empresa não tem layout de envio configurado. Configure em Empresas → Layout de envio.",
      );
    }
    const layout = await this.prisma.layoutEnvio.findUnique({ where: { id: layoutId } });
    if (!layout) throw new NotFoundException("Layout não encontrado");
    if (layout.empresaId !== empresaId) {
      throw new BadRequestException("Layout pertence a outra empresa");
    }
    return layout;
  }
}

// ====== utilities de geração de XLSX ======

type LinhaExport = {
  viagem: ViagemFull;
  valorTotal: number | null;
  // Mínimo por faixa já resolvido (empresa+material+km) — vence o do cliente.
  override: MinimoOverride | null;
};

/** Resolve o override de mínimo por faixa pra cada viagem que vai pro XLSX. */
function comOverride(
  regras: Parameters<typeof resolverRegraMinimo>[0],
  viagem: ViagemFull,
): MinimoOverride | null {
  // Viagens exportadas são finalizadas; EM_ANDAMENTO/AGUARDANDO_PESO (incompletas)
  // nunca entram no match, então nunca chegam aqui.
  return resolverRegraMinimo(
    regras,
    viagem.cliente?.empresaId ?? "",
    viagem.material?.id ?? null,
    viagem.km ?? 0,
  );
}

async function montarXlsx(input: {
  empresaNome: string;
  periodoInicio: Date;
  periodoFim: Date;
  linhas: LinhaExport[];
  layout: { colunas: Prisma.JsonValue; config: Prisma.JsonValue | null; nome: string; id: string };
}): Promise<Buffer> {
  const colunas = (input.layout.colunas as unknown as ColunaLayout[]).slice().sort(
    (a, b) => a.ordem - b.ordem,
  );
  const config = (input.layout.config as unknown as ConfigLayout | null) ?? {};

  const wb = new ExcelJS.Workbook();
  wb.creator = "Ronan";
  wb.created = new Date();
  const ws = wb.addWorksheet("Viagens");

  let row = 1;
  if (config.incluiCabecalhoEmpresa) {
    ws.mergeCells(row, 1, row, colunas.length);
    ws.getCell(row, 1).value = input.empresaNome;
    ws.getCell(row, 1).font = { bold: true, size: 14 };
    row++;
    ws.mergeCells(row, 1, row, colunas.length);
    ws.getCell(row, 1).value = `Período: ${fmtDataBR(input.periodoInicio)} a ${fmtDataBR(input.periodoFim)}`;
    row++;
    row++; // linha em branco
  }

  ws.getRow(row).values = colunas.map((c) => c.header);
  ws.getRow(row).font = { bold: true };
  ws.getRow(row).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  row++;

  for (const linha of input.linhas) {
    const valores = colunas.map((c) =>
      valorParaColuna(c, linha.viagem, linha.valorTotal, config, linha.override),
    );
    ws.getRow(row).values = valores;
    row++;
  }

  if (config.totaisRodape) {
    row++;
    ws.getCell(row, 1).value = "TOTAL";
    ws.getCell(row, 1).font = { bold: true };
    for (let i = 0; i < colunas.length; i++) {
      const c = colunas[i];
      if (
        c.formato === "decimal_br" ||
        c.formato === "currency_br" ||
        c.campo === "valor_total" ||
        c.campo === "toneladas" ||
        c.campo === "km" ||
        c.campo === "valor_pedagio"
      ) {
        const total = input.linhas.reduce((acc, l) => {
          const v = valorParaColuna(c, l.viagem, l.valorTotal, config, l.override);
          return acc + (typeof v === "number" ? v : 0);
        }, 0);
        ws.getCell(row, i + 1).value = total;
        ws.getCell(row, i + 1).font = { bold: true };
      }
    }
  }

  colunas.forEach((c, idx) => {
    ws.getColumn(idx + 1).width = sugerirLargura(c);
    const numFmt = formatoExcel(c, config);
    if (numFmt) ws.getColumn(idx + 1).numFmt = numFmt;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function valorParaColuna(
  coluna: ColunaLayout,
  viagem: ViagemFull,
  valorTotalLinha: number | null,
  config: ConfigLayout,
  override: MinimoOverride | null,
): string | number | Date | null {
  switch (coluna.campo) {
    case "data":
      // Viagem exportada é finalizada; incompleta (sem data/peso) nunca chega aqui.
      return config.formatoData === "YYYY-MM-DD"
        ? fmtDataISO(viagem.data!)
        : config.formatoData === "DD/MM/YY"
        ? fmtDataBR(viagem.data!, true)
        : fmtDataBR(viagem.data!);
    case "placa":
      return viagem.veiculo.placa;
    case "modelo":
      return viagem.veiculo.modelo ?? "";
    case "motorista":
      return viagem.motorista.nome;
    case "ticket":
      return viagem.ticket;
    case "cliente":
      return viagem.cliente?.nome ?? "";
    case "material":
      return viagem.material?.nome ?? "";
    case "toneladas":
      return Number(aplicarMinimos(viagem, override ?? undefined).toneladasEfetiva);
    case "km":
      return Number(aplicarMinimos(viagem, override ?? undefined).kmEfetivo);
    case "valor_pedagio":
      return viagem.valorPedagioTotal ? Number(viagem.valorPedagioTotal) : 0;
    case "valor_total":
      return valorTotalLinha ?? 0;
    case "local_carga":
      return `${viagem.localCarga?.nome ?? ""} (${viagem.localCarga?.cidade ?? ""}/${viagem.localCarga?.uf ?? ""})`;
    case "local_descarga":
      return `${viagem.localDescarga?.nome ?? ""} (${viagem.localDescarga?.cidade ?? ""}/${viagem.localDescarga?.uf ?? ""})`;
    default:
      return null;
  }
}

function fmtDataBR(d: Date, ano2 = false): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return ano2 ? `${dd}/${mm}/${String(yyyy).slice(-2)}` : `${dd}/${mm}/${yyyy}`;
}

function fmtDataISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sugerirLargura(c: ColunaLayout): number {
  if (c.campo === "data") return 12;
  if (c.campo === "placa") return 12;
  if (c.campo === "ticket") return 14;
  if (c.campo === "cliente" || c.campo === "local_carga" || c.campo === "local_descarga") return 30;
  if (c.campo === "motorista") return 20;
  if (c.campo === "material") return 24;
  if (c.campo === "toneladas" || c.campo === "km") return 11;
  if (c.campo === "valor_total" || c.campo === "valor_pedagio") return 14;
  return 18;
}

function formatoExcel(c: ColunaLayout, _config: ConfigLayout): string | null {
  if (c.formato === "decimal_br") return "#,##0.00";
  if (c.formato === "currency_br") return '"R$" #,##0.00';
  if (c.campo === "toneladas") return "#,##0.000";
  if (c.campo === "km") return "#,##0.00";
  if (c.campo === "valor_total" || c.campo === "valor_pedagio") return '"R$" #,##0.00';
  return null;
}
