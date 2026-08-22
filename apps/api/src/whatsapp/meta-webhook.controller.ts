import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { comoSistema } from "../common/conta/conta-context";
import { ErrorsService } from "../errors/errors.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Webhook da Cloud API da Meta. Controller SEPARADO do webhook do Evolution:
 * o formato do corpo, o jeito de autenticar e o que se faz com cada evento não
 * têm nada em comum, e espremer os dois no mesmo handler faria um `if` no topo
 * decidir tudo.
 *
 * Env vars:
 *   META_WEBHOOK_VERIFY_TOKEN — string que a gente inventa e repete no console
 *                               da Meta. Só serve pro handshake do GET.
 *   META_APP_SECRET           — segredo do app; assina cada POST.
 *
 * A Meta faz um GET com `hub.challenge` na hora de salvar a URL no console, e
 * só aceita a URL se a resposta for o challenge em texto puro. Sem este
 * endpoint no ar, não dá nem pra configurar o webhook.
 */

/** Status de entrega que a Meta manda, do mais cru ao mais final. */
const STATUS_CONHECIDOS = new Set(["sent", "delivered", "read", "failed"]);

type TemplateStatus = {
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
};

type ValueMeta = {
  statuses?: Array<{
    id?: string;
    status?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
  messages?: Array<{ id?: string; from?: string; type?: string }>;
  metadata?: { phone_number_id?: string };
} & TemplateStatus;

type CorpoWebhook = {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: ValueMeta }> }>;
};

