import { z } from "zod";
import { telefoneDigits } from "./telefone";

/**
 * Captação de lead pelo site institucional.
 *
 * Duas coisas separadas moram aqui:
 *  - o LEAD, que é alguém pedindo contato (dado pessoal, tratado sob legítimo
 *    interesse — art. 7º IX da LGPD, com o aviso de privacidade linkado no
 *    próprio formulário);
 *  - o EVENTO de navegação, que é anônimo de propósito: sem cookie, sem
 *    fingerprint, sem IP gravado. É contagem, não perfil.
 *
 * A separação não é estética. Evento anônimo não é dado pessoal e não carrega
 * as obrigações do lead; misturar os dois numa tabela só transformaria toda a
 * analytics em base de dados pessoais.
 */

/** De onde veio o lead. Cresce conforme abrir canal novo. */
export const ORIGENS_LEAD = [
  "SITE_FORMULARIO",
  "SITE_CALCULADORA",
  "SITE_WHATSAPP",
  "INDICACAO",
  "PROSPECCAO_ATIVA",
  "FEIRA",
  // Abriu a conta sozinho pelo site. Já é cliente em teste, não é mais um
  // contato a trabalhar — entra no funil direto como ganho.
  "AUTO_CADASTRO",
] as const;
export type OrigemLead = (typeof ORIGENS_LEAD)[number];

/** Só o que o formulário público aceita. Nada aqui é opcional por descuido. */
export const CriarLeadInput = z.object({
  nome: z.string().trim().min(2, "Diga seu nome").max(120),
  empresa: z.string().trim().min(2, "Diga o nome da empresa").max(160),
  telefone: z
    .string()
    .trim()
    .transform(telefoneDigits)
    .refine((d) => d.length === 10 || d.length === 11, "Telefone incompleto"),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160).optional(),
  cidade: z.string().trim().max(120).optional(),
  /** Quantos caminhões — texto livre porque a resposta honesta costuma ser "uns 12". */
  frota: z.string().trim().max(60).optional(),
  mensagem: z.string().trim().max(2000).optional(),
  origem: z.enum(ORIGENS_LEAD).default("SITE_FORMULARIO"),
  /** Marcação de campanha, quando a visita veio de link rastreado. */
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
  /** Página onde ele estava quando pediu contato. */
  paginaOrigem: z.string().trim().max(500).optional(),
  /**
   * Isca de robô: campo escondido no formulário que humano nenhum preenche.
   * Chegou preenchido, a requisição é descartada — mas devolvendo 200, pra não
   * ensinar o robô qual campo evitar.
   */
  website: z.string().max(200).optional(),
});
export type CriarLeadInput = z.infer<typeof CriarLeadInput>;

/** Tipos de evento que o site reporta. Fechado de propósito: lista aberta vira lixo. */
export const TIPOS_EVENTO_SITE = [
  "PAGEVIEW",
  "CTA_WHATSAPP",
  "CTA_FORMULARIO_ABRIU",
  "CTA_FORMULARIO_ENVIOU",
  "CTA_APP",
  "SECAO_VISTA",
] as const;
export type TipoEventoSite = (typeof TIPOS_EVENTO_SITE)[number];

export const RegistrarEventoSiteInput = z.object({
  tipo: z.enum(TIPOS_EVENTO_SITE),
  /** Caminho da página, sem query string — a query pode carregar dado pessoal. */
  caminho: z.string().trim().max(300).default("/"),
  /** Rótulo livre do que foi clicado ou visto (ex.: "hero", "faq"). */
  rotulo: z.string().trim().max(120).optional(),
  /** Domínio de origem, só o host. Nunca a URL inteira. */
  referenciaHost: z.string().trim().max(160).optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
  /**
   * Identificador de sessão que morre quando a aba fecha (sessionStorage, não
   * cookie). Serve pra saber que 5 pageviews são de uma pessoa só, e nada além
   * disso — não atravessa sessões nem identifica ninguém.
   */
  sessao: z.string().trim().max(40).optional(),
});
export type RegistrarEventoSiteInput = z.infer<typeof RegistrarEventoSiteInput>;
