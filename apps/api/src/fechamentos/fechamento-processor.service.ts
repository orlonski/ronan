import { Injectable, Logger } from "@nestjs/common";
import {
  AcaoAuditoria,
  Prisma,
  StatusFechamento,
  StatusLinhaFechamento,
} from "@prisma/client";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { IaService, type LayoutInferenceResult } from "../ia/ia.service";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { amostraParaIa, parseArquivo, type ParsedFile } from "./parsers";
import {
  normalizarData,
  normalizarNumeroBR,
  normalizarPlaca,
  normalizarTicket,
} from "./utils/normalizers";

// Defaults — usados quando ConfiguracaoIa.id="default" ainda não existe
// (primeiro fechamento processado num ambiente novo).
const DEFAULT_CONFIDENCE_AUTORESOLVER = 0.85;
const DEFAULT_JANELA_DIAS = 3;

type LinhaExtraida = {
  ordem: number;
  rawData: Record<string, unknown>;
  placa: string | null;
  data: Date | null;
  ticket: string | null;
  km: number | null;
  toneladas: number | null;
  valor: number | null;
  obraTexto: string | null;
  materialTexto: string | null;
};

@Injectable()
export class FechamentoProcessorService {
  private readonly log = new Logger(FechamentoProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly ia: IaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async processar(fechamentoId: string, usuarioId: string) {
    const fechamento = await this.prisma.fechamento.findUnique({
      where: { id: fechamentoId },
      include: { empresaCliente: true },
    });
    if (!fechamento) throw new Error("Fechamento não encontrado");
    if (!fechamento.arquivoOriginalKey) throw new Error("Sem arquivo original");

    await this.prisma.fechamento.update({
      where: { id: fechamentoId },
      data: { status: StatusFechamento.EM_PROCESSAMENTO },
    });

    try {
      // 1. baixa do MinIO e parseia
      const buffer = await this.uploads.getObjectBuffer(fechamento.arquivoOriginalKey);
      const parsed = await parseArquivo(
        buffer,
        fechamento.arquivoOriginalNome ?? "fechamento",
        fechamento.arquivoMimetype ?? undefined,
      );

      // 2. obtém ou infere layout
      const layout = await this.obterLayout(fechamento.empresaCliente.id, parsed);
      if (!layout) {
        throw new Error("Não foi possível inferir layout");
      }

      // 3. extrai linhas estruturadas
      const linhas = this.extrairLinhas(parsed, layout);
      if (linhas.length === 0) {
        this.log.warn(`Fechamento ${fechamentoId}: nenhuma linha extraída`);
      }

      // 4. limpa linhas anteriores (caso seja reprocessamento)
      await this.prisma.fechamentoLinha.deleteMany({ where: { fechamentoId } });

      // 5. cria todas as linhas com status MATCH/DIVERGENCIA/FALTANDO
      const stats = {
        total: linhas.length,
        matchAuto: 0,
        matchIa: 0,
        divergencia: 0,
        faltando: 0,
        extra: 0,
      };

      // pre-fetch viagens da empresa do período pra match local
      const viagensPeriodo = await this.prisma.viagem.findMany({
        where: {
          obra: { empresaClienteId: fechamento.empresaCliente.id },
          data: {
            gte: new Date(fechamento.periodoInicio.getTime() - 7 * 24 * 3600 * 1000),
            lte: new Date(fechamento.periodoFim.getTime() + 7 * 24 * 3600 * 1000),
          },
        },
        include: { veiculo: { select: { id: true, placa: true } } },
      });

      const viagensIndex = new Map<string, (typeof viagensPeriodo)[number]>();
      for (const v of viagensPeriodo) {
        const k = matchKey(v.veiculo.placa, v.data, v.ticket);
        viagensIndex.set(k, v);
      }
      const viagensUsadas = new Set<string>();

      for (const linha of linhas) {
        const k = linha.placa && linha.data && linha.ticket
          ? matchKey(linha.placa, linha.data, linha.ticket)
          : null;
        const viagemMatch = k ? viagensIndex.get(k) : null;

        let status: StatusLinhaFechamento = StatusLinhaFechamento.DIVERGENCIA;
        let viagemMatchId: string | null = null;
        let divergencias: Record<string, { motorista: unknown; empresa: unknown }> | null = null;

        if (viagemMatch) {
          // confere divergências em km/toneladas
          divergencias = compararCampos(linha, viagemMatch);
          if (!divergencias) {
            status = StatusLinhaFechamento.MATCH;
            stats.matchAuto++;
          } else {
            status = StatusLinhaFechamento.DIVERGENCIA;
            stats.divergencia++;
          }
          viagemMatchId = viagemMatch.id;
          viagensUsadas.add(viagemMatch.id);
        } else if (!linha.placa || !linha.data) {
          status = StatusLinhaFechamento.DIVERGENCIA;
          stats.divergencia++;
        } else {
          // sem match exato → tentaremos IA depois
          status = StatusLinhaFechamento.DIVERGENCIA;
          stats.divergencia++;
        }

        await this.prisma.fechamentoLinha.create({
          data: {
            fechamentoId,
            ordem: linha.ordem,
            rawData: linha.rawData as Prisma.InputJsonValue,
            placa: linha.placa,
            data: linha.data ?? undefined,
            ticket: linha.ticket,
            km: linha.km !== null ? new Prisma.Decimal(linha.km) : null,
            toneladas: linha.toneladas !== null ? new Prisma.Decimal(linha.toneladas) : null,
            valor: linha.valor !== null ? new Prisma.Decimal(linha.valor) : null,
            obraTexto: linha.obraTexto,
            materialTexto: linha.materialTexto,
            status,
            viagemMatchId,
            divergencias: divergencias
              ? (divergencias as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });

        if (status === StatusLinhaFechamento.MATCH && viagemMatchId) {
          await this.prisma.viagem.update({
            where: { id: viagemMatchId },
            data: { status: "OK" },
          });
          await this.auditoria.log({
            usuarioId,
            entidade: "Viagem",
            entidadeId: viagemMatchId,
            acao: AcaoAuditoria.MATCH_AUTOMATICO,
            metadata: { fechamentoId },
          });
        }
      }

      // 6. detecta viagens "EXTRA" (motorista lançou, empresa não tem)
      for (const v of viagensPeriodo) {
        if (!viagensUsadas.has(v.id)) {
          // só conta como EXTRA se o status anterior era OK (já conferida em outro fechamento)
          // pra MVP, registramos como linha FALTANDO marcada como EXTRA quando o motorista lançou
          // mas a empresa não enviou — vamos criar uma linha sintética
          // (decisão: pulamos por enquanto e listamos só pelo lado da viagem)
        }
      }

      // 7. roda IA nas órfãs
      if (this.ia.habilitada) {
        await this.executarIaEmOrfas(fechamentoId, usuarioId, viagensPeriodo, stats);
      }

      // 8. status final
      const aindaPendente = await this.prisma.fechamentoLinha.count({
        where: {
          fechamentoId,
          status: { in: [StatusLinhaFechamento.DIVERGENCIA, StatusLinhaFechamento.FALTANDO, StatusLinhaFechamento.EXTRA] },
        },
      });
      const statusFinal =
        aindaPendente === 0 ? StatusFechamento.CONFERIDO : StatusFechamento.AGUARDANDO_REVISAO;

      await this.prisma.fechamento.update({
        where: { id: fechamentoId },
        data: { status: statusFinal, resumoIa: stats },
      });

      await this.auditoria.log({
        usuarioId,
        entidade: "Fechamento",
        entidadeId: fechamentoId,
        acao: AcaoAuditoria.UPDATE,
        campo: "processamento",
        valorDepois: stats,
        motivo: "Processamento concluído",
      });

      return stats;
    } catch (err) {
      this.log.error(`Falha no processamento do fechamento ${fechamentoId}`, err as Error);
      await this.prisma.fechamento.update({
        where: { id: fechamentoId },
        data: {
          status: StatusFechamento.AGUARDANDO_REVISAO,
          resumoIa: { erro: (err as Error).message },
        },
      });
      throw err;
    }
  }

  private async obterLayout(
    empresaId: string,
    parsed: ParsedFile,
  ): Promise<LayoutInferenceResult | null> {
    const empresa = await this.prisma.empresaCliente.findUnique({ where: { id: empresaId } });
    if (empresa?.layoutImport) {
      return empresa.layoutImport as unknown as LayoutInferenceResult;
    }
    if (!this.ia.habilitada) {
      // fallback heurístico simples: pega primeira aba que tem >5 colunas e cabeçalho com "PLACA"
      return inferirLayoutHeuristico(parsed);
    }
    const inferred = await this.ia.inferirLayout(amostraParaIa(parsed));
    if (inferred) {
      await this.prisma.empresaCliente.update({
        where: { id: empresaId },
        data: { layoutImport: inferred as unknown as Prisma.InputJsonValue },
      });
    }
    return inferred ?? inferirLayoutHeuristico(parsed);
  }

  private extrairLinhas(parsed: ParsedFile, layout: LayoutInferenceResult): LinhaExtraida[] {
    // Detecta TODAS as abas com mesmo padrão de cabeçalho (mesma estrutura) e
    // processa cada uma. Ex: planilhas com "1ª Medição" + "2ª Medição" no mesmo
    // arquivo vão ter ambas processadas.
    const abasParaProcessar = this.encontrarAbasComMesmoLayout(parsed, layout);
    if (abasParaProcessar.length === 0) return [];

    const out: LinhaExtraida[] = [];
    let ordemGlobal = 0;
    for (const aba of abasParaProcessar) {
      const linhasDaAba = this.extrairDeUmaAba(aba, layout, ordemGlobal);
      out.push(...linhasDaAba);
      ordemGlobal += aba.linhas.length;
    }
    return out;
  }

  private encontrarAbasComMesmoLayout(
    parsed: ParsedFile,
    layout: LayoutInferenceResult,
  ): { nome: string; linhas: (string | number | null)[][] }[] {
    const linhaCabecalho = (layout.linhaCabecalho ?? 1) - 1;
    const headersEsperados = layout.colunas
      .map((c) => String(c.cabecalho ?? "").toUpperCase().trim())
      .filter((h) => h.length > 0);

    const abasMatch: typeof parsed.abas = [];
    for (const aba of parsed.abas) {
      // se a IA escolheu essa aba, sempre incluir
      if (aba.nome === layout.abaPreferida) {
        abasMatch.push(aba);
        continue;
      }
      // verifica se a linha de cabeçalho dessa aba tem >= 50% dos headers esperados
      const linhaHeader = aba.linhas[linhaCabecalho];
      if (!linhaHeader) continue;
      const headersAba = linhaHeader.map((c) => String(c ?? "").toUpperCase().trim());
      const matches = headersEsperados.filter((h) => headersAba.includes(h)).length;
      if (matches >= Math.max(3, Math.floor(headersEsperados.length / 2))) {
        abasMatch.push(aba);
      }
    }
    if (abasMatch.length === 0 && parsed.abas[0]) abasMatch.push(parsed.abas[0]);
    return abasMatch;
  }

  private extrairDeUmaAba(
    aba: { nome: string; linhas: (string | number | null)[][] },
    layout: LayoutInferenceResult,
    ordemBase: number,
  ): LinhaExtraida[] {
    const inicio = (layout.linhaInicioDados ?? 1) - 1;
    const linhasDados = aba.linhas.slice(inicio);

    const colMap = new Map<string, string>(); // letra → campo
    for (const c of layout.colunas) {
      colMap.set(c.letra.toUpperCase(), c.campo);
    }

    const out: LinhaExtraida[] = [];
    for (let i = 0; i < linhasDados.length; i++) {
      const row = linhasDados[i];
      // pula linhas que parecem subtítulo: poucas células preenchidas e sem placa válida
      const nonEmpty = row.filter((v) => v !== null && v !== "");
      if (nonEmpty.length < 4) continue;

      const raw: Record<string, unknown> = {};
      for (let c = 0; c < row.length; c++) {
        const letra = String.fromCharCode(65 + c);
        if (row[c] !== null) raw[letra] = row[c];
      }

      const get = (campo: string) => {
        for (const [letra, f] of colMap) {
          if (f === campo) return row[letra.charCodeAt(0) - 65];
        }
        return null;
      };

      const placa = normalizarPlaca(get("placa") as string | number | null);
      // pula linhas sem placa válida (são subtítulos/sumarizadores)
      if (!placa) continue;

      const data = normalizarData(get("data"));
      const ticket = normalizarTicket(get("ticket"));
      const km = normalizarNumeroBR(get("km"));
      const toneladas = normalizarNumeroBR(get("toneladas"));
      const valor = normalizarNumeroBR(get("valor_total"));
      const obraTexto = get("obra") as string | null;
      const materialTexto = get("material") as string | null;

      out.push({
        ordem: ordemBase + inicio + i + 1, // ordem global considerando múltiplas abas
        rawData: { ...raw, __aba: aba.nome },
        placa,
        data,
        ticket,
        km,
        toneladas,
        valor,
        obraTexto: obraTexto ? String(obraTexto) : null,
        materialTexto: materialTexto ? String(materialTexto) : null,
      });
    }
    return out;
  }

  private async executarIaEmOrfas(
    fechamentoId: string,
    usuarioId: string,
    viagensPeriodo: { id: string; data: Date; ticket: string; km: Prisma.Decimal; toneladas: Prisma.Decimal; veiculo: { placa: string } }[],
    stats: { matchIa: number; divergencia: number },
  ) {
    // Lê config dinâmica (atualizável via /configuracoes/ia no dashboard).
    const cfg = await this.prisma.configuracaoIa
      .upsert({
        where: { id: "default" },
        update: {},
        create: { id: "default" },
      })
      .catch(() => null);
    const thresholdAuto = cfg?.confidenceMinimo ?? DEFAULT_CONFIDENCE_AUTORESOLVER;
    const janelaDias = cfg?.janelaDias ?? DEFAULT_JANELA_DIAS;

    const orfas = await this.prisma.fechamentoLinha.findMany({
      where: {
        fechamentoId,
        status: StatusLinhaFechamento.DIVERGENCIA,
        viagemMatchId: null,
      },
      orderBy: { ordem: "asc" },
    });

    for (const linha of orfas) {
      if (!linha.placa || !linha.data) continue;

      // candidatas: mesma placa, datas em ±N dias (config), ainda não matchadas
      const candidatas = viagensPeriodo
        .filter((v) => {
          if (v.veiculo.placa.toUpperCase() !== linha.placa) return false;
          const diff = Math.abs(v.data.getTime() - linha.data!.getTime()) / (24 * 3600 * 1000);
          return diff <= janelaDias;
        })
        .map((v) => ({
          viagemId: v.id,
          data: v.data.toISOString().slice(0, 10),
          placa: v.veiculo.placa,
          ticket: v.ticket,
          km: Number(v.km),
          toneladas: Number(v.toneladas),
        }));

      if (candidatas.length === 0) continue;

      const sugestao = await this.ia.sugerirMatch({
        linhaCliente: {
          data: linha.data.toISOString().slice(0, 10),
          placa: linha.placa,
          ticket: linha.ticket ?? "",
          km: linha.km ? Number(linha.km) : undefined,
          toneladas: linha.toneladas ? Number(linha.toneladas) : undefined,
          valor: linha.valor ? Number(linha.valor) : undefined,
        },
        candidatas,
      });

      if (!sugestao) continue;

      const update: Prisma.FechamentoLinhaUpdateInput = {
        sugestaoIa: sugestao as unknown as Prisma.InputJsonValue,
      };

      if (sugestao.viagemId && sugestao.confidence >= thresholdAuto) {
        update.status = StatusLinhaFechamento.MATCH_IA;
        update.viagemMatch = { connect: { id: sugestao.viagemId } };
        stats.matchIa++;
        stats.divergencia--;
      }

      await this.prisma.fechamentoLinha.update({
        where: { id: linha.id },
        data: update,
      });

      if (sugestao.viagemId && sugestao.confidence >= thresholdAuto) {
        await this.prisma.viagem.update({
          where: { id: sugestao.viagemId },
          data: { status: "AJUSTADA" },
        });
        await this.auditoria.log({
          usuarioId,
          entidade: "Viagem",
          entidadeId: sugestao.viagemId,
          acao: AcaoAuditoria.MATCH_IA,
          metadata: {
            confidence: sugestao.confidence,
            motivo: sugestao.motivo,
            fechamentoLinhaId: linha.id,
          },
        });
      }
    }
  }
}

function matchKey(placa: string, data: Date | string, ticket: string): string {
  const d = typeof data === "string" ? data.slice(0, 10) : data.toISOString().slice(0, 10);
  return `${placa.toUpperCase()}|${d}|${ticket.toUpperCase().trim()}`;
}

function compararCampos(
  linha: LinhaExtraida,
  viagem: { km: Prisma.Decimal; toneladas: Prisma.Decimal },
): Record<string, { motorista: unknown; empresa: unknown }> | null {
  const divergencias: Record<string, { motorista: unknown; empresa: unknown }> = {};
  if (linha.km !== null && Math.abs(linha.km - Number(viagem.km)) > 0.5) {
    divergencias.km = { motorista: Number(viagem.km), empresa: linha.km };
  }
  if (linha.toneladas !== null && Math.abs(linha.toneladas - Number(viagem.toneladas)) > 0.05) {
    divergencias.toneladas = { motorista: Number(viagem.toneladas), empresa: linha.toneladas };
  }
  return Object.keys(divergencias).length > 0 ? divergencias : null;
}

function inferirLayoutHeuristico(parsed: ParsedFile): LayoutInferenceResult | null {
  // procura aba com cabeçalho que tenha PLACA, DATA, TICKET
  for (const aba of parsed.abas) {
    for (let i = 0; i < Math.min(aba.linhas.length, 20); i++) {
      const row = aba.linhas[i];
      const headers = row.map((c) => String(c ?? "").toUpperCase().trim());
      const tem = (...needles: string[]) =>
        needles.every((n) => headers.some((h) => h.includes(n)));
      if (tem("DATA", "PLACA") && (tem("TICKET") || tem("Nº TICKET"))) {
        const colunas = headers
          .map((h, idx) => ({
            letra: String.fromCharCode(65 + idx),
            cabecalho: h,
            campo: matchHeader(h),
          }))
          .filter((c) => c.cabecalho);
        return {
          tipoBloco: "viagens",
          abaPreferida: aba.nome,
          linhaCabecalho: i + 1,
          linhaInicioDados: i + 2,
          colunas,
          observacoes: "heurístico",
        };
      }
    }
  }
  return null;
}

function matchHeader(h: string): LayoutInferenceResult["colunas"][number]["campo"] {
  const norm = h.toUpperCase();
  if (/PLACA|VE[IÍ]CULO/.test(norm)) return "placa";
  if (/DATA/.test(norm)) return "data";
  if (/TICKET/.test(norm)) return "ticket";
  if (/OBRA/.test(norm)) return "obra";
  if (/MATERIAL/.test(norm)) return "material";
  if (/QUANT|TONELADA/.test(norm)) return "toneladas";
  if (/DIST|KM/.test(norm)) return "km";
  if (/TOTAL/.test(norm) && /R\$/.test(norm)) return "valor_total";
  if (/UNIT/.test(norm)) return "valor_unitario";
  if (/PRA[CÇ]A/.test(norm)) return "praca_pedagio";
  if (/EIXO/.test(norm)) return "eixos";
  if (/UNID|UN\./.test(norm)) return "unidade";
  if (/FORNEC/.test(norm)) return "fornecedor";
  return "ignorar";
}
