import {
  BadRequestException,
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
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import type { ColunaLayout, ConfigLayout } from "./layout-envio.service";

@Injectable()
export class ExportFechamentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async gerar(input: {
    usuarioId: string;
    fechamentoId: string;
    layoutEnvioId?: string;
  }) {
    const fechamento = await this.prisma.fechamento.findUnique({
      where: { id: input.fechamentoId },
      include: {
        empresaCliente: { include: { layoutsEnvio: { where: { padrao: true } } } },
        linhas: {
          include: {
            viagemMatch: {
              include: {
                veiculo: true,
                obra: true,
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

    const layoutId = input.layoutEnvioId ?? fechamento.empresaCliente.layoutsEnvio[0]?.id;
    if (!layoutId) {
      throw new BadRequestException(
        "Empresa não tem layout de envio configurado. Configure em Empresas → Layout de envio.",
      );
    }

    const layout = await this.prisma.layoutEnvio.findUnique({ where: { id: layoutId } });
    if (!layout) throw new NotFoundException("Layout não encontrado");
    if (layout.empresaId !== fechamento.empresaClienteId) {
      throw new BadRequestException("Layout pertence a outra empresa");
    }

    const colunas = (layout.colunas as unknown as ColunaLayout[]).slice().sort(
      (a, b) => a.ordem - b.ordem,
    );
    const config = (layout.config as unknown as ConfigLayout | null) ?? {};

    const wb = new ExcelJS.Workbook();
    wb.creator = "Ronan";
    wb.created = new Date();

    const ws = wb.addWorksheet("Viagens");

    // cabeçalho da empresa
    let row = 1;
    if (config.incluiCabecalhoEmpresa) {
      ws.mergeCells(row, 1, row, colunas.length);
      ws.getCell(row, 1).value = fechamento.empresaCliente.nome;
      ws.getCell(row, 1).font = { bold: true, size: 14 };
      row++;
      ws.mergeCells(row, 1, row, colunas.length);
      ws.getCell(row, 1).value = `Período: ${fmtDataBR(fechamento.periodoInicio)} a ${fmtDataBR(fechamento.periodoFim)}`;
      row++;
      row++; // linha em branco
    }

    // header
    ws.getRow(row).values = colunas.map((c) => c.header);
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2E8F0" },
    };
    row++;

    // linhas de dados (só viagens conferidas / OK / ajustadas)
    const linhasValidas = fechamento.linhas.filter((l) => l.viagemMatch);
    for (const linha of linhasValidas) {
      const v = linha.viagemMatch!;
      const valores = colunas.map((c) => valorParaColuna(c, v, linha, config));
      ws.getRow(row).values = valores;
      row++;
    }

    // totais (rodapé)
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
          const total = linhasValidas.reduce((acc, l) => {
            const v = valorParaColuna(c, l.viagemMatch!, l, config);
            return acc + (typeof v === "number" ? v : 0);
          }, 0);
          ws.getCell(row, i + 1).value = total;
          ws.getCell(row, i + 1).font = { bold: true };
        }
      }
    }

    // formatação de colunas (largura, formato número)
    colunas.forEach((c, idx) => {
      ws.getColumn(idx + 1).width = sugerirLargura(c);
      const numFmt = formatoExcel(c, config);
      if (numFmt) {
        ws.getColumn(idx + 1).numFmt = numFmt;
      }
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const nomeArquivo = `${fechamento.empresaCliente.nome.replace(/\s+/g, "_")}_${fmtDataISO(fechamento.periodoInicio)}_v${fechamento.versao}.xlsx`;

    const key = await this.uploads.putFechamentoExportado(
      buffer,
      nomeArquivo,
      fechamento.id,
    );

    const envio = await this.prisma.envioFechamento.create({
      data: {
        fechamentoId: fechamento.id,
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

  async baixar(envioId: string) {
    const envio = await this.prisma.envioFechamento.findUnique({ where: { id: envioId } });
    if (!envio) throw new NotFoundException("Envio não encontrado");
    const buffer = await this.uploads.getObjectBuffer(envio.arquivoGeradoKey);
    return { buffer, nome: envio.arquivoNome };
  }

  async marcarEnviado(input: {
    usuarioId: string;
    fechamentoId: string;
    envioId: string;
    canalEnvio: string;
    observacao?: string;
  }) {
    const envio = await this.prisma.envioFechamento.findUnique({
      where: { id: input.envioId },
    });
    if (!envio) throw new NotFoundException("Envio não encontrado");
    if (envio.fechamentoId !== input.fechamentoId) {
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
      entidade: "Fechamento",
      entidadeId: input.fechamentoId,
      acao: AcaoAuditoria.MARCAR_ENVIADO,
      motivo: input.observacao ?? null,
      metadata: { envioId: envio.id, canal: input.canalEnvio },
    });

    return atualizado;
  }
}

type ViagemFull = NonNullable<
  NonNullable<
    Awaited<ReturnType<ExportFechamentoService["gerar"]>>
  >
> extends never
  ? never
  : never;

function valorParaColuna(
  coluna: ColunaLayout,
  viagem: {
    data: Date;
    ticket: string;
    km: Prisma.Decimal;
    toneladas: Prisma.Decimal;
    valorPedagioTotal: Prisma.Decimal | null;
    veiculo: { placa: string; modelo: string | null };
    obra: { nome: string };
    material: { nome: string };
    motorista: { nome: string };
    localCarga: { nome: string; cidade: string; uf: string };
    localDescarga: { nome: string; cidade: string; uf: string };
  },
  linha: { valor: Prisma.Decimal | null },
  config: ConfigLayout,
): string | number | Date | null {
  switch (coluna.campo) {
    case "data":
      return config.formatoData === "YYYY-MM-DD"
        ? fmtDataISO(viagem.data)
        : config.formatoData === "DD/MM/YY"
        ? fmtDataBR(viagem.data, true)
        : fmtDataBR(viagem.data);
    case "placa":
      return viagem.veiculo.placa;
    case "modelo":
      return viagem.veiculo.modelo ?? "";
    case "motorista":
      return viagem.motorista.nome;
    case "ticket":
      return viagem.ticket;
    case "obra":
      return viagem.obra.nome;
    case "material":
      return viagem.material.nome;
    case "toneladas":
      return Number(viagem.toneladas);
    case "km":
      return Number(viagem.km);
    case "valor_pedagio":
      return viagem.valorPedagioTotal ? Number(viagem.valorPedagioTotal) : 0;
    case "valor_total":
      return linha.valor ? Number(linha.valor) : 0;
    case "local_carga":
      return `${viagem.localCarga.nome} (${viagem.localCarga.cidade}/${viagem.localCarga.uf})`;
    case "local_descarga":
      return `${viagem.localDescarga.nome} (${viagem.localDescarga.cidade}/${viagem.localDescarga.uf})`;
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
  if (c.campo === "obra" || c.campo === "local_carga" || c.campo === "local_descarga") return 30;
  if (c.campo === "motorista") return 20;
  if (c.campo === "material") return 24;
  if (c.campo === "toneladas" || c.campo === "km") return 11;
  if (c.campo === "valor_total" || c.campo === "valor_pedagio") return 14;
  return 18;
}

function formatoExcel(c: ColunaLayout, config: ConfigLayout): string | null {
  if (c.formato === "decimal_br") return "#,##0.00";
  if (c.formato === "currency_br") return '"R$" #,##0.00';
  if (c.campo === "toneladas") return "#,##0.000";
  if (c.campo === "km") return "#,##0.00";
  if (c.campo === "valor_total" || c.campo === "valor_pedagio") return '"R$" #,##0.00';
  return null;
}
