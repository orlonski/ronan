/**
 * O que um envio do formulário de anúncio da Meta quer dizer.
 *
 * A Meta devolve cada resposta como `{ name, values[] }`. Os campos padrão têm
 * nome fixo (`full_name`, `phone_number`); as perguntas nossas ganham um nome
 * derivado do TEXTO da pergunta, que muda se alguém editar o formulário. Por
 * isso a pergunta é reconhecida pelo assunto ("dono", "caminh"), não pelo nome
 * exato — duplicar o formulário e trocar uma vírgula não pode quebrar a
 * importação.
 *
 * Função pura: a Meta entra, o lead sai. Os testes travam os formatos reais.
 */

export type CampoMeta = { name: string; values: string[] };

export type EnvioMeta = {
  id: string;
  created_time?: string;
  form_id?: string;
  ad_id?: string;
  ad_name?: string;
  campaign_name?: string;
  field_data?: CampoMeta[];
};

export type LeadDoFormulario = {
  leadgenId: string;
  nome: string | null;
  telefone: string | null;
  funcao: string | null;
  frota: string | null;
  motorista: boolean;
  qualificado: boolean;
  /** Frota mínima da faixa ("6 a 15" → 6). Só pra ordenar e pontuar; o preço pede o número. */
  frotaMinima: number | null;
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .trim();
}

function valor(campos: CampoMeta[], teste: (nome: string) => boolean): string | null {
  const campo = campos.find((c) => teste(normalizar(c.name)));
  const v = campo?.values?.[0]?.trim();
  return v ? v : null;
}

/** "6 a 15" → 6; "Mais de 40" → 41; "1 a 2" → 1. */
export function frotaMinimaDaFaixa(faixa: string | null): number | null {
  if (!faixa) return null;
  const t = normalizar(faixa);
  const mais = /mais\s+de\s+(\d+)/.exec(t);
  if (mais) return Number(mais[1]) + 1;
  const n = /(\d+)/.exec(t);
  return n ? Number(n[1]) : null;
}

/**
 * Qualificado = não é motorista E roda 3 caminhões ou mais. É a régua que a
 * equipe comercial combinou (28/09/2026): abaixo disso é o transportador que
 * dirige o próprio caminhão, que o app autônomo atende sem esforço de venda.
 * Não qualificado continua recebendo a mensagem — só não aciona a ligação.
 */
export function lerEnvio(envio: EnvioMeta): LeadDoFormulario {
  const campos = envio.field_data ?? [];
  const nome = valor(campos, (n) => n === "full name" || n === "nome completo" || n === "first name");
  const telefone = valor(campos, (n) => n === "phone number" || n === "telefone" || n.includes("whatsapp"));
  const funcao = valor(campos, (n) => n.includes("dono") || n.includes("gestor") || n.includes("motorista"));
  const frota = valor(campos, (n) => n.includes("caminh"));
  const motorista = funcao ? /motorista/.test(normalizar(funcao)) : false;
  const frotaMinima = frotaMinimaDaFaixa(frota);
  return {
    leadgenId: envio.id,
    nome,
    telefone,
    funcao,
    frota,
    motorista,
    qualificado: !motorista && (frotaMinima ?? 0) >= 3,
    frotaMinima,
  };
}

/** A linha que o consultor lê no alerta e na nota da conversa. */
export function resumoDoEnvio(l: LeadDoFormulario): string {
  const partes = [l.funcao, l.frota ? `${l.frota} caminhões` : null].filter(Boolean).join(", ");
  return `Formulário do anúncio: ${partes || "sem respostas"}.`;
}
