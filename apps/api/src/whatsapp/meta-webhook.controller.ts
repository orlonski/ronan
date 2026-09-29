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
import { ChatwootRepasseService } from "./chatwoot-repasse.service";
import { comoSistema } from "../common/conta/conta-context";
import { ConferenciaAlcanceService } from "../admin/conferencia-diaria/conferencia-alcance.service";
import {
  ConferenciaRespostaService,
  type MensagemRecebida,
} from "../admin/conferencia-diaria/conferencia-resposta.service";
import { ErrorsService } from "../errors/errors.service";
import { PrismaService } from "../prisma/prisma.service";
import { registrarStatusMetaNaConferencia } from "../common/conferencia-trilha";

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
  /** `template_category_update`: a Meta reclassificou (ou vai reclassificar) o template. */
  previous_category?: string;
  new_category?: string;
  correct_category?: string;
};

type ValueMeta = {
  statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
  messages?: MensagemRecebida[];
  metadata?: { phone_number_id?: string };
  /** `phone_number_quality_update` / `account_update`: os campos variam por evento. */
  event?: string;
  display_phone_number?: string;
  current_limit?: string;
  ban_info?: unknown;
  violation_info?: unknown;
  restriction_info?: unknown;
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
    private readonly chatwoot: ChatwootRepasseService,
    private readonly conferencia: ConferenciaRespostaService,
    private readonly alcance: ConferenciaAlcanceService,
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

    // Fan-out antes de processar: o Chatwoot é o atendimento humano do mesmo
    // número, e o que atrasa aqui atrasa a resposta pra Meta. Não leva `await`
    // de propósito — ver ChatwootRepasseService.
    this.chatwoot.repassar(req.rawBody, assinatura, numerosDoCorpo(body));

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

        // A Meta chama de `template_category_update` na doc e o campo também
        // aparece como `message_template_category_update` em SDKs: aceita os dois.
        if (change.field === "template_category_update" || change.field === "message_template_category_update") {
          await this.registrarCategoriaTemplate(value);
          continue;
        }

        // Qualidade/limite do número e avisos da conta: é o que antecede uma
        // restrição de envio. Vai pro ErrorLog, que é a tela onde alguém olha.
        if (change.field === "phone_number_quality_update" || change.field === "account_update") {
          await this.registrarAvisoDaConta(change.field, value);
          continue;
        }

        for (const s of value.statuses ?? []) {
          await this.gravarStatus(s);
        }

        // Resposta à conferência diária (toque no botão ou texto "1/2/3/4",
        // "sim/não", "parar"). Cada mensagem isolada: erro numa não derruba as
        // outras nem o 200 pra Meta. Só o que é DA conferência é tratado aqui —
        // o resto segue pro Chatwoot, como sempre.
        for (const m of value.messages ?? []) {
          try {
            const r = await this.conferencia.tratarMensagem(m);
            if (r.tratada) {
              this.log.log(`resposta da conferência diária tratada (${r.origem} → ${r.opcao})`);
            }
          } catch (e) {
            this.log.error(`falha na resposta da conferência: ${(e as Error).message}`);
          }
        }

        // Mensagem recebida. Quem atende é o Chatwoot, pelo repasse lá em
        // cima; aqui não se responde nada (a única exceção é a resposta da
        // conferência, acima). O agente segue DESLIGADO em produção de
        // propósito, e ligá-lo por este caminho seria fazer isso por acidente.
        if (value.messages?.length) {
          const destino = this.chatwoot.configurado() ? "repassada(s) ao Chatwoot" : "sem tratamento";
          this.log.log(
            `${value.messages.length} mensagem(ns) recebida(s) no número ${value.metadata?.phone_number_id ?? "?"} — ${destino}`,
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
   * A Meta reclassificou o template. UTILITY -> MARKETING é o que importa: passa
   * a valer o limite de entregas de marketing por usuário (erro 131049) e a
   * cobrança de marketing. Só esse caso (e o aviso prévio `correct_category`)
   * vai pro ErrorLog; o resto é log.
   */
  private async registrarCategoriaTemplate(v: ValueMeta): Promise<void> {
    const nome = v.message_template_name ?? "?";
    const idioma = v.message_template_language ?? "?";
    const antes = (v.previous_category ?? "").toUpperCase();
    const depois = (v.new_category ?? v.correct_category ?? "").toUpperCase();
    this.log.warn(`template "${nome}" (${idioma}): categoria ${antes || "?"} -> ${depois || "?"}`);
    if (depois !== "MARKETING" || antes === "MARKETING") return;
    try {
      await this.errors.reportar({
        origem: "api",
        message: `Template do WhatsApp "${nome}" (${idioma}) virou MARKETING na Meta (era ${antes || "?"})`,
        extra: { nome, idioma, antes, depois, aviso: v.new_category ? "reclassificado" : "reclassificação prevista", valor: v },
      });
    } catch (e) {
      this.log.warn(`não deu pra registrar a mudança de categoria: ${(e as Error).message}`);
    }
  }

  /**
   * `phone_number_quality_update` (qualidade/limite do número) e `account_update`
   * (restrição, banimento, revisão da conta). Moldado em `gravarStatusTemplate`:
   * vai pro `ErrorLog` e nunca derruba o webhook.
   */
  private async registrarAvisoDaConta(campo: string, v: ValueMeta): Promise<void> {
    const detalhe = JSON.stringify({
      evento: v.event ?? null,
      numero: v.display_phone_number ?? null,
      limite: v.current_limit ?? null,
      banimento: v.ban_info ?? null,
      violacao: v.violation_info ?? null,
      restricao: v.restriction_info ?? null,
    });
    this.log.error(`Meta avisou (${campo}): ${detalhe}`);
    try {
      await this.errors.reportar({
        origem: "api",
        message: `WhatsApp (Meta) ${campo}: ${v.event ?? "sem evento"}`,
        extra: { campo, evento: v.event ?? null, valor: v },
      });
    } catch (e) {
      this.log.warn(`não deu pra registrar o aviso da conta: ${(e as Error).message}`);
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
    // Antes de gravar: a linha diz de quem é o número e se este status é novo (a
    // Meta reenvia webhook — falha repetida não pode contar duas vezes).
    const antes = await comoSistema(() =>
      this.prisma.whatsappMensagem.findFirst({
        where: { idExterno: s.id },
        select: { telefone: true, direcao: true, statusEntrega: true },
      }),
    ).catch(() => null);

    const n = await comoSistema(() =>
      this.prisma.whatsappMensagem.updateMany({
        where: { idExterno: s.id },
        data: {
          statusEntrega: s.status,
          erroCodigo: erro?.code != null ? String(erro.code) : null,
        },
      }),
    );

    // Alcance do número (só a conferência diária lê). Falha aqui não pode custar
    // o 200 — o carimbo de entrega acima já está gravado.
    if (antes?.direcao === "SAIDA" && antes.telefone && antes.statusEntrega !== s.status) {
      try {
        if (s.status === "delivered" || s.status === "read") {
          await this.alcance.aoEntregar(antes.telefone);
        } else if (s.status === "failed") {
          await this.alcance.aoFalhar(antes.telefone, erro?.code);
        }
      } catch (e) {
        this.log.warn(`não deu pra atualizar o alcance do número: ${(e as Error).message}`);
      }
    }

    // Recibo da Meta na trilha da conferência (se o wamid for de uma pergunta ou
    // lembrete). Nunca lança; o dedupe (wamid,status) mora no helper.
    await comoSistema(() =>
      registrarStatusMetaNaConferencia(this.prisma, {
        wamid: s.id!,
        status: s.status!,
        codigo: erro?.code ?? null,
        titulo: erro?.title ?? null,
        mensagem: erro?.message ?? null,
        timestamp: s.timestamp ?? null,
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

/**
 * Os números que aparecem no evento.
 *
 * É o que diz pra qual inbox do Chatwoot cada coisa vai. Vem do corpo já
 * parseado — o repasse continua mandando o corpo CRU, porque reserializar
 * quebraria o `X-Hub-Signature-256`.
 */
function numerosDoCorpo(body: CorpoWebhook): string[] {
  const ids = new Set<string>();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
