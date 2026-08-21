import { z } from "zod";

/**
 * Catálogo das mensagens de WhatsApp que o sistema manda, e por qual serviço
 * cada uma pode sair.
 *
 * O sistema fala WhatsApp por dois caminhos ao mesmo tempo:
 *
 * - **Evolution** (não-oficial, WhatsApp Web/Baileys). É o caminho histórico.
 *   Manda texto livre pra qualquer um, inclusive pra GRUPO, e não custa nada
 *   por mensagem — mas viola os termos da Meta e o número pode ser banido.
 * - **Meta** (Cloud API oficial). Não bane, custa por mensagem, e cobra o
 *   preço de ser oficial: fora da janela de 24h desde a última mensagem do
 *   usuário, só sai TEMPLATE previamente aprovado pela Meta, e grupo não
 *   existe.
 *
 * Por isso a escolha é por MENSAGEM, não global: o código de cadastro tem que
 * sair pelo caminho que não cai, o aviso no grupo só existe no Evolution, e a
 * conversa do agente é de graça nos dois.
 *
 * Quem decide é só a equipe da plataforma (`User.plataforma`) — provedor errado
 * numa rota de código deixa o motorista sem conseguir entrar no app.
 */

export const PROVEDORES_WHATSAPP = ["evolution", "meta"] as const;
export type ProvedorWhatsapp = (typeof PROVEDORES_WHATSAPP)[number];

/**
 * Categoria de cobrança da Meta. Só serve pra estimar custo e escolher o tipo
 * de template — o Evolution ignora.
 *
 * - `authentication`: código de uso único. Corpo FIXO pela Meta, o mais caro.
 * - `utility`: aviso sobre algo que já aconteceu (viagem, peso, resumo).
 * - `servico`: resposta dentro da janela de 24h. Texto livre e de graça.
 */
export const CATEGORIAS_WHATSAPP = ["authentication", "utility", "servico"] as const;
export type CategoriaWhatsapp = (typeof CATEGORIAS_WHATSAPP)[number];

export type RotaWhatsappDef = {
  /** Chave estável — vai pro banco e pro log. Nunca renomear sem migration. */
  chave: string;
  /** Como aparece na tela de roteamento. */
  rotulo: string;
  /** Uma linha explicando quando essa mensagem sai. */
  descricao: string;
  categoria: CategoriaWhatsapp;
  /** Quais provedores conseguem entregar esta mensagem. */
  provedores: readonly ProvedorWhatsapp[];
  /**
   * Se falhar, o motorista fica travado? Muda o default de fallback e a ordem
   * de migração — rota crítica é a última a sair do caminho conhecido.
   */
  critica: boolean;
};

export const ROTAS_WHATSAPP = [
  {
    chave: "OTP_CADASTRO",
    rotulo: "Código de cadastro",
    descricao: "Código que o motorista digita pra concluir o auto-cadastro no app.",
    categoria: "authentication",
    provedores: ["evolution", "meta"],
    critica: true,
  },
  {
    chave: "OTP_SENHA",
    rotulo: "Código de redefinição de senha",
    descricao: "Código do 'esqueci minha senha'.",
    categoria: "authentication",
    provedores: ["evolution", "meta"],
    critica: true,
  },
  {
    chave: "AVISO_GRUPO",
    rotulo: "Aviso no grupo",
    descricao: "Anuncia no grupo da empresa que um motorista acabou de entrar no app.",
    categoria: "utility",
    // Grupo não existe na Cloud API. Isto não é uma escolha de configuração.
    provedores: ["evolution"],
    critica: false,
  },
  {
    chave: "MENSAGEM_AVULSA",
    rotulo: "Mensagem avulsa do painel",
    descricao: "Texto que o operador escreve na mão pra um motorista.",
    // Texto livre não vira template. Na Meta só sai dentro da janela de 24h.
    categoria: "servico",
    provedores: ["evolution", "meta"],
    critica: false,
  },
  {
    chave: "RESUMO_MOTORISTA",
    rotulo: "Resumo diário do motorista",
    descricao: "O fechamento do dia do motorista, todo dia às 20h.",
    categoria: "utility",
    provedores: ["evolution", "meta"],
    critica: false,
  },
  {
    chave: "AVISO_PESO",
    rotulo: "Aviso de viagem sem peso",
    descricao: "Cobra o romaneio de viagem lançada sem peso (na hora e no resumo das 18h).",
    categoria: "utility",
    provedores: ["evolution", "meta"],
    critica: false,
  },
  {
    chave: "RESUMO_GESTOR",
    rotulo: "Resumo diário do gestor",
    descricao: "O resumo da operação pro pessoal do painel, às 20h.",
    categoria: "utility",
    provedores: ["evolution", "meta"],
    critica: false,
  },
  {
    chave: "COMPARTILHAMENTO",
    rotulo: "Link de comprovante",
    descricao: "Manda o link público do comprovante de viagem pro cliente.",
    categoria: "utility",
    provedores: ["evolution", "meta"],
    critica: false,
  },
  {
    chave: "RESPOSTA_AGENTE",
    rotulo: "Resposta do agente",
    descricao:
      "Tudo que o sistema responde a quem mandou mensagem. Sai sempre pelo número que recebeu.",
    categoria: "servico",
    // Presente por completude: na prática NÃO é roteável por config — a
    // resposta tem que sair pelo mesmo número que recebeu a mensagem, senão a
    // conversa se parte em dois chats. Ver `roteamento.service.ts`.
    provedores: ["evolution", "meta"],
    critica: false,
  },
] as const satisfies readonly RotaWhatsappDef[];

