import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  paramTemplateValido,
  templateWhatsapp,
  type ProvedorWhatsapp,
  type TemplateWhatsappDef,
} from "@ronan/shared-types";
import type { EnvioWhatsapp, ProvedorWhatsappClient, ResultadoEnvio } from "./envio.types";

/**
 * A Cloud API oficial da Meta como provedor.
 *
 * Configuração via env var:
 *   META_WHATSAPP_TOKEN            — token de acesso (System User, permanente)
 *   META_WHATSAPP_PHONE_NUMBER_ID  — id do número, NÃO o número em si
 *   META_GRAPH_VERSION             — opcional, default abaixo
 *
 * Sem token ou sem phone number id, `configurado()` é falso e a fachada nem
 * chama — a mensagem não sai e fica registrada como não enviada, em vez de
 * estourar 500 no caminho do OTP.
 *
 * Assim como o Evolution, **nunca lança por falha de envio**: devolve
 * `enviado: false` com o erro dentro. Quem transforma isso em 503 é a fachada.
 */

/**
 * A Meta quebra compatibilidade em major. Fixar, nunca usar a "mais nova".
 * v25.0 é o que o console do app da Movatruck monta nos exemplos de curl hoje
 * (conferido em 21/08/2026); versões antigas seguem no ar por ~2 anos.
 */
const VERSAO_PADRAO = "v25.0";

/**
 * Mesmo teto do Evolution. Folgado pro `messages` e curto o bastante pra não
 * segurar o cron que percorre motorista por motorista.
 */
const TIMEOUT_MS = 15_000;

type RespostaOk = { messages?: Array<{ id?: string }> };
type RespostaErro = {
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
};

