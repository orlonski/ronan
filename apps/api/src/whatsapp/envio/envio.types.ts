import type { ProvedorWhatsapp, RotaWhatsapp } from "@ronan/shared-types";

/**
 * Pra quem a mensagem vai.
 *
 * GRUPO só existe no Evolution — a Cloud API da Meta não posta em grupo. O tipo
 * separado é o que deixa isso explícito em vez de ser uma string que às vezes
 * termina em `@g.us`.
 */
export type DestinoWhatsapp =
  | { tipo: "TELEFONE"; numero: string } // "5541999998888" — saída de SessaoService.normalizar
  | { tipo: "GRUPO"; jid: string }; // "120363...@g.us"

export type EnvioWhatsapp = {
  destino: DestinoWhatsapp;
  /** Qual mensagem é esta. Decide provedor, template, categoria e o erro. */
  rota: RotaWhatsapp;
  /**
   * Texto já montado, exatamente como o Evolution manda hoje.
   *
   * Continua OBRIGATÓRIO mesmo quando a rota for por template: é o que fica no
   * histórico, é o que sai quando a rota está no Evolution, e é a rede pra
   * quando a Meta reprova um template. O template não substitui o texto — é uma
   * segunda representação do mesmo conteúdo.
   */
  texto: string;
  /**
   * Valores de {{1}}..{{n}} do template, em ordem. Só a Meta usa.
   *
   * Cada um tem que ser UMA LINHA — a Meta recusa parâmetro com quebra de
   * linha, tab ou 4+ espaços. Use `achatarParam` dos shared-types na dúvida.
   */
  params?: string[];
  sessaoId?: string | null;
};

export type ResultadoEnvio = {
  enviado: boolean;
  provedor: ProvedorWhatsapp;
  /** `key.id` no Evolution, `wamid` na Meta. A prova de que foi aceito. */
  idExterno: string | null;
  erro?: {
    /**
     * Transporte é a Meta/Evolution fora do ar ou a rede caindo — dá pra tentar
     * de novo, e é a ÚNICA falha em que cair pro outro provedor é aceitável.
     * Política é template reprovado, janela de 24h expirada, número limitado,
     * token vencido: repetir ou desviar pro Evolution é usar de propósito a
     * ferramenta que o WhatsApp sinalizou, no tráfego que ele sinalizou.
     */
    tipo?: "TRANSPORTE" | "POLITICA";
    codigo: string;
    detalhe: string;
  };
};

/**
 * Um jeito de falar WhatsApp.
 *
 * Regra de ouro: **o provedor nunca lança por falha de envio** — devolve
 * `enviado: false` com o erro dentro.
 *
 * Isso é o que concilia os dois contratos opostos que o sistema já tem. Quem
 * manda código de cadastro precisa de um 503 (não pode dizer que enviou quando
 * não enviou); quem manda resumo diário precisa que o erro seja engolido (não
 * pode derrubar o cron). Se o provedor lançasse, essa política ficaria
 * espalhada como try/catch presente-ou-ausente em 20 pontos de chamada — que é
 * exatamente a inconsistência de hoje. Com resultado-como-valor, a política
 * vira uma escolha de um método na fachada.
 */
export interface ProvedorWhatsappClient {
  readonly nome: ProvedorWhatsapp;
  /** Tem credencial pra mandar? */
  configurado(): boolean;
  enviar(envio: EnvioWhatsapp): Promise<ResultadoEnvio>;
}

/** Como o provedor aparece pro usuário em mensagem de erro. */
export const ROTULO_PROVEDOR: Record<ProvedorWhatsapp, string> = {
  evolution: "Evolution",
  meta: "Meta",
};
