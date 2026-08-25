import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigService } from "@nestjs/config";
import {
  BASE_URL_MINIMAX,
  chaveDoProvedor,
  provedorDoModelo,
  type ProvedorIa,
} from "../common/ia/provedor-ia";

/**
 * Um cliente de IA por fornecedor, escolhido pelo id do modelo.
 *
 * Existe porque o MiniMax fala a API da Anthropic: o mesmo `@anthropic-ai/sdk`
 * atende os dois trocando `baseURL` e chave. Sem isto, cada chamada teria que
 * decidir sozinha qual cliente usar — e `new Anthropic(...)` já estava
 * duplicado em dois arquivos, cada um com a mesma justificativa de timeout
 * copiada por cima.
 *
 * O cache é POR FORNECEDOR, não por modelo: o modelo vai no corpo do request,
 * não no cliente. Dois modelos do mesmo fornecedor compartilham conexão.
 */

/**
 * Timeout e retries explícitos. O default do SDK é 10 min por tentativa e 2
 * retries — até 30 min de relógio numa chamada só. Num endpoint que o motorista
 * está esperando isso é inaceitável, e num worker é pior ainda: segura uma vaga
 * de execução pelo mesmo tempo.
 */
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

/** Modelo pedido cujo fornecedor não tem chave. Distinto de erro de rede. */
export class ProvedorIaNaoConfigurado extends Error {
  constructor(readonly provedor: ProvedorIa, readonly modelo: string) {
    super(`${chaveDoProvedor(provedor)} não configurada — modelo "${modelo}" indisponível`);
    this.name = "ProvedorIaNaoConfigurado";
  }
}

@Injectable()
export class ClienteIaFactory {
  private readonly log = new Logger(ClienteIaFactory.name);
  private readonly clientes = new Map<ProvedorIa, Anthropic>();

  constructor(private readonly config: ConfigService) {}

  /** A chave daquele fornecedor, ou `undefined`. */
  private apiKey(provedor: ProvedorIa): string | undefined {
    return this.config.get<string>(chaveDoProvedor(provedor))?.trim() || undefined;
  }

  /** Dá pra chamar este modelo? Use antes de prometer que a leitura vai sair. */
  disponivel(modelo: string): boolean {
    return !!this.apiKey(provedorDoModelo(modelo));
  }

  /** Existe chave de ALGUM fornecedor — o worker usa pra decidir se roda. */
  get algumProvedorConfigurado(): boolean {
    return !!this.apiKey("anthropic") || !!this.apiKey("minimax");
  }

  /**
   * O cliente que atende este modelo.
   *
   * Lança `ProvedorIaNaoConfigurado` quando falta a chave, em vez de devolver
   * `undefined`: chave ausente é erro de configuração e tem que aparecer com
   * nome, não virar `cannot read property of undefined` três frames adiante.
   */
  para(modelo: string): Anthropic {
    const provedor = provedorDoModelo(modelo);
    const existente = this.clientes.get(provedor);
    if (existente) return existente;

    const apiKey = this.apiKey(provedor);
    if (!apiKey) throw new ProvedorIaNaoConfigurado(provedor, modelo);

    const cliente = new Anthropic({
      apiKey,
      timeout: TIMEOUT_MS, // milissegundos no SDK TS
      maxRetries: MAX_RETRIES,
      ...(provedor === "minimax" ? { baseURL: this.baseUrlMinimax() } : {}),
    });
    this.clientes.set(provedor, cliente);
    this.log.log(`Cliente de IA criado para ${provedor}`);
    return cliente;
  }

  /**
   * Sobrescrevível por env — o MiniMax tem endpoint separado pra China
   * (`api.minimaxi.com`) e o de cá é o `.io`. Sem a env, o global.
   */
  private baseUrlMinimax(): string {
    return this.config.get<string>("MINIMAX_BASE_URL")?.trim() || BASE_URL_MINIMAX;
  }
}
