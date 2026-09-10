import type { AgentToolDefinition } from "../whatsapp/agente/providers/agent.provider";

/**
 * O que o SDR consegue fazer.
 *
 * Toolset PRÓPRIO, e não o do agente de motorista com um filtro. A fronteira é
 * de segurança: o agente de motorista sabe consultar viagem, km e ticket, e
 * um prospect é, por definição, alguém que o sistema não conhece. Um toolset
 * único com `if` responderia "sua viagem de ontem foi pra Ponta Grossa" pra
 * quem acertasse um número por sorte.
 *
 * Nenhuma tool daqui lê ou escreve dado de transportadora. Todas mexem só no
 * lead de quem está conversando — e o `leadId` nunca vem por parâmetro, vem de
 * quem o telefone resolveu. Se viesse por parâmetro, bastaria o modelo
 * alucinar um id pra escrever no lead de outra empresa.
 */
export const TOOLS_SDR: AgentToolDefinition[] = [
  {
    name: "consultar_preco",
    description:
      "Quanto custa por mês pra uma frota deste tamanho. É a ÚNICA fonte de preço — " +
      "nunca estime. Se não devolver valor, diga que vai confirmar e passe pra um humano.",
    input_schema: {
      type: "object",
      properties: {
        veiculos: {
          type: "integer",
          description: "Quantos caminhões a transportadora tem rodando.",
        },
      },
      required: ["veiculos"],
    },
  },
  {
    name: "registrar_qualificacao",
    description:
      "Guarda o que você descobriu sobre a operação dele. Chame assim que souber, " +
      "sem esperar o fim da conversa — conversa que cai no meio também vale.",
    input_schema: {
      type: "object",
      properties: {
        veiculos: { type: "integer", description: "Quantos caminhões ele tem." },
        comoControlaHoje: {
          type: "string",
          description: "Caderno, planilha, WhatsApp, outro sistema — nas palavras dele.",
        },
        dorPrincipal: {
          type: "string",
          description: "O problema que ele citou como o que mais atrapalha.",
        },
      },
    },
  },
  {
    name: "link_do_teste",
    description:
      "O endereço onde ele mesmo cria a conta e testa. Use quando ele demonstrar " +
      "interesse em ver funcionando. Devolve também quantos dias dura o teste.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "passar_para_humano",
    description:
      "Chama uma pessoa da Movatruck pra assumir a conversa. Use quando ele pedir, " +
      "quando quiser negociar condição ou prazo, ou quando você não souber responder. " +
      "Depois de chamar, avise que alguém vai falar com ele e pare de perguntar.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description: "Em uma linha, por que está passando. Vai pro histórico do lead.",
        },
      },
      required: ["motivo"],
    },
  },
  {
    name: "registrar_opt_out",
    description:
      "Ele pediu pra não receber mais mensagem. Chame na hora, sem argumentar e sem " +
      "perguntar o motivo. Depois confirme que não vai mais escrever e encerre.",
    input_schema: { type: "object", properties: {} },
  },
];
