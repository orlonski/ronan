import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * O pouco que a gente precisa da API do Chatwoot: responder numa conversa e
 * entregá-la pra um humano.
 *
 * Env vars:
 *   CHATWOOT_URL       — base pública (`https://atendimento.movatruck.com.br`)
 *   CHATWOOT_API_TOKEN — token de acesso de um agente (Perfil → Token de acesso)
 *
 * Sem as duas, `configurado()` é false e o agente não responde nada — melhor
 * calado do que respondendo no vazio.
 */

/** O Chatwoot é nosso, na mesma máquina. Se demorar mais que isso, caiu. */
const TIMEOUT_MS = 10_000;

/** Etiqueta que marca conversa que o robô não deu conta. */
export const LABEL_PRECISA_HUMANO = "precisa-humano";

@Injectable()
export class ChatwootClientService {
  private readonly log = new Logger("ChatwootClient");
  private readonly base: string;
  private readonly token: string;
  /**
   * A conta e o inbox usados quando somos NÓS que começamos.
   *
   * No caminho do webhook os dois vêm no evento — quem escreveu já disse onde.
   * Partindo do painel não há evento nenhum, e sem esses dois números não dá
   * pra criar contato nem conversa. Ficam em env porque são de instalação, não
   * de código.
   */
  private readonly contaPadraoId: number | null;
  private readonly inboxPadraoId: number | null;
  /** Cache do que foi perguntado ao Chatwoot. `undefined` = ainda não perguntei. */
  private contaDescoberta: number | null | undefined;
  private inboxDescoberto: number | null | undefined;

  constructor(config: ConfigService) {
    this.base = (config.get<string>("CHATWOOT_URL") ?? "").trim().replace(/\/+$/, "");
    this.token = (config.get<string>("CHATWOOT_API_TOKEN") ?? "").trim();
    this.contaPadraoId = inteiroPositivo(config.get<string>("CHATWOOT_CONTA_ID"));
    this.inboxPadraoId = inteiroPositivo(config.get<string>("CHATWOOT_INBOX_COMERCIAL"));
  }

  /**
   * A conta do Chatwoot pra quem parte do painel.
   *
   * Env quando houver; senão, PERGUNTA — `/api/v1/profile` diz de quais contas
   * este token é agente, e numa instalação nossa é sempre uma. Descobrir sai
   * mais barato que um env a mais pra configurar na mão em cada ambiente e
   * esquecer num deles.
   */
  async contaPadrao(): Promise<number | null> {
    if (this.contaPadraoId) return this.contaPadraoId;
    if (this.contaDescoberta !== undefined) return this.contaDescoberta;

    const r = await this.requisitar("/api/v1/profile", { metodo: "GET" });
    const contas = (r.corpo as { accounts?: { id?: number }[] } | null)?.accounts;
    const id = Array.isArray(contas) && contas.length > 0 ? contas[0]?.id : undefined;
    this.contaDescoberta = typeof id === "number" ? id : null;
    if (this.contaDescoberta) this.log.log(`conta ${this.contaDescoberta} descoberta no perfil`);
    return this.contaDescoberta;
  }

  /**
   * O inbox por onde falar com um prospect.
   *
   * `CHATWOOT_INBOX_COMERCIAL` manda. Sem ele, só resolve quando existe UM
   * canal de WhatsApp — com dois, escolher por conta própria significaria
   * mandar mensagem de venda pelo número da operação, e um palpite errado aqui
   * chega no telefone de gente de verdade.
   */
  async inboxPadrao(contaId: number): Promise<number | null> {
    if (this.inboxPadraoId) return this.inboxPadraoId;
    if (this.inboxDescoberto !== undefined) return this.inboxDescoberto;

    const r = await this.requisitar(`/api/v1/accounts/${contaId}/inboxes`, { metodo: "GET" });
    const lista = (r.corpo as { payload?: { id?: number; channel_type?: string }[] } | null)
      ?.payload;
    const whatsapp = Array.isArray(lista)
      ? lista.filter((i) => (i?.channel_type ?? "").toLowerCase().includes("whatsapp"))
      : [];

    if (whatsapp.length !== 1) {
      this.log.warn(
        `${whatsapp.length} canais de WhatsApp no Chatwoot — defina CHATWOOT_INBOX_COMERCIAL pra dizer por qual falar.`,
      );
      this.inboxDescoberto = null;
      return null;
    }
    this.inboxDescoberto = whatsapp[0]?.id ?? null;
    if (this.inboxDescoberto) this.log.log(`inbox ${this.inboxDescoberto} é o único de WhatsApp`);
    return this.inboxDescoberto;
  }

