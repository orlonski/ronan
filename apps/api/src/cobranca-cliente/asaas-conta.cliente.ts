import { Logger } from "@nestjs/common";
import { ErroGateway } from "../assinaturas/gateway.types";
import type { PagamentoAsaas } from "../assinaturas/asaas.provedor";

/**
 * O Asaas DE UMA TRANSPORTADORA, falando com a chave dela.
 *
 * Por que não reaproveitar o `AsaasProvedor` da mensalidade: ele é um singleton
 * amarrado à chave da Movatruck (`ASAAS_API_KEY`), e é de propósito — aquele
 * dinheiro é nosso. Aqui cada requisição usa a chave de uma conta diferente, e
 * misturar os dois num objeto só é o caminho mais curto pra um boleto de
 * cliente cair na conta da Movatruck (ou o contrário). Reaproveita-se o que é
 * neutro: o `ErroGateway` e o formato do pagamento.
 *
 * Não é `@Injectable`: nasce por requisição, com a chave já decifrada, e morre
 * com ela. A chave nunca é logada.
 */
export type OpcoesClienteAsaas = {
  chave: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Teste troca por um dublê. */
  buscar?: typeof fetch;
};

export type ContaAsaasInfo = { nome: string | null; documento: string | null; email: string | null };

/** Pagamento com os campos que esta borda usa além dos da mensalidade. */
export type PagamentoAsaasCliente = PagamentoAsaas & {
  deleted?: boolean;
  bankSlipUrl?: string | null;
  description?: string | null;
};

export type NovoWebhookAsaas = {
  nome: string;
  url: string;
  email: string;
  authToken: string;
  eventos: string[];
};

