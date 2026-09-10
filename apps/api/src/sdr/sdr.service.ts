import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { PrecosService } from "../admin/precos/precos.service";
import { ProspeccaoService } from "../prospeccao/prospeccao.service";
import { AnthropicProvider } from "../whatsapp/agente/providers/anthropic.provider";
import { GeminiProvider } from "../whatsapp/agente/providers/gemini.provider";
import type { AgentMessage, AgentProvider } from "../whatsapp/agente/providers/agent.provider";
import { promptSdr, type ContextoLead } from "./sdr.prompt";
import { TOOLS_SDR } from "./sdr.tools";

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
  ) {
    // Instanciados aqui, como no agente do motorista: os providers não são
    // injetáveis, são adaptadores finos em volta de uma chave de API.
    this.anthropic = new AnthropicProvider(this.config.get<string>("ANTHROPIC_API_KEY"));
    this.gemini = new GeminiProvider(this.config.get<string>("GEMINI_API_KEY"));
  }

  private readonly anthropic: AnthropicProvider;
  private readonly gemini: GeminiProvider;

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
    if (!cfg?.sdrAtivo) return null;

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
    if (!lead || lead.optOut) return null;

    const contexto: ContextoLead = {
      empresa: lead.empresa ?? "empresa sem nome",
      nome: lead.nome,
      municipio: lead.municipio,
      uf: lead.uf,
      frotaQtd: lead.frotaQtd,
      origem: lead.origem,
    };

    const usaGemini = cfg.sdrProvider === "gemini";
    const provider: AgentProvider = usaGemini ? this.gemini : this.anthropic;
    const modelo = usaGemini ? cfg.sdrModeloGemini : cfg.sdrModeloAnthropic;

    if (!provider.habilitado) {
      this.log.warn(`Provider ${provider.nome} sem chave — SDR não respondeu.`);
      return null;
    }

    await this.gravar(leadId, "ENTRADA", mensagem);

    let pediuHumano: string | null = null;
    const ferramentas: string[] = [];

    const texto = await provider.processar({
      systemText: promptSdr(contexto),
      tools: TOOLS_SDR,
      historico: await this.historico(leadId),
      mensagemAtual: mensagem,
      modelo,
      executarTool: async (nome, input) => {
        ferramentas.push(nome);
        const saida = await this.executarTool(nome, input, lead.id);
        if (nome === "passar_para_humano") {
          pediuHumano = String((input as { motivo?: unknown }).motivo ?? "sem motivo");
        }
        return saida;
      },
    });

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
    leadId: string,
  ): Promise<unknown> {
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
        const partes = [
          Number.isFinite(veiculos) && veiculos > 0 ? `${veiculos} caminhões` : null,
          input.comoControlaHoje ? `hoje usa: ${String(input.comoControlaHoje)}` : null,
          input.dorPrincipal ? `dor: ${String(input.dorPrincipal)}` : null,
        ].filter(Boolean);

        await comoSistema(async () => {
          await this.prisma.lead.update({
            where: { id: leadId },
            data: {
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
        const lead = await comoSistema(() =>
          this.prisma.lead.findUnique({ where: { id: leadId }, select: { telefone: true } }),
        );
        if (lead?.telefone) await this.prospeccao.registrarOptOut(lead.telefone);
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
   */
  private async historico(leadId: string): Promise<AgentMessage[]> {
    const desde = new Date(Date.now() - JANELA_HORAS * 3_600_000);
    const linhas = await comoSistema(() =>
      this.prisma.mensagemLead.findMany({
        where: { leadId, criadoEm: { gte: desde } },
        orderBy: { criadoEm: "desc" },
        take: MAX_HISTORICO,
        select: { direcao: true, conteudo: true },
      }),
    );
    return linhas
      .reverse()
      .map((m) => ({
        role: m.direcao === "ENTRADA" ? ("user" as const) : ("assistant" as const),
        content: m.conteudo,
      }));
  }
}
