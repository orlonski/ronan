import { Injectable, Logger } from "@nestjs/common";
import {
  provedorAtendeRota,
  rotaWhatsapp,
  type ProvedorWhatsapp,
  type RotaWhatsapp,
} from "@ronan/shared-types";
import { contaAtual } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";

/** Pra onde tudo vai enquanto ninguém escolher nada. */
const PROVEDOR_PADRAO: ProvedorWhatsapp = "evolution";

/**
 * Quanto tempo a config fica em memória.
 *
 * O cron do resumo diário resolve a rota uma vez por motorista, em loop — sem
 * cache seria uma consulta por mensagem. 30s é curto o bastante pra virar uma
 * rota em produção e ver o efeito quase na hora (o rollback de uma rota é a
 * própria tela, não um deploy).
 */
const CACHE_MS = 30_000;

type ConfigRoteamento = {
  rotas: Record<string, ProvedorWhatsapp>;
  telefonesTeste: string[];
};

const CONFIG_VAZIA: ConfigRoteamento = { rotas: {}, telefonesTeste: [] };

/**
 * Decide por qual serviço cada mensagem sai.
 *
 * A régua, em ordem:
 *   1. Destino é grupo → Evolution, sempre. A Cloud API não posta em grupo, e
 *      isso não é uma escolha de configuração.
 *   2. Telefone está na allowlist de teste → o provedor alternativo, mesmo com
 *      a rota apontada pro padrão. É como se testa em produção sem virar a
 *      chave pra ninguém.
 *   3. Escolha gravada pra essa rota nesta conta.
 *   4. Padrão do código.
 * E, no fim, uma trava: se o provedor resolvido não atende a rota (segundo o
 * catálogo), cai no padrão.
 */
@Injectable()
export class RoteamentoWhatsappService {
  private readonly log = new Logger("RoteamentoWhatsapp");
  private cache = new Map<string, { em: number; config: ConfigRoteamento }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Joga o cache fora (chamado ao salvar a config). */
  invalidar(contaId?: string): void {
    if (contaId) this.cache.delete(contaId);
    else this.cache.clear();
  }

  async resolver(opts: {
    rota: RotaWhatsapp;
    destinoEhGrupo: boolean;
    telefone?: string;
  }): Promise<{ provedor: ProvedorWhatsapp; motivo: string }> {
    const def = rotaWhatsapp(opts.rota);
    if (!def) {
      // Rota que saiu do catálogo. Nunca deixa de enviar por causa disso.
      this.log.warn(`rota desconhecida "${opts.rota}" — indo pelo padrão`);
      return { provedor: PROVEDOR_PADRAO, motivo: "rota fora do catálogo" };
    }

    if (opts.destinoEhGrupo) {
      return { provedor: "evolution", motivo: "destino é grupo (a Cloud API não posta em grupo)" };
    }

    const config = await this.config();

    if (opts.telefone && config.telefonesTeste.includes(opts.telefone)) {
      const alternativo = def.provedores.find((p) => p !== PROVEDOR_PADRAO);
      if (alternativo) {
        return { provedor: alternativo, motivo: "telefone na allowlist de teste" };
      }
    }

    const escolhido = config.rotas[opts.rota];
    if (escolhido && provedorAtendeRota(opts.rota, escolhido)) {
      return { provedor: escolhido, motivo: "escolha gravada pra esta empresa" };
    }
    if (escolhido) {
      this.log.warn(`rota ${opts.rota} gravada como "${escolhido}", que não a atende — usando padrão`);
    }
    return { provedor: PROVEDOR_PADRAO, motivo: "padrão do sistema" };
  }

  /**
   * A config da conta em que a requisição está.
   *
   * Usa `contaAtual()`, NUNCA `contaIdAtual()`. O `contaIdAtual()` **lança**
   * quando não há conta no contexto, e o pedido de redefinição de senha resolve
   * o CPF dentro de `comoSistema(...)` — ou seja, mandar o código roda sem
   * conta. Ler a config com `contaIdAtual()` transformaria um endpoint público
   * de login num 500.
   *
   * Sem conta, e em qualquer erro de leitura, devolve config vazia: o roteamento
   * cai no padrão e a mensagem sai. Uma tabela de configuração fora do ar não
   * pode impedir motorista de receber código.
   */
  private async config(): Promise<ConfigRoteamento> {
    const contaId = contaAtual()?.contaId ?? null;
    if (!contaId) return CONFIG_VAZIA;

    const cacheado = this.cache.get(contaId);
    if (cacheado && Date.now() - cacheado.em < CACHE_MS) return cacheado.config;

    try {
      const linha = await this.prisma.configuracaoRoteamentoWhatsapp.findFirst({
        select: { rotas: true, telefonesTeste: true },
      });
      const config: ConfigRoteamento = {
        rotas: (linha?.rotas as Record<string, ProvedorWhatsapp> | null) ?? {},
        telefonesTeste: linha?.telefonesTeste ?? [],
      };
      this.cache.set(contaId, { em: Date.now(), config });
      return config;
    } catch (e) {
      this.log.error(`não deu pra ler o roteamento: ${(e as Error).message} — indo pelo padrão`);
      return CONFIG_VAZIA;
    }
  }
}
