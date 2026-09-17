import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { PrecosService } from "../admin/precos/precos.service";
import { ProspeccaoService } from "../prospeccao/prospeccao.service";
import { AnthropicProvider } from "../whatsapp/agente/providers/anthropic.provider";
import { GeminiProvider } from "../whatsapp/agente/providers/gemini.provider";
import type { AgentMessage, AgentProvider } from "../whatsapp/agente/providers/agent.provider";
import { comMarcadorDeGap, minutosEntre } from "../common/gap-conversa";
import { BASE_URL_MINIMAX } from "../common/ia/provedor-ia";
import { decifrar } from "../common/cripto";
import { trechoForaDoPortugues } from "../common/idioma-resposta";
import { segredoDeCripto } from "../common/segredo-cripto";
import { promptSdr, type ContextoLead } from "./sdr.prompt";
import { empresaConhecida } from "./lead-inbound";
import { TOOLS_SDR } from "./sdr.tools";

/**
 * Quem pode atender. O MiniMax entra sem provider novo: ele fala o protocolo
 * da Anthropic, e o que muda é `baseURL`, chave e id do modelo.
 */
export const PROVIDERS_SDR = ["anthropic", "gemini", "minimax"] as const;
export type ProviderSdr = (typeof PROVIDERS_SDR)[number];

/** De onde vem a chave de cada um quando a tela não define nenhuma. */
const ENV_DA_CHAVE: Record<ProviderSdr, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

/**
 * O que está gravado é um texto livre — veio de migration antiga, de um
 * `PATCH` ou de alguém editando o banco. Nome que não reconheço vira
 * `anthropic`, que é o default histórico: melhor atender pelo caminho de
 * sempre do que não atender.
 */
export function providerValido(nome: string | null | undefined): ProviderSdr {
  const limpo = (nome ?? "").trim().toLowerCase();
  return (PROVIDERS_SDR as readonly string[]).includes(limpo)
    ? (limpo as ProviderSdr)
    : "anthropic";
}

/** Quanto da conversa entra no contexto. Mesma régua do agente do motorista. */
const MAX_HISTORICO = 30;
const JANELA_HORAS = 24;

export type RespostaSdr = {
  texto: string;
  /** O modelo pediu uma pessoa — quem chamou decide o que fazer com isso. */
  passarParaHumano: boolean;
  motivoHumano: string | null;
  /**
   * Que ferramentas ele usou pra chegar nessa resposta, na ordem.
   *
   * Sai daqui porque a resposta sozinha não diz se o preço veio da tabela ou
   * da imaginação do modelo: as duas coisas parecem iguais na tela.
   */
  ferramentas: string[];
};

/**
 * O SDR: atende no WhatsApp quem ainda não é cliente.
 *
 * Serviço separado do agente de motorista, não uma variação dele. A separação é
 * de segurança, não de organização: o agente de motorista tem ferramentas que
 * leem viagem, km e ticket de uma empresa, e prospect é por definição alguém
 * que o sistema não conhece. Um agente só, com um `if` no meio, responderia
 * dado de cliente pra quem acertasse um número por sorte.
 *
 * Só responde a quem já está na base de leads. Número solto não vira conversa.
 */
