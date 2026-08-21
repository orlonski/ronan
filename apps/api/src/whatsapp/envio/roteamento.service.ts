import { Injectable, Logger } from "@nestjs/common";
import {
  provedorAtendeRota,
  rotaWhatsapp,
  type ProvedorWhatsapp,
  type RotaWhatsapp,
} from "@ronan/shared-types";
import { comoSistema, contaAtual } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Pra onde tudo vai enquanto ninguém escolher nada.
 *
 * Era `evolution` — e fazia sentido enquanto o Evolution era o caminho que
 * funcionava. Em 21/08/2026 o número dele foi banido, e o padrão antigo passou
 * a significar que toda transportadora NOVA nasceria apontada pra um canal
 * morto, sem ninguém mexer em nada.
 */
const PROVEDOR_PADRAO: ProvedorWhatsapp = "meta";

/**
 * Quanto tempo a config fica em memória.
 *
 * O cron do resumo diário resolve a rota uma vez por motorista, em loop — sem
 * cache seria uma consulta por mensagem. 30s é curto o bastante pra virar uma
 * rota em produção e ver o efeito quase na hora (o rollback de uma rota é a
 * própria tela, não um deploy).
 */
const CACHE_MS = 30_000;

/**
 * O padrão PARA AQUELA ROTA.
 *
 * Não é sempre `PROVEDOR_PADRAO`: o aviso de grupo só o Evolution entrega, e
 * cair no padrão global mandaria ele pra um provedor que a Cloud API não
 * consegue servir. Enquanto o padrão era `evolution` isso não aparecia — as
 * duas coisas coincidiam. Virou visível no dia em que o padrão mudou.
 */
function padraoDaRota(rota: string): ProvedorWhatsapp {
  if (provedorAtendeRota(rota, PROVEDOR_PADRAO)) return PROVEDOR_PADRAO;
  const def = rotaWhatsapp(rota);
  return (def?.provedores[0] as ProvedorWhatsapp | undefined) ?? PROVEDOR_PADRAO;
}

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
 *   2. Rota de PLATAFORMA → a escolha única, ignorando a conta. São as rotas
 *      sobre a pessoa (código de acesso), e a conta não manda nelas.
 *   3. Telefone está na allowlist de teste → Meta, mesmo com a rota da empresa
 *      ainda no Evolution. É como se valida a Meta numa conta sem virar a
 *      chave pra todo mundo dela.
 *   4. Escolha gravada pra essa rota nesta conta.
 *   5. Padrão do código.
 * E, no fim, uma trava: se o provedor resolvido não atende a rota (segundo o
 * catálogo), cai no padrão.
 */
@Injectable()
export class RoteamentoWhatsappService {
  private readonly log = new Logger("RoteamentoWhatsapp");
  private cache = new Map<string, { em: number; config: ConfigRoteamento }>();
  private cachePlataforma: { em: number; rotas: Record<string, ProvedorWhatsapp> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Joga o cache fora (chamado ao salvar a config). */
  invalidar(contaId?: string): void {
    if (contaId) this.cache.delete(contaId);
    else this.cache.clear();
  }

  /** Joga fora o cache da escolha da plataforma. */
  invalidarPlataforma(): void {
    this.cachePlataforma = null;
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

    // Rota de plataforma NÃO olha a config da conta. É o que impede a mesma
    // pessoa, com a mesma senha, de receber o código por caminhos diferentes
    // conforme qual cadastro venceu o desempate em `resolverConta`.
    if (def.escopo === "plataforma") {
      const escolhido = (await this.configPlataforma())[opts.rota];
      if (escolhido && provedorAtendeRota(opts.rota, escolhido)) {
        return { provedor: escolhido, motivo: "escolha da plataforma (vale pra todas as empresas)" };
      }
      return { provedor: padraoDaRota(opts.rota), motivo: "padrão da plataforma" };
    }

    const config = await this.config();

    // A allowlist aponta pra META, não pra "o provedor diferente do padrão".
    // Era a mesma coisa enquanto o padrão era o Evolution; virou o oposto no dia
    // em que o padrão mudou, e "o outro provedor" passaria a significar o canal
    // banido. O propósito sempre foi um só: validar a Meta antes de virar a
    // chave pra todos.
    if (opts.telefone && config.telefonesTeste.includes(opts.telefone)) {
      if (provedorAtendeRota(opts.rota, "meta")) {
        return { provedor: "meta", motivo: "telefone na allowlist de teste" };
      }
    }

    const escolhido = config.rotas[opts.rota];
    if (escolhido && provedorAtendeRota(opts.rota, escolhido)) {
      return { provedor: escolhido, motivo: "escolha gravada pra esta empresa" };
    }
    if (escolhido) {
      this.log.warn(`rota ${opts.rota} gravada como "${escolhido}", que não a atende — usando padrão`);
    }
    return { provedor: padraoDaRota(opts.rota), motivo: "padrão do sistema" };
  }

  /**
   * A escolha da plataforma, que vale pra todas as contas.
   *
   * Linha única, sem conta — por isso lida em `comoSistema`: a trava do Prisma
   * não tem o que filtrar aqui, e sem o contexto a query sai fora da trava e
   * quebra em rota pública (que é justamente onde o código de senha roda).
   *
   * Erro de leitura cai no padrão, como o resto: uma tabela de configuração
   * fora do ar não pode impedir motorista de receber código.
   */
  private async configPlataforma(): Promise<Record<string, ProvedorWhatsapp>> {
    const cacheado = this.cachePlataforma;
    if (cacheado && Date.now() - cacheado.em < CACHE_MS) return cacheado.rotas;
    try {
      const linha = await comoSistema(() =>
        this.prisma.configuracaoRoteamentoPlataforma.findUnique({ where: { id: "singleton" } }),
      );
      const rotas = (linha?.rotas as Record<string, ProvedorWhatsapp> | null) ?? {};
      this.cachePlataforma = { em: Date.now(), rotas };
      return rotas;
    } catch (e) {
      this.log.error(`não deu pra ler o roteamento da plataforma: ${(e as Error).message}`);
      return {};
    }
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