@ApiTags("whatsapp")
@Controller("whatsapp/meta")
export class MetaWebhookController {
  private readonly log = new Logger("MetaWebhook");

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly errors: ErrorsService,
  ) {}

  /**
   * Handshake de verificação. A Meta chama uma vez, ao salvar a URL.
   *
   * Devolve o challenge CRU, sem JSON em volta — a Meta compara byte a byte e
   * recusa a URL se vier `"123"` com aspas. Por isso o retorno é string e não
   * um objeto.
   */
  @Public()
  @Get("webhook")
  verificar(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): string {
    const esperado = this.config.get<string>("META_WEBHOOK_VERIFY_TOKEN");
    if (!esperado) {
      this.log.error("META_WEBHOOK_VERIFY_TOKEN não configurado — recusando o handshake");
      throw new UnauthorizedException();
    }
    if (mode !== "subscribe" || !token || !challenge) {
      throw new UnauthorizedException();
    }
    if (!confereSegredo(token, esperado)) {
      // Sem o valor recebido no log: é segredo, mesmo quando está errado.
      this.log.warn("handshake recusado: verify_token não confere");
      throw new UnauthorizedException();
    }
    this.log.log("handshake aceito — webhook verificado pela Meta");
    return challenge;
  }

  /**
   * Eventos. Diferente do webhook do Evolution, aqui a assinatura é conferida
   * de verdade desde o primeiro deploy: a Meta assina TODO POST com o app
   * secret, então não existe o risco de derrubar inbound por causa de um header
   * que talvez não venha.
   *
   * Responde 200 depois de autenticar, sempre. A Meta reenvia o que não recebe
   * 200 e desliga o webhook depois de muita falha seguida — um erro ao gravar
   * status de entrega não pode custar isso.
   */
  @Public()
  @Post("webhook")
  @HttpCode(200)
  async receber(
    @Body() body: CorpoWebhook,
    @Headers("x-hub-signature-256") assinatura: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<string> {
    const segredo = this.config.get<string>("META_APP_SECRET");
    if (!segredo) {
      this.log.error("META_APP_SECRET não configurado — recusando o evento");
      throw new UnauthorizedException();
    }
    if (!req.rawBody) {
      // Sem o corpo cru não dá pra validar assinatura, e aceitar sem validar
      // seria pior que recusar: este endpoint é público.
      this.log.error("corpo cru ausente — confira o `verify` do json() no main.ts");
      throw new UnauthorizedException();
    }
    if (!assinaturaConfere(req.rawBody, assinatura, segredo)) {
      this.log.warn("evento recusado: X-Hub-Signature-256 não confere");
      throw new UnauthorizedException();
    }

    try {
      await this.processar(body);
    } catch (e) {
      // Já autenticado: engolir e responder 200. O evento se perde, o webhook
      // continua vivo.
      this.log.error(`falha ao processar evento: ${(e as Error).message}`);
    }
    return "ok";
  }

  private async processar(body: CorpoWebhook): Promise<void> {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        if (change.field === "message_template_status_update") {
          await this.gravarStatusTemplate(value);
          continue;
        }

        for (const s of value.statuses ?? []) {
          await this.gravarStatus(s);
        }

        // Mensagem recebida. O agente está DESLIGADO em produção de propósito,
        // e ligá-lo por aqui seria fazer isso por acidente — então por ora só
        // registra que chegou. Quando o agente voltar, é aqui que o inbound da
        // Meta se normaliza pro mesmo formato que o Baileys produz.
        if (value.messages?.length) {
          this.log.log(
            `${value.messages.length} mensagem(ns) recebida(s) no número ${value.metadata?.phone_number_id ?? "?"} — sem tratamento (agente desligado)`,
          );
        }
      }
    }
  }

  /**
   * Template aprovado ou reprovado pela Meta.
   *
   * Sem isto, template reprovado só aparece quando a mensagem tenta sair — às
   * 20h no cron do resumo, ou quando um motorista pede o código. Descobrir ali
   * é descobrir tarde e pelo cliente.
   *
   * Reprovação vai pro `ErrorLog`, que é a tela de Erros do painel: é o único
   * lugar do sistema onde alguém já olha esperando encontrar problema. Aprovação
   * é só log — notícia boa não precisa de tela.
   */
  private async gravarStatusTemplate(v: ValueMeta): Promise<void> {
    const nome = v.message_template_name ?? "?";
    const idioma = v.message_template_language ?? "?";
    const evento = (v.event ?? "").toUpperCase();

    if (evento === "APPROVED") {
      this.log.log(`template "${nome}" (${idioma}) APROVADO pela Meta`);
      return;
    }

    const detalhe = v.reason ? ` — motivo: ${v.reason}` : "";
    this.log.error(`template "${nome}" (${idioma}) ${evento || "sem evento"}${detalhe}`);
    // Nunca deixa a falha ao registrar derrubar o webhook: a Meta desliga a URL
    // depois de muita resposta não-200 seguida.
    try {
      await this.errors.reportar({
        origem: "api",
        message: `Template do WhatsApp "${nome}" (${idioma}): ${evento || "status desconhecido"}`,
        extra: { nome, idioma, evento, reason: v.reason ?? null },
      });
    } catch (e) {
      this.log.warn(`não deu pra registrar o status do template: ${(e as Error).message}`);
    }
  }

  /**
   * Carimba o status de entrega na linha que a fachada gravou no envio.
   *
   * Roda em `comoSistema` porque o webhook não tem conta no contexto: a trava
   * automática do Prisma filtraria por `__SEM_CONTA__` e o update não acharia
   * nada, em silêncio. O `wamid` é único globalmente, então buscar sem filtro
   * de conta é correto aqui — e é o único jeito que funciona.
   */
  private async gravarStatus(s: NonNullable<ValueMeta["statuses"]>[number]): Promise<void> {
    if (!s.id || !s.status) return;
    if (!STATUS_CONHECIDOS.has(s.status)) {
      this.log.warn(`status desconhecido "${s.status}" — gravando mesmo assim`);
    }

    const erro = s.errors?.[0];
    const n = await comoSistema(() =>
      this.prisma.whatsappMensagem.updateMany({
        where: { idExterno: s.id },
        data: {
          statusEntrega: s.status,
          erroCodigo: erro?.code != null ? String(erro.code) : null,
        },
      }),
    );

    if (n.count === 0) {
      // Acontece de verdade: status de mensagem mandada antes desta versão, ou
      // de outro ambiente apontado pro mesmo número. Não é erro.
      this.log.debug(`status "${s.status}" sem mensagem correspondente (${s.id})`);
    } else if (s.status === "failed") {
      this.log.error(
        `mensagem ${s.id} FALHOU na Meta: ${erro?.code ?? "?"} ${erro?.title ?? ""} ${erro?.message ?? ""}`.trim(),
      );
    }
  }
}

/** Compara em tempo constante, tolerando tamanhos diferentes. */
function confereSegredo(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 do corpo CRU com o app
 * secret. Tem que ser o buffer original: reserializar o JSON muda espaço e
 * ordem de chave, e a assinatura deixa de bater.
 */
function assinaturaConfere(
  corpo: Buffer,
  cabecalho: string | undefined,
  segredo: string,
): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", segredo).update(corpo).digest();
  let recebido: Buffer;
  try {
    recebido = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
