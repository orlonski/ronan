import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  LIMITE_DOCUMENTO_PEDIDO,
  UNIDADES_PEDIDO,
  type ExtrairPedidoResult,
} from "@ronan/shared-types";
import {
  catalogoPedidoParaPrompt,
  contarPaginasPdf,
  pedidoDoJson,
  referenciaDeHoje,
  tipoDoArquivo,
  type CatalogoPedido,
} from "../../common/ia/pedido-documento";
import { ymdSaoPaulo } from "../../common/timezone";
import { IaService } from "../../ia/ia.service";
import { PrismaService } from "../../prisma/prisma.service";

/** Código estável: a tela usa pra cair no preenchimento manual sem drama. */
export const LEITURA_INDISPONIVEL = "LEITURA_PEDIDO_INDISPONIVEL";

/**
 * Pedido criado a partir de documento: lê, casa com o cadastro e devolve a
 * SUGESTÃO. Não grava nada — nem pedido, nem rascunho, nem o arquivo. Quem
 * salva é a pessoa, pelo formulário de sempre, depois de conferir.
 */
@Injectable()
export class PedidoDocumentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaService,
  ) {}

  async extrair(entrada: {
    arquivo?: { buffer: Buffer; size: number } | null;
    texto?: string;
  }): Promise<ExtrairPedidoResult> {
    const fonte = this.fonte(entrada);

    // Depois de validar a entrada: arquivo errado é erro de quem mandou, com ou
    // sem IA. Sem chave, a tela segue no preenchimento manual.
    if (!this.ia.habilitada) {
      throw new ServiceUnavailableException({
        code: LEITURA_INDISPONIVEL,
        message: "Leitura automática indisponível no momento. Preencha o pedido à mão.",
      });
    }

    const catalogo = await this.catalogo();
    const [a, m, d] = ymdSaoPaulo();
    const hoje = `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    let bruto: Record<string, unknown> | null;
    try {
      bruto = await this.ia.lerPedidoDocumento({
        fonte,
        catalogo: catalogoPedidoParaPrompt(catalogo),
        referenciaHoje: referenciaDeHoje(hoje),
      });
    } catch {
      // A causa (timeout, 529, cota) já foi pro log e pro `usos_ia`. Pra quem
      // está na tela o que importa é: não leu, dá pra tentar de novo ou digitar.
      throw new BadGatewayException({
        code: LEITURA_INDISPONIVEL,
        message: "Não consegui ler o documento agora. Tente de novo em instantes ou preencha à mão.",
      });
    }

    const origem = fonte.tipo === "pdf" ? "PDF" : fonte.tipo === "imagem" ? "IMAGEM" : "TEXTO";
    const r = pedidoDoJson(bruto ?? {}, catalogo, { unidadesAceitas: UNIDADES_PEDIDO, hoje, origem });
    if (!bruto) r.avisos.unshift("A leitura não trouxe nada aproveitável. Preencha à mão.");
    return r;
  }

  private fonte(entrada: { arquivo?: { buffer: Buffer; size: number } | null; texto?: string }) {
    const { arquivo, texto } = entrada;
    if (arquivo) {
      if (arquivo.size > LIMITE_DOCUMENTO_PEDIDO.bytes) {
        throw new BadRequestException(
          `O arquivo é grande demais. O limite é ${LIMITE_DOCUMENTO_PEDIDO.bytes / 1024 / 1024} MB.`,
        );
      }
      const tipo = tipoDoArquivo(arquivo.buffer);
      if (!tipo) {
        throw new BadRequestException(
          "Esse tipo de arquivo não dá pra ler. Mande um PDF ou uma foto (JPG, PNG ou WebP), ou cole o texto do e-mail.",
        );
      }
      if (tipo.tipo === "pdf") {
        const paginas = contarPaginasPdf(arquivo.buffer);
        if (paginas > LIMITE_DOCUMENTO_PEDIDO.paginas) {
          throw new BadRequestException(
            `O PDF tem ${paginas} páginas. Mande só as páginas do pedido (até ${LIMITE_DOCUMENTO_PEDIDO.paginas}).`,
          );
        }
        return { tipo: "pdf" as const, base64: arquivo.buffer.toString("base64") };
      }
      return { tipo: "imagem" as const, mime: tipo.mime, base64: arquivo.buffer.toString("base64") };
    }
    if (texto && texto.trim().length >= 10) return { tipo: "texto" as const, texto: texto.trim() };
    throw new BadRequestException("Mande o arquivo do pedido ou cole o texto do e-mail.");
  }

  /**
   * O cadastro da conta (a trava do Prisma filtra o `contaId`). Só ativos:
   * sugerir obra encerrada ou material desativado seria sugerir o que o
   * formulário nem deixa escolher.
   */
  private async catalogo(): Promise<CatalogoPedido> {
    const [empresas, obras, materiais, locais] = await Promise.all([
      this.prisma.empresa.findMany({
        where: { ativa: true },
        select: { id: true, nome: true, razaoSocial: true, cnpj: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.cliente.findMany({
        where: { ativa: true },
        select: { id: true, nome: true, apelidos: true, empresaId: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.material.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, apelidos: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.local.findMany({
        where: { ativo: true },
        select: {
          id: true,
          nome: true,
          apelidos: true,
          logradouro: true,
          numero: true,
          cidade: true,
          uf: true,
        },
      }),
    ]);
    return { empresas, obras, materiais, locais };
  }
}
