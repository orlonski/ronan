import { z } from "zod";

/**
 * Aceite de termos: o contrato com quem paga, e a prova de que foi aceito.
 *
 * O desenho todo gira em torno de uma ideia: **"aceitou os termos" sem saber
 * QUAIS termos não prova nada.** Por isso o aceite aponta pra uma versão
 * específica, e a versão guarda o texto inteiro mais o hash dele.
 */

export const TipoTermoSchema = z.enum(["USO", "PRIVACIDADE"]);
export type TipoTermo = z.infer<typeof TipoTermoSchema>;

/** De onde veio o clique. Os dois têm peso diferente — ver `AceitarTermoInput`. */
export const OrigemAceiteSchema = z.enum(["CADASTRO", "PAINEL"]);
export type OrigemAceite = z.infer<typeof OrigemAceiteSchema>;

/**
 * O que a tela precisa saber pra decidir se mostra o modal.
 *
 * `pendentes` vazio = está tudo aceito, não incomoda o usuário. Qualquer item
 * ali = tem documento novo esperando.
 */
export const StatusAceiteSchema = z.object({
  pendentes: z.array(
    z.object({
      termoVersaoId: z.string().uuid(),
      tipo: TipoTermoSchema,
      versao: z.string(),
      /**
       * Resumo do que mudou. Pedir que alguém releia 2.500 palavras sem dizer o
       * que mudou é pedir que ele clique sem ler — e clique sem leitura é
       * exatamente o que enfraquece a prova numa disputa.
       */
      oQueMudou: z.string().nullable(),
      /** `true` quando é a primeira vez; `false` quando é reaceite de versão nova. */
      primeiroAceite: z.boolean(),
    }),
  ),
});
export type StatusAceite = z.infer<typeof StatusAceiteSchema>;

/**
 * O aceite em si.
 *
 * Repare no que NÃO está aqui: nome, e-mail, documento, IP e user agent. Eles
 * são gravados, mas saem do TOKEN e da REQUISIÇÃO, nunca do corpo — senão a
 * "prova" seria um dado que o próprio cliente escolheu mandar.
 */
export const AceitarTermoInput = z.object({
  termoVersaoId: z.string().uuid("Diga qual versão está sendo aceita."),
  /**
   * O texto que a tela mostrou, em hash. A API compara com o hash guardado e
   * recusa se divergir.
   *
   * Parece paranoia e não é: sem isso, uma aba aberta há três dias aceita a
   * versão antiga depois de você ter publicado uma nova, e o registro diz que
   * a pessoa concordou com um texto que ela nunca viu.
   */
  sha256: z.string().length(64, "Hash inválido."),
});
export type AceitarTermoInput = z.infer<typeof AceitarTermoInput>;

/** O documento pra leitura — o que a tela pública de termos mostra. */
export const TermoPublicoSchema = z.object({
  id: z.string().uuid(),
  tipo: TipoTermoSchema,
  versao: z.string(),
  corpo: z.string(),
  sha256: z.string(),
  vigenteDesde: z.string(),
  publicadoEm: z.string().nullable(),
  oQueMudou: z.string().nullable(),
});
export type TermoPublico = z.infer<typeof TermoPublicoSchema>;

/** O recibo, pro cliente provar o que aceitou e quando. */
export const ReciboAceiteSchema = z.object({
  tipo: TipoTermoSchema,
  versao: z.string(),
  sha256: z.string(),
  aceitoEm: z.string(),
  nomeQuemAceitou: z.string(),
  emailQuemAceitou: z.string(),
  documento: z.string().nullable(),
  origem: OrigemAceiteSchema,
});
export type ReciboAceite = z.infer<typeof ReciboAceiteSchema>;

/** Publicação de versão nova. Só a plataforma faz isso. */
export const PublicarTermoInput = z.object({
  tipo: TipoTermoSchema,
  versao: z
    .string()
    .trim()
    .regex(/^\d+\.\d+$/, "Use o formato 1.0, 1.1, 2.0."),
  corpo: z.string().min(200, "O texto parece curto demais para um contrato."),
  /**
   * Quando passa a valer. Futuro = agendada, e é o caminho certo quando a
   * mudança é significativa: os Termos prometem 30 dias de aviso, e publicar
   * com vigência imediata quebraria a própria cláusula 12.
   */
  vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD."),
  oQueMudou: z.string().trim().max(1000).optional(),
});
export type PublicarTermoInput = z.infer<typeof PublicarTermoInput>;
