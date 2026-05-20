import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type TipoBlocoFechamento } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { IaService, type LayoutInferenceResult } from "../../ia/ia.service";
import {
  amostraParaIa,
  parseArquivo,
  type ParsedFile,
} from "../../fechamentos/parsers";
import { CamposLayoutService } from "../campos-layout/campos-layout.service";

export type EstruturaPlanilha = {
  formato: "xlsx" | "csv" | "pdf";
  nomeArquivo: string;
  abas: {
    nome: string;
    totalLinhas: number;
    primeirasLinhas: (string | number | null)[][];
  }[];
};

export type InferirResult = {
  estrutura: EstruturaPlanilha;
  sugestao: LayoutInferenceResult | null;
};

export type BlocoSalvo = {
  id: string;
  empresaId: string;
  tipo: TipoBlocoFechamento;
  abaPreferida: string | null;
  linhaCabecalho: number | null;
  linhaInicioDados: number | null;
  colunas: { letra: string; cabecalho: string; campo: string }[];
  ativo: boolean;
};

@Injectable()
export class LayoutImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaService,
    private readonly camposLayout: CamposLayoutService,
  ) {}

  /**
   * Recebe arquivo amostral, parseia e roda IA pra sugerir mapeamento.
   * NÃO persiste — admin vê o resultado, edita se quiser e chama PUT.
   * Aceita `tipo` opcional pra direcionar a IA pro bloco específico
   * (ex: pedágios, combustível). Sem tipo = comportamento atual (viagens).
   */
  async inferir(
    empresaId: string,
    arquivo: { buffer: Buffer; nomeOriginal: string; mimetype: string },
    tipo?: TipoBlocoFechamento,
  ): Promise<InferirResult> {
    await this.ensureEmpresaImporta(empresaId);

    let parsed: ParsedFile;
    try {
      parsed = await parseArquivo(
        arquivo.buffer,
        arquivo.nomeOriginal,
        arquivo.mimetype,
      );
    } catch (err) {
      throw new BadRequestException(
        `Não consegui ler o arquivo: ${(err as Error).message}`,
      );
    }

    const sugestao = await this.ia.inferirLayout(amostraParaIa(parsed), tipo);

    return {
      estrutura: {
        formato: parsed.formato,
        nomeArquivo: parsed.nomeArquivo,
        abas: parsed.abas.map((a) => ({
          nome: a.nome,
          totalLinhas: a.linhas.length,
          primeirasLinhas: a.linhas.slice(0, 12),
        })),
      },
      sugestao,
    };
  }

  /** Lista todos os blocos cadastrados pra empresa. */
  async listarBlocos(empresaId: string): Promise<BlocoSalvo[]> {
    await this.ensureEmpresaImporta(empresaId);
    const blocos = await this.prisma.layoutImportBloco.findMany({
      where: { empresaId: empresaId },
      orderBy: { tipo: "asc" },
    });
    return blocos.map((b) => ({
      id: b.id,
      empresaId: b.empresaId,
      tipo: b.tipo,
      abaPreferida: b.abaPreferida,
      linhaCabecalho: b.linhaCabecalho,
      linhaInicioDados: b.linhaInicioDados,
      colunas: (b.colunas as unknown as BlocoSalvo["colunas"]) ?? [],
      ativo: b.ativo,
    }));
  }

  /** Retorna 1 bloco específico (ou null). */
  async getBloco(
    empresaId: string,
    tipo: TipoBlocoFechamento,
  ): Promise<BlocoSalvo | null> {
    await this.ensureEmpresaImporta(empresaId);
    const b = await this.prisma.layoutImportBloco.findUnique({
      where: { empresaId_tipo: { empresaId: empresaId, tipo } },
    });
    if (!b) return null;
    return {
      id: b.id,
      empresaId: b.empresaId,
      tipo: b.tipo,
      abaPreferida: b.abaPreferida,
      linhaCabecalho: b.linhaCabecalho,
      linhaInicioDados: b.linhaInicioDados,
      colunas: (b.colunas as unknown as BlocoSalvo["colunas"]) ?? [],
      ativo: b.ativo,
    };
  }

  /**
   * Persiste 1 bloco (cria ou atualiza). Valida slugs contra CampoLayout.
   */
  async salvarBloco(
    empresaId: string,
    tipo: TipoBlocoFechamento,
    layout: LayoutInferenceResult,
  ) {
    await this.ensureEmpresaImporta(empresaId);
    if (!Array.isArray(layout.colunas) || layout.colunas.length === 0) {
      throw new BadRequestException(
        "Layout inválido — precisa ter ao menos uma coluna mapeada.",
      );
    }
    const slugsAtivos = await this.camposLayout.listarSlugsAtivos();
    const slugsValidos = new Set(slugsAtivos.map((c) => c.slug));
    const slugsInvalidos = layout.colunas
      .map((c) => c.campo)
      .filter((s) => !slugsValidos.has(s));
    if (slugsInvalidos.length > 0) {
      throw new BadRequestException(
        `Campo(s) desconhecido(s): ${[...new Set(slugsInvalidos)].join(", ")}.`,
      );
    }

    const data = {
      abaPreferida: layout.abaPreferida ?? null,
      linhaCabecalho: layout.linhaCabecalho ?? null,
      linhaInicioDados: layout.linhaInicioDados ?? null,
      colunas: layout.colunas as unknown as Prisma.InputJsonValue,
      ativo: true,
    };
    return this.prisma.layoutImportBloco.upsert({
      where: { empresaId_tipo: { empresaId: empresaId, tipo } },
      create: { empresaId: empresaId, tipo, ...data },
      update: data,
    });
  }

  /** Apaga 1 bloco específico. */
  async limparBloco(empresaId: string, tipo: TipoBlocoFechamento): Promise<void> {
    await this.ensureEmpresaImporta(empresaId);
    await this.prisma.layoutImportBloco
      .delete({
        where: { empresaId_tipo: { empresaId: empresaId, tipo } },
      })
      .catch(() => {
        /* ignora se não existe */
      });
  }

  /**
   * Lista os últimos N fechamentos da empresa (pra UI oferecer reprocesso
   * em lote após salvar layout novo).
   */
  async fechamentosRecentes(empresaId: string, take = 10) {
    await this.ensureEmpresaImporta(empresaId);
    return this.prisma.fechamento.findMany({
      where: { empresaId: empresaId },
      select: {
        id: true,
        periodoInicio: true,
        periodoFim: true,
        versao: true,
        status: true,
        criadoEm: true,
        _count: { select: { linhas: true } },
      },
      orderBy: { criadoEm: "desc" },
      take,
    });
  }

  /**
   * Empresas com papel RECEBE_PLANILHA não recebem fechamento, então
   * configurar layout de import não faz sentido.
   */
  private async ensureEmpresaImporta(id: string) {
    const e = await this.prisma.empresa.findUnique({
      where: { id },
      select: { id: true, papel: true, ativa: true },
    });
    if (!e) throw new NotFoundException("Empresa não encontrada");
    if (e.papel === "RECEBE_PLANILHA") {
      throw new ForbiddenException(
        "Esta empresa não envia fechamento — configurar layout de importação não se aplica.",
      );
    }
    return e;
  }
}
