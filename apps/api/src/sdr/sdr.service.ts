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
import { sanearResposta } from "../common/saneamento-resposta";
import { segredoDeCripto } from "../common/segredo-cripto";
import { aberturaPadrao, promptSdr, type ContextoLead } from "./sdr.prompt";
import { AtendimentoHumanoService } from "./atendimento-humano.service";
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

/**
 * A frase promete que uma PESSOA vai entrar em contato?
 *
 * "te liga", "vai te chamar", "fala com você por aqui": dito isso, alguém tem
 * que ser avisado, com ou sem o modelo ter lembrado da ferramenta.
 */
export function prometeContatoDeGente(texto: string): boolean {
  const t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Frase a frase, e só a AFIRMATIVA: "prefere que um consultor te ligue, ou
  // testar?" e "se depois quiser, é só pedir que um consultor te liga" são
  // oferta, não promessa — e o simulador pegou as duas forçando repasse.
  // Promessa de verdade é CONFIRMAÇÃO: sem pergunta na mensagem ("Combinado:
  // um consultor te liga amanhã às 9h."). Com pergunta, é oferta ("um
  // consultor te liga 10 min… quer agendar?") — e o simulador pegou essa
  // forçando repasse.
  if (/\?/.test(t) && !/\bcombinado\b/.test(t)) return false;
  return (t.match(/(?:https?:\/\/\S+|[.,](?=\d)|[^.!?\n])+[.!?]?/g) ?? [t]).some(
    (f) => !/\b(?:se|caso|quer|querer|prefere|pode\s+pedir|so\s+pedir|ou\s+voce)\b/.test(f) && prometeNaFrase(f),
  );
}

function prometeNaFrase(t: string): boolean {
  return [
    /\b(?:te|lhe)\s+liga\b/,
    /\bvai\s+(?:te\s+)?ligar\b/,
    /\bliga\s+(?:pra|para)\s+(?:voce|vc)\b/,
    /\bvai\s+te\s+(?:chamar|responder|procurar)\b/,
    /\b(?:fala|vai\s+falar)\s+com\s+(?:voce|vc)\b/,
    /\bte\s+(?:chama|responde)\b/,
    /\b(?:continua|segue)\s+(?:o\s+)?(?:seu\s+)?atendimento\b/,
    /\b(?:entra|entrar|vai\s+entrar)\s+em\s+contato\b/,
    /\bte\s+(?:retorno|retorna|retornamos)\b/,
  ].some((p) => p.test(t));
}

/** A oferta de ligação/teste — pra contar quantas vezes ela já saiu. */
const OFERTA = /\bte\s+ligue\b|\bliga[cç][aã]o\s+de\s+10\b|\btestar\s+sozinho\b|\bdias\s+gr[aá]tis\b/i;

/**
 * Travas de forma que o modelo ignora mesmo com regra no prompt — a QA de
 * 28/09 contou a mesma oferta cinco vezes numa conversa e duas perguntas por
 * mensagem em sete.
 *
 * - Oferta que já saiu duas vezes (ou foi recusada): a frase com oferta cai.
 * - Mais de uma pergunta: fica só a última, que é a que pede o próximo passo.
 *
 * Exportada pra teste. Nunca devolve vazio: se cortar tudo, devolve o original.
 */
