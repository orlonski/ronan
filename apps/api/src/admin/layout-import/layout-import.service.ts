import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { IaService, type LayoutInferenceResult } from "../../ia/ia.service";
import {
  amostraParaIa,
  parseArquivo,
  type ParsedFile,
} from "../../fechamentos/parsers";

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

@Injectable()
export class LayoutImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaService,
  ) {}

  /**
   * Recebe arquivo amostral, parseia e roda IA pra sugerir mapeamento.
   * NÃO persiste — admin vê o resultado, edita se quiser e chama PUT.
   */
  async inferir(
    empresaId: string,
    arquivo: { buffer: Buffer; nomeOriginal: string; mimetype: string },
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

    const sugestao = await this.ia.inferirLayout(amostraParaIa(parsed));

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

  async get(empresaId: string): Promise<LayoutInferenceResult | null> {
    await this.ensureEmpresaImporta(empresaId);
    const empresa = await this.prisma.empresaCliente.findUnique({
      where: { id: empresaId },
      select: { layoutImport: true },
    });
    return (empresa?.layoutImport as LayoutInferenceResult | null) ?? null;
  }

  async salvar(
    empresaId: string,
    layout: LayoutInferenceResult,
  ): Promise<LayoutInferenceResult> {
    await this.ensureEmpresaImporta(empresaId);
    if (!Array.isArray(layout.colunas) || layout.colunas.length === 0) {
      throw new BadRequestException(
        "Layout inválido — precisa ter ao menos uma coluna mapeada.",
      );
    }
    await this.prisma.empresaCliente.update({
      where: { id: empresaId },
      data: { layoutImport: layout as unknown as Prisma.InputJsonValue },
    });
    return layout;
  }

  async limpar(empresaId: string): Promise<void> {
    await this.ensureEmpresaImporta(empresaId);
    await this.prisma.empresaCliente.update({
      where: { id: empresaId },
      data: { layoutImport: Prisma.DbNull },
    });
  }

  /**
   * Lista os últimos N fechamentos da empresa (pra UI oferecer reprocesso
   * em lote após salvar layout novo).
   */
  async fechamentosRecentes(empresaId: string, take = 10) {
    await this.ensureEmpresaImporta(empresaId);
    return this.prisma.fechamento.findMany({
      where: { empresaClienteId: empresaId },
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
    const e = await this.prisma.empresaCliente.findUnique({
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
