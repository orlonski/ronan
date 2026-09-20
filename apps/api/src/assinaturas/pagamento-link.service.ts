import { randomBytes } from "node:crypto";
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FormaCobranca } from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { formatarData, formatarReais } from "../common/assinatura-cobranca";

/** 24 bytes = 192 bits, 32 chars URL-safe. Mesmo tamanho do comprovante. */
const TOKEN_BYTES = 24;

/**
 * O que a página pública mostra. É a FRONTEIRA: o que não está aqui não sai.
 *
 * Whitelist campo a campo, nunca a assinatura inteira com alguns campos
 * removidos — blacklist deixa passar o campo que alguém adicionar amanhã, e
 * aqui dentro tem documento do responsável, e-mail, telefone e id de gateway.
 */
export type PagamentoPublico = {
  /** De quem é a assinatura. Quem abre o link é o financeiro dessa empresa. */
  empresa: string;
  valor: string;
  /** "por mês" / "por ano" — o texto pronto, pra página não decidir. */
  periodicidade: string;
  vencimento: string;
  forma: FormaCobranca;
  situacao: "AGUARDANDO" | "ATIVA";
  /**
   * O copia-e-cola do Pix. `null` quando a assinatura não é Pix Automático ou
   * quando o gateway não devolveu o código — a página precisa distinguir "não
   * se aplica" de "deu ruim", porque a segunda tem uma saída (pedir outro).
   */
  pix: { codigo: string; expirado: boolean } | null;
  /** Página do gateway, pro cartão. `null` no Pix. */
  linkGateway: string | null;
};

/**
 * 410 com `code` pra página distinguir os motivos. "Este link não vale mais
 * porque a assinatura foi cancelada" é acionável; "link inválido" não é.
 */
export class PagamentoIndisponivelException extends HttpException {
  constructor(code: "ASSINATURA_CANCELADA", message: string) {
    super({ code, message }, HttpStatus.GONE);
  }
}

/**
 * A página de pagamento da mensalidade — o link que vai no WhatsApp.
 *
 * Existe porque o copia-e-cola do Pix Automático não cabe em mensagem: são
 * ~230 caracteres, e no WhatsApp o toque longo copia o balão INTEIRO, com a
 * saudação junto. O banco recusa o que vem colado, e o cliente não tem como
 * saber o porquê. Botão de copiar nativo não salva — o `COPY_CODE` da Meta
 * para em 15 caracteres e é template de marketing.
 *
 * Então o WhatsApp manda um link e a cópia acontece numa página, que é o único
 * lugar onde "copiar" é um toque só.
 */
@Injectable()
export class PagamentoLinkService implements OnModuleInit {
  private readonly log = new Logger("PagamentoLink");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Mesma falha silenciosa cara do comprovante: sem a env, o link sai pro
    // WhatsApp do cliente apontando pra localhost e ninguém descobre até
    // alguém reclamar que "o link não abre".
    if (!this.config.get<string>("PUBLIC_APP_URL")) {
      this.log.warn(
        `PUBLIC_APP_URL não configurada — links de pagamento vão sair como ${this.baseUrl}/pagar/…`,
      );
    }
  }

  private get baseUrl(): string {
    return (this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
  }

  /** A URL que o cliente abre. */
  urlDoToken(token: string): string {
    return `${this.baseUrl}/pagar/${token}`;
  }

  /**
   * O link desta assinatura, criando o token na primeira vez.
   *
   * O token é preguiçoso de propósito: assinatura criada antes desta tela
   * existir não tem um, e obrigar um backfill de migration pra algo que se
   * resolve no primeiro uso é trabalho a mais com uma janela a mais de erro.
   * Uma vez criado, nunca muda — link que o cliente guardou continua valendo.
   */
  async garantirLink(assinaturaId: string): Promise<string> {
    const atual = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { id: assinaturaId },
        select: { tokenPagamento: true },
      }),
    );
    if (!atual) throw new NotFoundException("Assinatura não encontrada");
    if (atual.tokenPagamento) return this.urlDoToken(atual.tokenPagamento);

    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    await comoSistema(() =>
      this.prisma.assinatura.update({
        where: { id: assinaturaId },
        data: { tokenPagamento: token },
      }),
    );
    return this.urlDoToken(token);
  }

  /**
   * Resolve o token pra página pública.
   *
   * Roda `comoSistema` porque rota pública não tem conta no contexto — a trava
   * multi-tenant do Prisma não teria de onde tirar o `contaId` e a busca
   * voltaria vazia. O token JÁ É o escopo: 192 bits apontando pra uma
   * assinatura só.
   */
  async porToken(token: string): Promise<PagamentoPublico> {
    const a = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { tokenPagamento: token },
        select: {
          status: true,
          forma: true,
          ciclo: true,
          valorCentavos: true,
          proximoVencimento: true,
          qrCodePayload: true,
          qrCodeExpiraEm: true,
          conta: { select: { nome: true } },
          cobrancas: {
            where: { status: { in: ["PENDENTE", "VENCIDA"] } },
            orderBy: { vencimento: "asc" },
            take: 1,
            select: { vencimento: true, valorCentavos: true, linkPagamento: true },
          },
        },
      }),
    );

    if (!a) throw new NotFoundException({ code: "LINK_INVALIDO", message: "Link inválido." });
    if (a.status === "CANCELADA") {
      throw new PagamentoIndisponivelException(
        "ASSINATURA_CANCELADA",
        "Esta assinatura foi cancelada.",
      );
    }

    const emAberto = a.cobrancas[0];
    const ehPix = a.forma === "PIX_AUTOMATICO";
    const expirado = !!a.qrCodeExpiraEm && a.qrCodeExpiraEm.getTime() < Date.now();

    return {
      empresa: a.conta.nome,
      valor: formatarReais(emAberto?.valorCentavos ?? a.valorCentavos),
      periodicidade: a.ciclo === "ANUAL" ? "por ano" : "por mês",
      vencimento: formatarData(emAberto?.vencimento ?? a.proximoVencimento ?? new Date()),
      forma: a.forma,
      // Só duas situações importam pra quem abriu o link: falta pagar, ou já
      // está tudo certo. O resto do ciclo de vida é assunto do painel.
      situacao: a.status === "AGUARDANDO" ? "AGUARDANDO" : "ATIVA",
      pix: ehPix && a.qrCodePayload ? { codigo: a.qrCodePayload, expirado } : null,
      linkGateway: ehPix ? null : (emAberto?.linkPagamento ?? null),
    };
  }
}