export function aparar(texto: string, ofertasAnteriores: number, recusouLigacao: boolean): string {
  // Link e número inteiros: cortar no ponto de "movatruck.com.br" entregou um
  // link quebrado no simulador (28/09), e "R$ 1.890,00" não termina frase.
  const frases: string[] =
    texto.match(/(?:https?:\/\/\S+|[.,](?=\d)|[^.!?\n])+[.!?]*\s*|\n+/g) ?? [texto];
  let saida = frases;
  if (ofertasAnteriores >= 2 || recusouLigacao) {
    saida = saida.filter((f) => !(OFERTA.test(f) && (ofertasAnteriores >= 2 || /\blig/i.test(f))));
  }
  const perguntas = saida.filter((f) => /\?\s*$/.test(f.trim()));
  if (perguntas.length > 1) {
    const ultima = perguntas[perguntas.length - 1];
    saida = saida.filter((f) => !/\?\s*$/.test(f.trim()) || f === ultima);
  }
  // Comprida demais pro celular (a QA mediu 6 linhas): ficam as primeiras
  // frases até ~300 caracteres, e a pergunta final, se houver.
  const semLink = (f: string) => f.replace(/https?:\/\/\S+/g, "").length;
  if (saida.reduce((n, f) => n + semLink(f), 0) > 320) {
    const pergunta = [...saida].reverse().find((f) => /\?\s*$/.test(f.trim()));
    const curtas: string[] = [];
    let n = pergunta ? semLink(pergunta) : 0;
    for (const f of saida) {
      if (f === pergunta) continue;
      if (curtas.length > 0 && n + semLink(f) > 300) break;
      curtas.push(f);
      n += semLink(f);
    }
    saida = pergunta ? [...curtas, pergunta] : curtas;
  }
  const final = saida.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (final) return final;
  // A resposta inteira era a oferta repetida: não repete, só acusa o recebimento.
  return ofertasAnteriores >= 2 || recusouLigacao ? "Anotado." : texto;
}

/** Quanto da conversa entra no contexto. Mesma régua do agente do motorista. */
const MAX_HISTORICO = 30;
const JANELA_HORAS = 24;