@Injectable()
export class MetaProvedor implements ProvedorWhatsappClient {
  readonly nome: ProvedorWhatsapp = "meta";
  private readonly log = new Logger("MetaProvedor");
  private readonly token: string | undefined;
  private readonly phoneNumberId: string | undefined;
  private readonly versao: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>("META_WHATSAPP_TOKEN");
    this.phoneNumberId = config.get<string>("META_WHATSAPP_PHONE_NUMBER_ID");
    this.versao = config.get<string>("META_GRAPH_VERSION") ?? VERSAO_PADRAO;
  }

  configurado(): boolean {
    return !!(this.token && this.phoneNumberId);
  }

  async enviar(envio: EnvioWhatsapp): Promise<ResultadoEnvio> {
    // Defensivo: o roteamento já manda todo grupo pro Evolution. Se um dia
    // alguém contornar aquilo, a falha aqui diz o porquê em vez de virar um
    // erro cru da Meta sobre um "telefone" que na verdade é um JID.
    if (envio.destino.tipo === "GRUPO") {
      return this.falha("POLITICA", "GRUPO_NAO_SUPORTADO", "A Cloud API da Meta não posta em grupo.");
    }

    let corpo: Record<string, unknown>;
    try {
      corpo = this.montarCorpo(envio.destino.numero, envio);
    } catch (e) {
      // Payload que a gente sabe que a Meta recusaria. Falhar aqui é melhor:
      // o erro diz qual parâmetro está errado, e não gasta uma conversa.
      return this.falha("POLITICA", "PAYLOAD_INVALIDO", (e as Error).message);
    }

    return this.postar(corpo);
  }

  /**
   * Monta o payload e NÃO manda. É como se confere um template recém-aprovado
   * sem esperar o cron das 20h nem gastar uma conversa.
   *
   * Pega tudo que é erro de montagem — parâmetro faltando, `\n` no meio de um
   * valor, template com contagem diferente da que o envio manda. O que não
   * pega é o que só a Meta sabe: se o template existe lá com aquele nome e
   * naquele idioma. Pra isso, mandar de verdade.
   */
  simular(envio: EnvioWhatsapp): { ok: true; corpo: unknown } | { ok: false; erro: string } {
    if (envio.destino.tipo === "GRUPO") {
      return { ok: false, erro: "A Cloud API da Meta não posta em grupo." };
    }
    try {
      return { ok: true, corpo: this.montarCorpo(envio.destino.numero, envio) };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }

  /**
   * Template ou texto livre.
   *
   * Texto livre só chega ao destinatário dentro da janela de 24h desde a última
   * mensagem dele — e é o único formato possível pras rotas de `servico`, que
   * são texto que uma pessoa digitou na hora. Fora da janela a Meta recusa com
   * 131047, e isso é falha de política: não tem retry nem fallback que resolva.
   */
  private montarCorpo(numero: string, envio: EnvioWhatsapp): Record<string, unknown> {
    const base = { messaging_product: "whatsapp", recipient_type: "individual", to: numero };
    const template = templateWhatsapp(envio.rota);

    if (!template) return { ...base, type: "text", text: { preview_url: true, body: envio.texto } };

    return {
      ...base,
      type: "template",
      template: {
        name: template.nome,
        language: { code: template.idioma },
        components: this.componentes(template, envio),
      },
    };
  }

  private componentes(template: TemplateWhatsappDef, envio: EnvioWhatsapp): unknown[] {
    const params = envio.params ?? [];
    const pegar = (i: number, onde: string): string => {
      const v = params[i];
      if (v === undefined) {
        throw new Error(
          `template "${template.nome}" precisa de params[${i}] (${onde}), e o envio de ${envio.rota} mandou ${params.length}.`,
        );
      }
      // A Meta recusa a mensagem inteira por causa de um \n num parâmetro. O
      // erro dela não diz qual — este diz.
      if (!paramTemplateValido(v)) {
        throw new Error(
          `params[${i}] (${onde}) do template "${template.nome}" tem quebra de linha, tab ou 4+ espaços. Use achatarParam.`,
        );
      }
      return v;
    };

    const componentes: unknown[] = [
      {
        type: "body",
        parameters: template.corpo.map((i) => ({ type: "text", text: pegar(i, "corpo") })),
      },
    ];

    // Os dois tipos de botão têm o MESMO formato na linha: `sub_type: "url"`,
    // índice 0, um parâmetro de texto. No template de autenticação esse texto é
    // o código que o botão copia; no de URL dinâmica é o sufixo que completa a
    // URL base cadastrada na Meta. A distinção no catálogo é pra quem lê.
    if (template.botao) {
      componentes.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: pegar(template.botao.param, "botão") }],
      });
    }

    return componentes;
  }

  private async postar(corpo: Record<string, unknown>): Promise<ResultadoEnvio> {
    const url = `https://graph.facebook.com/${this.versao}/${this.phoneNumberId}/messages`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpo),
        signal: ac.signal,
      });

      const json = (await res.json().catch(() => null)) as (RespostaOk & RespostaErro) | null;

      if (!res.ok) {
        const err = json?.error;
        const detalhe = [err?.message, err?.error_data?.details].filter(Boolean).join(" — ");
        return this.falha(
          // 5xx é a Meta fora do ar: dá pra tentar de novo. Todo o resto —
          // template reprovado, janela expirada, número limitado, token
          // vencido — é política, e repetir só queima conversa e reputação.
          res.status >= 500 ? "TRANSPORTE" : "POLITICA",
          err?.code != null ? `META_${err.code}` : `META_HTTP_${res.status}`,
          detalhe || `A Meta respondeu ${res.status}.`,
        );
      }

      const id = json?.messages?.[0]?.id;
      if (!id) {
        // 200 sem wamid não é aceite. Tratar como enviado deixaria o
        // compartilhamento marcar `enviadoEm` de uma mensagem que não saiu.
        this.log.error(`Meta respondeu 200 sem wamid: ${JSON.stringify(json).slice(0, 300)}`);
        return this.falha("TRANSPORTE", "META_SEM_WAMID", "A Meta aceitou mas não devolveu o id da mensagem.");
      }

      return { enviado: true, provedor: this.nome, idExterno: id };
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? `A Meta não respondeu em ${TIMEOUT_MS / 1000}s.` : (e as Error).message;
      return this.falha("TRANSPORTE", "META_INDISPONIVEL", msg);
    } finally {
      clearTimeout(t);
    }
  }

  private falha(
    tipo: "TRANSPORTE" | "POLITICA",
    codigo: string,
    detalhe: string,
  ): ResultadoEnvio {
    return { enviado: false, provedor: this.nome, idExterno: null, erro: { tipo, codigo, detalhe } };
  }
}