  configurado(): boolean {
    return this.base.length > 0 && this.token.length > 0;
  }

  /**
   * O endereço que abre a conversa na tela do Chatwoot.
   *
   * Quem monta é a API, não o painel: a URL do Chatwoot já é env DAQUI, e
   * repetir `CHATWOOT_URL` no dashboard criaria um segundo lugar pra
   * desatualizar no dia que o domínio mudar.
   */
  linkDaConversa(contaId: number | null, conversaId: number | null): string | null {
    if (!this.base || !contaId || !conversaId) return null;
    return `${this.base}/app/accounts/${contaId}/conversations/${conversaId}`;
  }

  /**
   * Escreve a ficha do lead no contato do Chatwoot.
   *
   * `additional_attributes` são campos que o Chatwoot já desenha sozinho na
   * barra lateral (empresa, cidade, descrição) — funcionam sem configurar
   * nada. `custom_attributes` são os nossos (CNPJ, nota, situação no funil) e
   * só APARECEM depois de criados em Configurações → Atributos
   * personalizados, com a mesma chave; a gravação funciona de qualquer jeito,
   * mas sem isso o atendente não vê. Está em `docs/chatwoot-leads.md`.
   */
  async atualizarContato(
    contaId: number,
    contatoId: number,
    dados: {
      additional_attributes?: Record<string, unknown>;
      custom_attributes?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    return this.chamar(`/api/v1/accounts/${contaId}/contacts/${contatoId}`, dados, "PUT");
  }

  /**
   * O contato desse telefone no Chatwoot — achando ou criando.
   *
   * Devolve também o `sourceId`, que é o endereço da pessoa DENTRO do inbox:
   * sem ele não existe conversa, e um contato sem conversa é só uma linha numa
   * lista. O Chatwoot cria esse vínculo junto com o contato quando recebe o
   * `inbox_id`; pro contato que já existia (porque ele escreveu um dia) o
   * vínculo é pedido à parte.
   *
   * Nunca lança: devolve `null` e quem chamou decide.
   */
  async garantirContato(
    contaId: number,
    inboxId: number,
    dados: { nome: string; telefoneE164: string },
  ): Promise<{ contatoId: number; sourceId: string | null } | null> {
    const achado = await this.acharContato(contaId, dados.telefoneE164);
    if (achado) {
      const sourceId =
        achado.sourceId ?? (await this.garantirVinculoComInbox(contaId, achado.contatoId, inboxId));
      return { contatoId: achado.contatoId, sourceId };
    }

    const criado = await this.requisitar(`/api/v1/accounts/${contaId}/contacts`, {
      metodo: "POST",
      corpo: { inbox_id: inboxId, name: dados.nome, phone_number: dados.telefoneE164 },
      // 422 aqui é quase sempre "esse telefone já é de outro contato" — a
      // busca por telefone não acha contato sem nome em algumas versões. Não é
      // erro pra logar como falha; é motivo pra procurar de novo.
      silenciar: [422],
    });

    if (!criado.ok) {
      const segundaTentativa = await this.acharContato(contaId, dados.telefoneE164);
      if (!segundaTentativa) return null;
      const sourceId =
        segundaTentativa.sourceId ??
        (await this.garantirVinculoComInbox(contaId, segundaTentativa.contatoId, inboxId));
      return { contatoId: segundaTentativa.contatoId, sourceId };
    }

    const contato = extrairContato(criado.corpo);
    if (!contato) return null;
    const sourceId =
      contato.sourceId ?? (await this.garantirVinculoComInbox(contaId, contato.contatoId, inboxId));
    return { contatoId: contato.contatoId, sourceId };
  }

  /**
   * Abre a conversa com esse contato. Devolve o id.
   *
   * **Não manda mensagem nenhuma.** Criar a conversa é só preparar o lugar —
   * quem escreve a primeira palavra pra um lead frio é uma pessoa, escolhendo
   * o template na tela do Chatwoot.
   */
  async criarConversa(
    contaId: number,
    inboxId: number,
    contatoId: number,
    sourceId: string,
  ): Promise<number | null> {
    const r = await this.requisitar(`/api/v1/accounts/${contaId}/conversations`, {
      metodo: "POST",
      corpo: { inbox_id: inboxId, contact_id: contatoId, source_id: sourceId },
    });
    if (!r.ok) return null;
    const id = (r.corpo as { id?: number } | null)?.id;
    return typeof id === "number" ? id : null;
  }

  /** Procura pelo telefone. `null` quando não existe (ou quando falhou). */
  private async acharContato(
    contaId: number,
    telefoneE164: string,
  ): Promise<{ contatoId: number; sourceId: string | null } | null> {
    const r = await this.requisitar(
      `/api/v1/accounts/${contaId}/contacts/search?q=${encodeURIComponent(telefoneE164)}`,
      { metodo: "GET" },
    );
    if (!r.ok) return null;
    const lista = (r.corpo as { payload?: unknown[] } | null)?.payload;
    if (!Array.isArray(lista)) return null;
    // A busca é por texto: pode voltar mais de um. Só serve o telefone IGUAL —
    // casar por semelhança aqui escreveria a ficha de uma empresa no contato
    // de outra.
    const exato = lista.find(
      (c) => (c as { phone_number?: string })?.phone_number === telefoneE164,
    );
    return exato ? extrairContato({ payload: { contact: exato } }) : null;
  }

  /** O contato existe mas nunca falou por este inbox: cria o vínculo. */
  private async garantirVinculoComInbox(
    contaId: number,
    contatoId: number,
    inboxId: number,
  ): Promise<string | null> {
    const r = await this.requisitar(
      `/api/v1/accounts/${contaId}/contacts/${contatoId}/contact_inboxes`,
      { metodo: "POST", corpo: { inbox_id: inboxId } },
    );
    if (!r.ok) return null;
    const corpo = r.corpo as { source_id?: string; payload?: { source_id?: string } } | null;
    return corpo?.source_id ?? corpo?.payload?.source_id ?? null;
  }

  /** Responde na conversa como agente. */
  async responder(contaId: number, conversaId: number, texto: string): Promise<boolean> {
    return this.chamar(`/api/v1/accounts/${contaId}/conversations/${conversaId}/messages`, {
      content: texto,
      message_type: "outgoing",
    });
  }

  /**
   * Devolve a conversa pra fila humana: status `open` tira ela do bot, e a
   * etiqueta deixa medir depois quanto o robô resolveu sozinho.
   *
   * As duas chamadas são independentes: falhar a etiqueta não pode impedir o
   * repasse pro humano, que é o que importa.
   */
  async passarParaHumano(contaId: number, conversaId: number): Promise<void> {
    await this.chamar(`/api/v1/accounts/${contaId}/conversations/${conversaId}/toggle_status`, {
      status: "open",
    });
    await this.chamar(`/api/v1/accounts/${contaId}/conversations/${conversaId}/labels`, {
      labels: [LABEL_PRECISA_HUMANO],
    });
  }

  /**
   * A conversa já está etiquetada assim?
   *
   * É o que permite não repetir um aviso que já foi dado. A etiqueta é o
   * estado que sobrevive ao processo: dois webhooks seguidos caem em execuções
   * diferentes, e nenhuma memória nossa dura entre elas.
   *
   * Erro de rede devolve `false` — na dúvida a pessoa recebe a resposta duas
   * vezes, que é melhor que ficar sem nenhuma.
   */
  async temEtiqueta(contaId: number, conversaId: number, etiqueta: string): Promise<boolean> {
    const r = await this.requisitar(
      `/api/v1/accounts/${contaId}/conversations/${conversaId}/labels`,
      { metodo: "GET" },
    );
    if (!r.ok) return false;
    const payload = (r.corpo as { payload?: unknown } | null)?.payload;
    return Array.isArray(payload) && payload.includes(etiqueta);
  }

  /**
   * Nunca lança. Quem chama está no meio de um webhook que precisa responder
   * 200 — o Chatwoot reenvia o que falha, e reenviar mensagem de agente
   * duplicaria resposta na cara do motorista.
   */
  private async chamar(
    caminho: string,
    corpo: Record<string, unknown>,
    metodo: "POST" | "PUT" = "POST",
  ): Promise<boolean> {
    const r = await this.requisitar(caminho, { metodo, corpo });
    return r.ok;
  }

  /**
   * Nunca lança. Quem chama está no meio de um webhook que precisa responder
   * 200 — o Chatwoot reenvia o que falha, e reenviar mensagem de agente
   * duplicaria resposta na cara do motorista.
   */
  private async requisitar(
    caminho: string,
    opcoes: {
      metodo: "GET" | "POST" | "PUT";
      corpo?: Record<string, unknown>;
      /** Status que não viram log de erro (ex.: 422 de telefone repetido). */
      silenciar?: number[];
    },
  ): Promise<{ ok: boolean; corpo: unknown }> {
    if (!this.configurado()) {
      this.log.error("CHATWOOT_URL ou CHATWOOT_API_TOKEN ausentes — nada foi enviado");
      return { ok: false, corpo: null };
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}${caminho}`, {
        method: opcoes.metodo,
        headers: {
          "Content-Type": "application/json",
          api_access_token: this.token,
        },
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
        signal: ac.signal,
      });
      if (!res.ok) {
        if (!opcoes.silenciar?.includes(res.status)) {
          const detalhe = await res.text().catch(() => "");
          this.log.error(`Chatwoot recusou ${caminho} (${res.status}): ${detalhe.slice(0, 200)}`);
        }
        return { ok: false, corpo: null };
      }
      const texto = await res.text().catch(() => "");
      return { ok: true, corpo: texto ? seguroJson(texto) : null };
    } catch (e) {
      const msg =
        (e as Error).name === "AbortError"
          ? `Chatwoot não respondeu em ${TIMEOUT_MS / 1000}s`
          : (e as Error).message;
      this.log.error(`falha ao chamar ${caminho}: ${msg}`);
      return { ok: false, corpo: null };
    } finally {
      clearTimeout(t);
    }
  }
}

function inteiroPositivo(bruto: string | undefined): number | null {
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function seguroJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/**
 * O contato e o `source_id` dele, de onde quer que o Chatwoot os tenha posto.
 *
 * A criação devolve `{payload: {contact: {...}}}` e a busca devolve o contato
 * cru; o vínculo com o inbox às vezes vem em `contact_inboxes`, às vezes não
 * vem. Um lugar só pra ler os três formatos evita espalhar `?.` pelo serviço.
 */
function extrairContato(corpo: unknown): { contatoId: number; sourceId: string | null } | null {
  const c =
    (corpo as { payload?: { contact?: Record<string, unknown> } })?.payload?.contact ??
    (corpo as { payload?: Record<string, unknown> })?.payload ??
    (corpo as Record<string, unknown>);
  const id = (c as { id?: number })?.id;
  if (typeof id !== "number") return null;
  const vinculos = (c as { contact_inboxes?: { source_id?: string }[] })?.contact_inboxes;
  const sourceId = Array.isArray(vinculos) ? (vinculos[0]?.source_id ?? null) : null;
  return { contatoId: id, sourceId };
}