export type RotaWhatsapp = (typeof ROTAS_WHATSAPP)[number]["chave"];

export const CHAVES_ROTA_WHATSAPP = ROTAS_WHATSAPP.map((r) => r.chave) as RotaWhatsapp[];

/** A definição de uma rota, ou `undefined` se a chave não existe mais. */
export function rotaWhatsapp(chave: string): RotaWhatsappDef | undefined {
  return ROTAS_WHATSAPP.find((r) => r.chave === chave);
}

/** Se aquele provedor consegue entregar aquela rota. */
export function provedorAtendeRota(chave: string, provedor: ProvedorWhatsapp): boolean {
  const def = rotaWhatsapp(chave);
  return !!def && (def.provedores as readonly string[]).includes(provedor);
}

/**
 * Custo estimado em reais por mensagem, por categoria, no Brasil.
 *
 * É ESTIMATIVA pra dar noção de consumo no painel — a conta que vale é a da
 * Meta. Os valores mudam por tabela dela e por volume; revisar de tempos em
 * tempos. Evolution não custa por mensagem.
 */
export const CUSTO_ESTIMADO_BRL: Record<CategoriaWhatsapp, number> = {
  authentication: 0.17,
  utility: 0.045,
  servico: 0,
};

export function custoEstimado(
  provedor: ProvedorWhatsapp,
  categoria: CategoriaWhatsapp | null | undefined,
): number {
  if (provedor !== "meta" || !categoria) return 0;
  return CUSTO_ESTIMADO_BRL[categoria] ?? 0;
}

/**
 * Limites de PARÂMETRO de template da Meta.
 *
 * O corpo fixo do template pode ser multilinha à vontade; o valor que a gente
 * injeta nele, não — a Meta recusa parâmetro com quebra de linha, tabulação ou
 * 4+ espaços seguidos. É o que obriga o resumo diário e o aviso de peso a
 * virarem uma variável por linha, com lista virando contagem.
 */
export const PARAM_TEMPLATE_INVALIDO = /[\n\t]|\s{4,}/;

export function paramTemplateValido(valor: string): boolean {
  return valor.length > 0 && !PARAM_TEMPLATE_INVALIDO.test(valor);
}