@Injectable()
export class SdrService {
  private readonly log = new Logger(SdrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly precos: PrecosService,
    private readonly prospeccao: ProspeccaoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Os providers vivem num cache com a chave que os criou.
   *
   * Antes eram montados no constructor, o que casava com chave em env — valor
   * que não muda enquanto o processo vive. Agora a chave pode vir da tela e
   * mudar sem deploy: montar no boot deixaria o painel dizendo uma coisa e o
   * processo usando outra até alguém reiniciar. Recriar a cada mensagem também
   * não serve (o cliente mantém conexão), então o cache é invalidado pelo
   * próprio valor da chave.
   */
  private readonly cache = new Map<string, { chave: string; provider: AgentProvider }>();

  private providerPara(nome: ProviderSdr, chave: string): AgentProvider {
    const guardado = this.cache.get(nome);
    if (guardado && guardado.chave === chave) return guardado.provider;

    const provider: AgentProvider =
      nome === "gemini"
        ? new GeminiProvider(chave)
        : nome === "minimax"
          ? new AnthropicProvider(chave, {
              nome: "minimax",
              baseURL: BASE_URL_MINIMAX,
              chaveEnv: "MINIMAX_API_KEY",
            })
          : new AnthropicProvider(chave);

    this.cache.set(nome, { chave, provider });
    return provider;
  }

  /**
   * A chave daquele provider: a da TELA quando existe, senão a do ambiente.
   *
   * Essa ordem é o que faz a tela mandar de verdade sem quebrar quem já estava
   * rodando por env — quem não preencher nada continua exatamente como está.
   */
  private chaveDe(nome: ProviderSdr, cfg: { sdrChaveAnthropic: string | null; sdrChaveGemini: string | null; sdrChaveMinimax: string | null }): string {
    const guardada =
      nome === "gemini"
        ? cfg.sdrChaveGemini
        : nome === "minimax"
          ? cfg.sdrChaveMinimax
          : cfg.sdrChaveAnthropic;
    // Gravada cifrada pela tela. Decifra que falha cai na env em vez de deixar
    // o SDR mudo com uma chave ilegível.
    const daTela = decifrar(guardada, segredoDeCripto(this.config)) ?? "";
    return daTela.trim() || (this.config.get<string>(ENV_DA_CHAVE[nome]) ?? "").trim();
  }

  /**
   * A configuração do SDR, sempre da MESMA linha.
   *
   * `configuracaoPlataforma` é singleton de verdade (id fixo), diferente de
   * `configuracaoAgente`, que tem uma linha por empresa. Ler o interruptor do
   * SDR de lá com `findFirst` devolvia uma linha diferente a cada chamada
   * conforme a ordem física da tabela mudava — a tela ligava numa linha e o
   * SDR lia outra.
   */
  private configuracao() {
    return comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } }),
    );
  }

  /** O SDR está ligado? Interruptor próprio, separado do agente de motorista. */
  async ativo(): Promise<boolean> {
    return (await this.configuracao())?.sdrAtivo ?? false;
  }

  /**
   * Responde uma mensagem de prospect.
   *
   * Devolve `null` quando não deve responder — desligado, lead desconhecido ou
   * quem já pediu pra não ser contatado. Quem chama trata `null` mandando pra
   * fila humana, que é o comportamento de hoje.
   */
  async atender(leadId: string, mensagem: string): Promise<RespostaSdr | null> {
    const cfg = await this.configuracao();
    if (!cfg?.sdrAtivo) {
      this.log.log("SDR desligado na tela de Empresas — conversa vai pra fila humana.");
      return null;
    }

    const lead = await comoSistema(() =>
      this.prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          empresa: true,
          nome: true,
          municipio: true,
          uf: true,
          frotaQtd: true,
          origem: true,
          optOut: true,
        },
      }),
    );
    if (!lead) {
      this.log.warn(`Lead ${leadId} não existe mais — nada a responder.`);
      return null;
    }
    if (lead.optOut) {
      this.log.log(`Lead ${leadId} pediu pra não ser contatado — SDR não responde.`);
      return null;
    }

    const contexto: ContextoLead = {
      // `null` quando o lead nasceu de uma mensagem e ninguém disse ainda qual
      // é a empresa. O prompt trata os dois casos — passar o carimbo adiante
      // seria pior que não passar nada: o modelo o leria como o nome dela.
      empresa: empresaConhecida(lead.empresa),
      nome: lead.nome,
      municipio: lead.municipio,
      uf: lead.uf,
      frotaQtd: lead.frotaQtd,
      origem: lead.origem,
    };

    const nomeProvider = providerValido(cfg.sdrProvider);
    const modelo =
      nomeProvider === "gemini"
        ? cfg.sdrModeloGemini
        : nomeProvider === "minimax"
          ? cfg.sdrModeloMinimax
          : cfg.sdrModeloAnthropic;
    const provider = this.providerPara(nomeProvider, this.chaveDe(nomeProvider, cfg));

    if (!provider.habilitado) {
      this.log.warn(
        `Provider ${provider.nome} sem chave de API — SDR não respondeu. ` +
          "Configure a chave no card de atendimento, na tela de Empresas.",
      );
      return null;
    }

    await this.gravar(leadId, "ENTRADA", mensagem);

    let pediuHumano: string | null = null;
    const ferramentas: string[] = [];

    // A ENTRADA já foi gravada acima, então ela é a última linha do histórico.
    // `atual` vem de lá carimbada com o mesmo marcador de gap: os providers
    // deduplicam comparando o texto da última mensagem com `mensagemAtual`, e
    // carimbar só um dos dois faria a pergunta do prospect chegar duas vezes.
    const { mensagens, atual } = await this.historico(leadId, mensagem);

    const texto = await provider.processar({
      systemText: promptSdr(contexto),
      tools: TOOLS_SDR,
      historico: mensagens,
      mensagemAtual: atual,
      modelo,
      executarTool: async (nome, input) => {
        ferramentas.push(nome);
        const saida = await this.executarTool(nome, input, lead);
        if (nome === "passar_para_humano") {
          pediuHumano = String((input as { motivo?: unknown }).motivo ?? "sem motivo");
        }
        return saida;
      },
    });

    // Última conferência antes de virar mensagem de WhatsApp: saiu em
    // português? Modelo multilíngue troca uma palavra de vez em quando — com
    // MiniMax-M2 a despedida do opt-out voltou com uma palavra em russo. Quem
    // recebe não vê "modelo multilíngue", vê empresa desleixada.
    //
    // Devolve `null` (o mesmo que "não é comigo"), e quem chamou já sabe mandar
    // pra fila humana. A linha fica gravada como SAIDA pra auditoria: o defeito
    // precisa aparecer em algum lugar, e some se a gente só descartar.
    const foraDoPortugues = texto ? trechoForaDoPortugues(texto) : null;
    if (foraDoPortugues) {
      this.log.warn(
        `Resposta do ${provider.nome} (${modelo}) saiu fora do português e não foi enviada: ` +
          `"${foraDoPortugues}"`,
      );
      await this.gravar(leadId, "SAIDA", `[descartada — fora do português] ${texto}`);
      return null;
    }

    if (texto) await this.gravar(leadId, "SAIDA", texto);

    return {
      texto,
      passarParaHumano: pediuHumano !== null,
      motivoHumano: pediuHumano,
      ferramentas,
    };
  }

  /**
   * As ferramentas. `leadId` vem daqui, nunca do modelo — se viesse por
   * parâmetro, bastaria alucinar um id pra escrever no lead de outra empresa.
   */
  private async executarTool(
    nome: string,
    input: Record<string, unknown>,
    lead: { id: string; empresa: string },
  ): Promise<unknown> {
    const leadId = lead.id;
    switch (nome) {
      case "consultar_preco": {
        const veiculos = Number(input.veiculos) || 0;
        const preco = await this.precos.precoPara(veiculos);
        if (!preco) {
          // Tabela vazia ou faixa descoberta. O prompt manda dizer que vai
          // confirmar — nunca estimar.
          return { encontrado: false };
        }
        return {
          encontrado: true,
          valorMensal: (preco.valorCentavos / 100).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
          }),
          faixa: preco.rotulo,
        };
      }

      case "registrar_qualificacao": {
        const veiculos = Number(input.veiculos);
        // O nome da empresa só entra em lead que ainda não tem um. Quem veio
        // da Receita já tem a razão social conferida, e "a firma do meu pai"
        // dito no WhatsApp não pode passar por cima dela.
        const empresa =
          empresaConhecida(lead.empresa) === null
            ? empresaConhecida(String(input.empresa ?? ""))
            : null;
        const partes = [
          empresa ? `empresa: ${empresa}` : null,
          Number.isFinite(veiculos) && veiculos > 0 ? `${veiculos} caminhões` : null,
          input.comoControlaHoje ? `hoje usa: ${String(input.comoControlaHoje)}` : null,
          input.dorPrincipal ? `dor: ${String(input.dorPrincipal)}` : null,
        ].filter(Boolean);

        await comoSistema(async () => {
          await this.prisma.lead.update({
            where: { id: leadId },
            data: {
              ...(empresa ? { empresa } : {}),
              ...(Number.isFinite(veiculos) && veiculos > 0 ? { frotaQtd: veiculos } : {}),
              ultimoContato: new Date(),
            },
          });
          if (partes.length > 0) {
            await this.prisma.interacaoLead.create({
              data: {
                leadId,
                canal: "WHATSAPP",
                desfecho: "RESPONDEU",
                resumo: `Qualificação pelo atendimento: ${partes.join(" · ")}`,
                autor: null,
              },
            });
          }
        });
        return { ok: true };
      }

      case "link_do_teste": {
        const cfg = await this.configuracao();
        // Porta fechada: não adianta mandar link que vai recusar quem clicar.
        if (!cfg?.autoCadastroAberto) return { disponivel: false };
        return { disponivel: true, link: cfg.sdrLinkCadastro, dias: cfg.diasTesteGratis };
      }

      case "passar_para_humano": {
        const motivo = String(input.motivo ?? "pediu atendimento");
        await comoSistema(() =>
          this.prisma.interacaoLead.create({
            data: {
              leadId,
              canal: "WHATSAPP",
              desfecho: "RESPONDEU",
              resumo: `Passou pra atendimento humano: ${motivo}`,
              autor: null,
            },
          }),
        );
        return { ok: true };
      }

      case "registrar_opt_out": {
        // Reusa o caminho da prospecção: a supressão vale pra todos os canais e
        // sobrevive ao lead ser reimportado do RNTRC.
        const dono = await comoSistema(() =>
          this.prisma.lead.findUnique({ where: { id: leadId }, select: { telefone: true } }),
        );
        if (dono?.telefone) await this.prospeccao.registrarOptOut(dono.telefone);
        return { ok: true };
      }

      default:
        return { erro: "ferramenta desconhecida" };
    }
  }

  private gravar(leadId: string, direcao: "ENTRADA" | "SAIDA", conteudo: string) {
    return comoSistema(() =>
      this.prisma.mensagemLead.create({ data: { leadId, direcao, conteudo } }),
    );
  }

  /**
   * A conversa recente, na ordem em que aconteceu.
   *
   * Só as últimas 24h: conversa de semana passada é outro assunto, e arrastar
   * ela pra dentro faz o modelo responder a pergunta errada.
   *
   * Intervalo grande entre duas mensagens vira marcador inline — o mesmo que o
   * agente do motorista já usava e o SDR não tinha. Sem ele, quem sumia no meio
   * da conversa e voltava três horas depois era respondido como se não tivesse
   * havido intervalo nenhum: o modelo emendava a frase anterior, e do outro
   * lado isso soa como robô que não percebeu o tempo passar.
   */
  private async historico(
    leadId: string,
    mensagemAtual: string,
  ): Promise<{ mensagens: AgentMessage[]; atual: string }> {
    const desde = new Date(Date.now() - JANELA_HORAS * 3_600_000);
    const linhas = await comoSistema(() =>
      this.prisma.mensagemLead.findMany({
        where: { leadId, criadoEm: { gte: desde } },
        orderBy: { criadoEm: "desc" },
        take: MAX_HISTORICO,
        select: { direcao: true, conteudo: true, criadoEm: true },
      }),
    );

    const ordenado = linhas.reverse();
    const mensagens: AgentMessage[] = [];
    let anterior: (typeof ordenado)[number] | null = null;
    for (const m of ordenado) {
      mensagens.push({
        role: m.direcao === "ENTRADA" ? ("user" as const) : ("assistant" as const),
        content: anterior
          ? comMarcadorDeGap(m.conteudo, minutosEntre(anterior.criadoEm, m.criadoEm))
          : m.conteudo,
      });
      anterior = m;
    }

    const ultima = ordenado[ordenado.length - 1];
    const atual =
      ultima?.direcao === "ENTRADA" && ultima.conteudo === mensagemAtual
        ? (mensagens[mensagens.length - 1]?.content ?? mensagemAtual)
        : mensagemAtual;

    return { mensagens, atual };
  }
}