export type RespostaSdr = {
  texto: string;
  /**
   * Ele decidiu NÃO responder — aviso automático, "ok", emoji. Não é falha:
   * quem chama não envia nada e não manda pra fila. Silêncio de propósito é
   * diferente de silêncio por erro, e misturar os dois fazia o "ok" de alguém
   * virar "Recebi sua mensagem e já chamei alguém da equipe".
   */
  silencio: boolean;
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
    private readonly atendimento: AtendimentoHumanoService,
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
          sdrPausadoEm: true,
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
    // Uma pessoa assumiu (ou o robô já entregou): daqui pra frente o robô não
    // escreve. Quem chama já confere antes — isto é a segunda tranca, porque
    // um robô falando por cima do vendedor é o erro que o dono mais cobrou.
    if (lead.sdrPausadoEm) {
      this.log.log(`Lead ${leadId} está com gente desde ${lead.sdrPausadoEm.toISOString()} — SDR calado.`);
      await this.gravar(leadId, "ENTRADA", mensagem);
      return { texto: "", silencio: true, passarParaHumano: false, motivoHumano: null, ferramentas: [] };
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
    let calar = false;
    const ferramentas: string[] = [];

    // A ENTRADA já foi gravada acima, então ela é a última linha do histórico.
    // `atual` vem de lá carimbada com o mesmo marcador de gap: os providers
    // deduplicam comparando o texto da última mensagem com `mensagemAtual`, e
    // carimbar só um dos dois faria a pergunta do prospect chegar duas vezes.
    const { mensagens, atual } = await this.historico(leadId, mensagem);
    // Já falamos com ele? Na primeira mensagem, silêncio nunca é resposta.
    const jaFalamos = mensagens.some((m) => m.role === "assistant");
    const oferta = await this.atendimento.oferta();

    const texto = await provider.processar({
      systemText: promptSdr(contexto, oferta),
      tools: TOOLS_SDR,
      historico: mensagens,
      mensagemAtual: atual,
      modelo,
      encerrarApos: ["nao_responder"],
      executarTool: async (nome, input) => {
        ferramentas.push(nome);
        const saida = await this.executarTool(nome, input, lead);
        if (nome === "passar_para_humano") {
          pediuHumano = String((input as { motivo?: unknown }).motivo ?? "sem motivo");
        }
        // Ligação marcada é passagem pra gente: quem liga tem que ser avisado
        // e o robô sai da conversa depois de confirmar.
        if (nome === "agendar_demonstracao") {
          pediuHumano = `Ligação de demonstração marcada: ${String((input as { horario?: unknown }).horario ?? "?")}`;
        }
        if (nome === "nao_responder") calar = true;
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

    // Ele escolheu ficar calado. Se ainda assim escreveu alguma coisa, vale o
    // silêncio: a ferramenta é a decisão, o texto costuma ser ele explicando
    // a decisão — exatamente o que chegou na pedreira.
    if (calar && !pediuHumano) {
      if (texto) await this.gravar(leadId, "SAIDA", `[descartada — decidiu não responder] ${texto}`);
      if (jaFalamos) {
        return { texto: "", silencio: true, passarParaHumano: false, motivoHumano: null, ferramentas };
      }
      // Primeiro contato ("Ou", "ok", "👍"): o lead que chega nunca fica sem
      // uma palavra. Vai a abertura fixa.
      const abertura = aberturaPadrao(oferta);
      await this.gravar(leadId, "SAIDA", abertura);
      return { texto: abertura, silencio: false, passarParaHumano: false, motivoHumano: null, ferramentas };
    }

    // Raciocínio vazado ("a ferramenta me passou", "Returning to idle") não
    // sai. Mesma lógica do idioma: grava pra auditoria e devolve null, que
    // manda pra uma pessoa.
    const saneada = texto ? sanearResposta(texto) : null;
    if (saneada && !saneada.ok) {
      this.log.warn(
        `Resposta do ${provider.nome} (${modelo}) com ${saneada.motivo} não foi enviada: "${saneada.trecho}"`,
      );
      await this.gravar(leadId, "SAIDA", `[descartada — ${saneada.motivo}] ${texto}`);
      return null;
    }
    const ofertasAnteriores = mensagens.filter((m) => m.role === "assistant" && OFERTA.test(m.content)).length;
    const recusouLigacao = mensagens.some(
      (m) =>
        m.role === "user" &&
        /n[aã]o\s+(?:quero|precisa|preciso)\b.*\b(?:lig|pessoa|ningu|consultor)/i.test(m.content),
    );
    const final = saneada?.ok ? aparar(saneada.texto, ofertasAnteriores, recusouLigacao) : "";

    // Prometeu contato de gente sem chamar a ferramenta? Vale a promessa.
    // A bateria pegou o MiniMax-M3 escrevendo "Combinado: Fernando te liga
    // amanhã às 09:00" sem `agendar_demonstracao` — ninguém seria avisado, e
    // é exatamente a promessa quebrada que queimou os leads de setembro.
    if (!pediuHumano && prometeContatoDeGente(final)) {
      pediuHumano = `Prometeu contato de uma pessoa: "${final.slice(0, 120)}"`;
      this.log.warn(`SDR prometeu contato sem chamar a ferramenta — repasse forçado`);
    }

    if (final) await this.gravar(leadId, "SAIDA", final);

    return {
      texto: final,
      silencio: false,
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

      case "oferecer_horarios": {
        const horarios = await this.atendimento.horariosLivres({
          dia: typeof input.dia === "string" ? input.dia : undefined,
          periodo: input.periodo === "manha" || input.periodo === "tarde" ? input.periodo : undefined,
        });
        return horarios.length > 0
          ? { horarios }
          : {
              horarios: [],
              instrucao:
                "Nenhum horário nessa preferência. Chame passar_para_humano e diga: " +
                "'Vou pedir pro consultor combinar esse horário com você por aqui.'",
            };
      }

      case "agendar_demonstracao": {
        const horario = String(input.horario ?? "").trim() || "horário a combinar";
        await comoSistema(() =>
          this.prisma.interacaoLead.create({
            data: {
              leadId,
              canal: "WHATSAPP",
              desfecho: "RESPONDEU",
              resumo: `Ligação de demonstração marcada pelo atendimento: ${horario}`,
              autor: null,
            },
          }),
        );
        return { ok: true, horario };
      }

      case "nao_responder":
        return { ok: true, instrucao: "Não escreva nada nesta resposta." };

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

  /**
   * Guarda o que o prospect disse mesmo quando o robô não responde.
   *
   * A conversa com gente também precisa ficar na ficha — sem isto, o lead que
   * pediu "quero falar com o Fernando" sumia do histórico no exato momento em
   * que ficou importante.
   */
  registrarEntrada(leadId: string, texto: string) {
    return this.gravar(leadId, "ENTRADA", texto);
  }

  /** Uma fala nossa, dita fora do modelo (repasse, confirmação fixa). */
  registrarSaida(leadId: string, texto: string) {
    return this.gravar(leadId, "SAIDA", texto);
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