/** Achata um valor pra caber como parâmetro de template. */
export function achatarParam(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

export const AtualizarRoteamentoWhatsappInput = z.object({
  /** Chave da rota -> provedor. Rota ausente fica com o default do código. */
  rotas: z.record(z.enum(PROVEDORES_WHATSAPP)).optional(),
  /**
   * Telefones (só dígitos, com DDI) que já saem pela Meta mesmo com a rota
   * ainda apontada pro Evolution. É como se testa uma rota em produção sem
   * virar a chave pra ninguém.
   */
  telefonesTeste: z.array(z.string().regex(/^\d{10,15}$/)).max(20).optional(),
});
export type AtualizarRoteamentoWhatsappInput = z.infer<typeof AtualizarRoteamentoWhatsappInput>;

/* ---------------------------------------------------------------- templates ---
 *
 * Fora da janela de 24h a Meta só entrega TEMPLATE previamente aprovado. Cada
 * rota que precisa de um declara aqui: o nome exato aprovado lá, o idioma, e —
 * o ponto que não é óbvio — QUAIS dos `params` do envio entram no corpo.
 *
 * O mapa por índice existe porque `params` foi montado pensando no texto que o
 * Evolution manda, e o template da Meta quase nunca aceita os mesmos valores.
 * O caso extremo é o OTP: o envio manda `[nomeConta, codigo, ttl]`, e o corpo
 * do template de autenticação é FIXO pela Meta — só cabe o código. Sem o mapa,
 * ou a gente mandava parâmetro a mais (a Meta rejeita a mensagem inteira) ou
 * mexia no call site pra caber na Meta e estragava o texto do Evolution, que é
 * justamente a rede pra quando um template é reprovado.
 */

export type BotaoTemplate =
  /** Botão "Copiar código" do template de autenticação. O param é o código. */
  | { tipo: "COPIAR_CODIGO"; param: number }
  /** Botão de URL dinâmica: o param é só o SUFIXO que completa a URL base. */
  | { tipo: "URL"; param: number };

export type TemplateWhatsappDef = {
  /** Nome exato aprovado na Meta. Minúsculas e underscore — a Meta exige. */
  nome: string;
  /** Código de idioma do template aprovado. */
  idioma: string;
  /** Posições de `params` que viram {{1}}..{{n}} do corpo, nessa ordem. */
  corpo: readonly number[];
  botao?: BotaoTemplate;
  /**
   * O corpo exato a cadastrar na Meta, pra submeter e pra conferir depois.
   * Serve de fonte única: o que está aqui é o que tem que estar lá.
   */
  textoAprovacao: string;
};

/**
 * Rota → template. Rota ausente daqui **não tem template**, e na Meta só sai
 * como texto livre dentro da janela de 24h:
 *
 * - `MENSAGEM_AVULSA` e `RESPOSTA_AGENTE` são texto que alguém digitou na hora.
 *   Não existe template possível — é a natureza delas, não uma pendência.
 * - `RESUMO_GESTOR` tem corpo variável (cada usuário escolhe seus blocos em
 *   `resumoAssuntos`), e parâmetro de template não aceita quebra de linha. Ou o
 *   resumo do gestor ganha uma forma fixa, ou fica no Evolution. Decisão em
 *   aberto — de propósito, em vez de um template chutado que a Meta reprova.
 * - `AVISO_GRUPO` é grupo, que a Cloud API não faz.
 */
export const TEMPLATES_WHATSAPP: Partial<Record<RotaWhatsapp, TemplateWhatsappDef>> = {
  // Corpo FIXO pela Meta: dá pra escolher os complementos (aviso de segurança,
  // validade, botão de copiar) mas não escrever o texto. `nomeConta` e o TTL do
  // envio ficam de fora — quem identifica a empresa é o nome de exibição do
  // número, e a validade é uma opção do template, não um parâmetro.
  OTP_CADASTRO: {
    nome: "otp_cadastro",
    idioma: "pt_BR",
    corpo: [1],
    botao: { tipo: "COPIAR_CODIGO", param: 1 },
    textoAprovacao: "{{1}} é seu código de verificação.",
  },
  OTP_SENHA: {
    nome: "otp_senha",
    idioma: "pt_BR",
    corpo: [0],
    botao: { tipo: "COPIAR_CODIGO", param: 0 },
    textoAprovacao: "{{1}} é seu código de verificação.",
  },
  AVISO_PESO: {
    nome: "aviso_peso",
    idioma: "pt_BR",
    corpo: [0, 1],
    textoAprovacao: [
      "⚖️ *Você tem {{1}} sem peso*",
      "",
      "Falta o peso/romaneio de: {{2}}",
      "",
      "Abra o app e complete antes de fechar o dia.",
    ].join("\n"),
  },
  RESUMO_MOTORISTA: {
    nome: "resumo_motorista",
    idioma: "pt_BR",
    corpo: [0, 1, 2, 3, 4],
    textoAprovacao: [
      "🚛 *Seu dia na {{1}}* — {{2}}",
      "",
      "Hoje você fez: {{3}}",
      "",
      "{{4}}",
      "",
      "No mês: {{5}}",
      "Bom descanso! 💪",
    ].join("\n"),
  },
  COMPARTILHAMENTO: {
    nome: "compartilhamento_viagem",
    idioma: "pt_BR",
    corpo: [0, 1, 2, 3],
    // O token do link é o sufixo da URL do botão, não texto do corpo: link em
    // parâmetro de corpo a Meta trata como conteúdo suspeito com frequência.
    botao: { tipo: "URL", param: 4 },
    textoAprovacao: [
      "Olá! Segue o comprovante da viagem de {{1}}.",
      "",
      "{{2}}",
      "{{3}}",
      "",
      "O link fica disponível até {{4}}.",
    ].join("\n"),
  },
};

/** O template daquela rota, ou `undefined` se ela não tem um. */
export function templateWhatsapp(rota: string): TemplateWhatsappDef | undefined {
  return TEMPLATES_WHATSAPP[rota as RotaWhatsapp];
}