/** O ambiente vira URL num lugar só. */
export function baseUrlAsaas(ambiente: "SANDBOX" | "PRODUCAO", override?: string | null): string {
  if (override) return override.replace(/\/+$/, "");
  return ambiente === "PRODUCAO" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

export class ClienteAsaasConta {
  private readonly log = new Logger("AsaasDaTransportadora");
  private readonly buscar: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opcoes: OpcoesClienteAsaas) {
    this.buscar = opcoes.buscar ?? fetch;
    this.timeoutMs = opcoes.timeoutMs ?? 20_000;
  }

  /**
   * Quem é o dono da chave. É o "testar conexão": uma chave inválida responde
   * 401 aqui, e o nome que volta é a prova, pra quem colou, de que o dinheiro
   * vai cair na conta certa.
   */
  async minhaConta(): Promise<ContaAsaasInfo> {
    try {
      const c = await this.requisitar<{
        name?: string;
        companyName?: string;
        cpfCnpj?: string;
        email?: string;
      }>("GET", "/myAccount/commercialInfo/");
      return {
        nome: c.companyName || c.name || null,
        documento: c.cpfCnpj ? c.cpfCnpj.replace(/\D/g, "") : null,
        email: c.email ?? null,
      };
    } catch (e) {
      // Algumas contas (subcontas antigas, chaves com escopo reduzido) não
      // enxergam os dados comerciais. O saldo prova que a chave funciona, que é
      // o que importa pra conectar; o nome fica em branco.
      if (e instanceof ErroGateway && (e.status === 404 || e.status === 403)) {
        await this.requisitar("GET", "/finance/balance");
        return { nome: null, documento: null, email: null };
      }
      throw e;
    }
  }

  /** Acha o cliente pelo documento ANTES de criar: o Asaas aceita CNPJ repetido sem reclamar. */
  async garantirCliente(dados: { nome: string; documento: string; email?: string | null; referencia: string }): Promise<string> {
    const achados = await this.requisitar<{ data?: { id: string; deleted?: boolean }[] }>(
      "GET",
      `/customers?cpfCnpj=${encodeURIComponent(dados.documento)}&limit=10`,
    );
    const vivo = achados.data?.find((c) => !c.deleted)?.id;
    if (vivo) return vivo;
    // Notificação do Asaas (e-mail/SMS do boleto pro cliente) fica como a
    // transportadora configurou na conta dela: a conta é dela, as tarifas
    // também. Não ligamos nem desligamos nada por cima.
    const criado = await this.requisitar<{ id: string }>("POST", "/customers", {
      name: dados.nome,
      cpfCnpj: dados.documento,
      email: dados.email || undefined,
      externalReference: dados.referencia,
    });
    return criado.id;
  }

  /** Cobrança viva (pendente ou vencida) já criada pra esta referência — a rede da idempotência. */
  async cobrancaVivaDaReferencia(referencia: string): Promise<PagamentoAsaasCliente | null> {
    const r = await this.requisitar<{ data?: PagamentoAsaasCliente[] }>(
      "GET",
      `/payments?externalReference=${encodeURIComponent(referencia)}&limit=20`,
    );
    return r.data?.find((p) => !p.deleted && (p.status === "PENDING" || p.status === "OVERDUE")) ?? null;
  }

  /**
   * `billingType: UNDEFINED` = "pergunte ao cliente": a página do Asaas oferece
   * boleto, Pix e cartão, e quem paga escolhe. É o que dispensa a
   * transportadora de decidir por ele.
   */
  criarCobranca(dados: {
    cliente: string;
    valor: string;
    vencimento: string;
    descricao: string;
    referencia: string;
  }): Promise<PagamentoAsaasCliente> {
    return this.requisitar<PagamentoAsaasCliente>("POST", "/payments", {
      customer: dados.cliente,
      billingType: "UNDEFINED",
      value: Number(dados.valor),
      dueDate: dados.vencimento,
      description: dados.descricao,
      externalReference: dados.referencia,
    });
  }

  async buscarCobranca(id: string): Promise<PagamentoAsaasCliente | null> {
    try {
      return await this.requisitar<PagamentoAsaasCliente>("GET", `/payments/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof ErroGateway && e.status === 404) return null;
      throw e;
    }
  }

  /** Linha digitável do boleto. Opcional: falhar aqui não pode derrubar a cobrança já criada. */
  async linhaDigitavel(id: string): Promise<string | null> {
    try {
      const r = await this.requisitar<{ identificationField?: string }>(
        "GET",
        `/payments/${encodeURIComponent(id)}/identificationField`,
      );
      return r.identificationField ?? null;
    } catch {
      return null;
    }
  }

  /** Pix copia-e-cola. A conta sem chave Pix cadastrada não tem — e a página do Asaas segue funcionando. */
  async pixCopiaCola(id: string): Promise<string | null> {
    try {
      const r = await this.requisitar<{ payload?: string }>("GET", `/payments/${encodeURIComponent(id)}/pixQrCode`);
      return r.payload ?? null;
    } catch {
      return null;
    }
  }

  /** Apaga a cobrança no Asaas. 404 = já não existia, que é o objetivo. */
  async cancelarCobranca(id: string): Promise<void> {
    try {
      await this.requisitar("DELETE", `/payments/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof ErroGateway && e.status === 404) return;
      throw e;
    }
  }

  async listarWebhooks(): Promise<{ id: string; url?: string }[]> {
    const r = await this.requisitar<{ data?: { id: string; url?: string }[] }>("GET", "/webhooks?limit=50");
    return r.data ?? [];
  }

  /**
   * Registra o webhook na conta dela.
   *
   * `SEQUENTIALLY`: o Asaas manda um evento por vez, na ordem. Não dispensa a
   * proteção contra ordem trocada (reenvio após falha embaralha do mesmo
   * jeito), mas faz dela a exceção e não a regra.
   */
  criarWebhook(w: NovoWebhookAsaas): Promise<{ id: string }> {
    return this.requisitar<{ id: string }>("POST", "/webhooks", {
      name: w.nome,
      url: w.url,
      email: w.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: w.authToken,
      sendType: "SEQUENTIALLY",
      events: w.eventos,
    });
  }

  async removerWebhook(id: string): Promise<void> {
    try {
      await this.requisitar("DELETE", `/webhooks/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof ErroGateway && e.status === 404) return;
      throw e;
    }
  }

  // --- HTTP ---------------------------------------------------------------

  private async requisitar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), this.timeoutMs);
    let resposta: Response;
    try {
      resposta = await this.buscar(`${this.opcoes.baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          access_token: this.opcoes.chave,
          "Content-Type": "application/json",
          "User-Agent": "Movatruck",
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle.signal,
      });
    } catch (erro) {
      throw new ErroGateway(null, true, `Não foi possível falar com o Asaas: ${(erro as Error).message}`);
    } finally {
      clearTimeout(relogio);
    }

    const texto = await resposta.text();
    if (!resposta.ok) {
      let descricao = texto.slice(0, 300);
      try {
        const json = JSON.parse(texto) as { errors?: { description?: string }[] };
        if (json.errors?.[0]?.description) descricao = json.errors.map((e) => e.description).join(" · ");
      } catch {
        // HTML de proxy, corpo vazio: fica o texto cru.
      }
      if (resposta.status === 401) {
        descricao = "O Asaas recusou a chave de API. Confira se ela foi copiada inteira e se não foi revogada.";
      }
      this.log.warn(`${metodo} ${caminho.split("?")[0]} → ${resposta.status}: ${descricao}`);
      throw new ErroGateway(resposta.status, resposta.status >= 500 || resposta.status === 429, descricao);
    }
    return (texto ? JSON.parse(texto) : {}) as T;
  }
}
