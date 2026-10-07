import { z } from "zod";

/**
 * Integrações: o sistema de uma empresa (ERP, app próprio) conversando com o
 * Movatruck por uma CHAVE DE ACESSO, sem ninguém digitar.
 *
 * Quem é dono do quê:
 *  - a INTEGRAÇÃO ("ERP Totvs") é da empresa, tem um `sistema` (o nome curto
 *    que identifica os números do outro lado) e o que ela pode fazer (escopos);
 *  - a CHAVE é só o segredo. Uma integração pode ter duas vivas ao mesmo tempo,
 *    pra trocar sem parar o sistema do cliente. Trocar a chave não muda quem é
 *    dono das viagens que ela criou.
 *
 * Desenho e motivos: docs/api-publica/04-proposta.md (Onda 1A) e 05-qa.md.
 */

/**
 * O que uma chave pode fazer. Nome estável de CONTRATO público (o integrador
 * escreve isto no código dele), então não muda quando a chave RBAC por trás
 * mudar.
 *
 * Cada escopo depende de chaves RBAC: na criação, quem cria precisa ter TODAS
 * (ninguém fabrica chave mais poderosa que ele mesmo); em cada chamada, elas
 * passam pelo teto da conta — módulo cancelado poda a chave sozinho, sem
 * apagar nada.
 */
export const ESCOPOS_INTEGRACAO = [
  {
    chave: "viagens:ler",
    titulo: "Vê viagens",
    descricao: "Consulta as viagens que a empresa tem no Movatruck.",
    permissoes: ["viagens.ver"],
  },
  {
    chave: "viagens:escrever",
    titulo: "Cria viagens",
    descricao:
      "Cria e atualiza viagens vindas do sistema de vocês. Viagem lançada pelo motorista no app continua sendo só dele.",
    permissoes: ["viagens.editar"],
  },
  {
    chave: "cadastros:escrever",
    titulo: "Cria motoristas, caminhões e locais",
    descricao:
      "Cadastra o que a viagem precisa e ainda não existe aqui. Não mexe em cadastro feito pelo painel nem em motorista que usa o app.",
    permissoes: ["motoristas.criar", "veiculos.criar", "locais.criar"],
  },
] as const;

export type EscopoIntegracao = (typeof ESCOPOS_INTEGRACAO)[number]["chave"];
export const ESCOPOS_INTEGRACAO_CHAVES = ESCOPOS_INTEGRACAO.map((e) => e.chave) as [
  EscopoIntegracao,
  ...EscopoIntegracao[],
];
export const EscopoIntegracaoSchema = z.enum(ESCOPOS_INTEGRACAO_CHAVES);

export const ESCOPO_POR_CHAVE: Record<EscopoIntegracao, (typeof ESCOPOS_INTEGRACAO)[number]> =
  Object.fromEntries(ESCOPOS_INTEGRACAO.map((e) => [e.chave, e])) as Record<
    EscopoIntegracao,
    (typeof ESCOPOS_INTEGRACAO)[number]
  >;

/** O escopo vale se TODAS as chaves RBAC dele estão no conjunto dado. */
export function escopoCabeEm(escopo: EscopoIntegracao, permissoes: ReadonlySet<string> | readonly string[]): boolean {
  const tem = Array.isArray(permissoes)
    ? (k: string) => (permissoes as readonly string[]).includes(k)
    : (k: string) => (permissoes as ReadonlySet<string>).has(k);
  return ESCOPO_POR_CHAVE[escopo].permissoes.every(tem);
}

/** Integrações vivas por empresa. Integração esquecida não pode virar população. */
export const MAX_INTEGRACOES_ATIVAS = 10;
/** Chaves vivas por integração: a atual e a nova, durante a troca. */
export const MAX_CHAVES_ATIVAS = 2;

/** O nome curto do sistema do outro lado ("erp", "app-frota"). */
export const SistemaIntegracaoSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "Use só letras minúsculas, números e hífen (até 32).");

export const CriarIntegracaoInput = z
  .object({
    nome: z.string().trim().min(2, "Dê um nome que diga que sistema é.").max(80),
    sistema: SistemaIntegracaoSchema,
    escopos: z.array(EscopoIntegracaoSchema).min(1, "Marque pelo menos uma coisa que ela pode fazer."),
  })
  .strict();
export type CriarIntegracaoInput = z.infer<typeof CriarIntegracaoInput>;

export const RevogarIntegracaoInput = z
  .object({ motivo: z.string().trim().min(5, "Escreva o motivo (pelo menos 5 letras).").max(300) })
  .strict();
export type RevogarIntegracaoInput = z.infer<typeof RevogarIntegracaoInput>;

/** Uma chave como a tela vê: nunca o segredo, só o suficiente pra reconhecer. */
export type ChaveIntegracaoResumo = {
  id: string;
  /** `mvt_live_Ab3k…x9Qe` */
  mascara: string;
  criadoEm: string;
  criadaPorNome: string | null;
  revogadaEm: string | null;
  revogacaoMotivo: string | null;
  ultimoUsoEm: string | null;
  ultimoUsoIp: string | null;
};

export type IntegracaoResumo = {
  id: string;
  nome: string;
  sistema: string;
  escopos: EscopoIntegracao[];
  /** Escopos gravados que o teto da conta (módulo, plano) não deixa valer agora. */
  escoposSuspensos: EscopoIntegracao[];
  criadoEm: string;
  criadaPorNome: string | null;
  revogadaEm: string | null;
  revogacaoMotivo: string | null;
  chaves: ChaveIntegracaoResumo[];
  uso: { ultimos7Dias: number; erros7Dias: number; ultimoUsoEm: string | null };
};

/** A resposta de "gerar chave": o ÚNICO momento em que o segredo existe fora do cliente. */
export type ChaveGerada = { chave: string; resumo: ChaveIntegracaoResumo };
