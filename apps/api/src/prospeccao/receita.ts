/**
 * Leitura da resposta da BrasilAPI (dados públicos da Receita Federal).
 *
 * Funções puras: a resposta vem bagunçada de um jeito que só se descobre
 * olhando dado real, e é aqui que a bagunça é normalizada — separado do serviço
 * pra dar pra testar sem rede.
 */

/** O que interessa da resposta. O resto do payload é grande e a gente ignora. */
export type RespostaCnpj = {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  ddd_telefone_1?: string | null;
  ddd_telefone_2?: string | null;
  email?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  porte?: string | null;
  capital_social?: number | string | null;
  descricao_situacao_cadastral?: string | null;
  municipio?: string | null;
  uf?: string | null;
  qsa?: Array<{ nome_socio?: string | null; qualificacao_socio?: string | null }> | null;
};

export type DadosEnriquecidos = {
  nomeFantasia: string | null;
  telefone: string | null;
  email: string | null;
  cnae: string | null;
  cnaeDescricao: string | null;
  porte: string | null;
  capitalSocial: number | null;
  situacaoCadastral: string | null;
  socio: string | null;
};

/**
 * A Receita guarda telefone vazio como uma fileira de zeros, não como nulo.
 * Sem isso "000000000000" viraria contato e alguém ligaria pra ele.
 */
export function telefoneValido(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const d = bruto.replace(/\D/g, "");
  if (d.length < 10 || d.length > 11) return null;
  // Todos os dígitos iguais (0000…, 9999…) é preenchimento, não telefone.
  if (/^(\d)\1+$/.test(d)) return null;
  return d;
}

export function emailValido(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const e = bruto.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/**
 * O sócio ADMINISTRADOR é quem decide. Quando a qualificação não diz, fica com
 * o primeiro — melhor um nome pra chamar do que nenhum.
 */
export function socioPrincipal(qsa: RespostaCnpj["qsa"]): string | null {
  const lista = (qsa ?? []).filter((s) => s?.nome_socio);
  if (lista.length === 0) return null;

  const admin = lista.find((s) => /administrador/i.test(s.qualificacao_socio ?? ""));
  return (admin ?? lista[0]).nome_socio?.trim() || null;
}

export function extrair(r: RespostaCnpj): DadosEnriquecidos {
  const capital =
    r.capital_social === null || r.capital_social === undefined
      ? null
      : Number(r.capital_social);

  return {
    nomeFantasia: r.nome_fantasia?.trim() || null,
    telefone: telefoneValido(r.ddd_telefone_1) ?? telefoneValido(r.ddd_telefone_2),
    email: emailValido(r.email),
    cnae: r.cnae_fiscal ? String(r.cnae_fiscal) : null,
    cnaeDescricao: r.cnae_fiscal_descricao?.trim() || null,
    porte: r.porte?.trim() || null,
    capitalSocial: Number.isFinite(capital) ? capital : null,
    situacaoCadastral: r.descricao_situacao_cadastral?.trim() || null,
    socio: socioPrincipal(r.qsa),
  };
}

/**
 * CNAEs do grupo 4930 — transporte rodoviário de carga. É a confirmação que a
 * razão social não dá: quem tem esse CNAE VENDE frete; quem tem RNTRC com CNAE
 * de comércio tirou registro pra levar a própria carga.
 *
 * 4930-2/01 municipal · /02 intermunicipal e interestadual · /03 produtos
 * perigosos · /04 mudanças.
 */
export function ehCnaeDeTransporteDeCarga(cnae: string | null): boolean {
  if (!cnae) return false;
  return cnae.replace(/\D/g, "").startsWith("4930");
}

/** CNAEs de quem move o granel que o produto atende (extração, obra, concreto). */
const PREFIXOS_GRANEL = [
  "0810", // extração de pedra, areia e argila
  "2330", // artefatos de concreto
  "2392", // cal e gesso
  "4211", // construção de rodovias
  "4213", // obras de arte especiais
  "4311", // demolição e preparação de terreno
  "4312", // terraplenagem
  "4744", // comércio de material de construção
];

export function ehCnaeDeGranel(cnae: string | null): boolean {
  if (!cnae) return false;
  const limpo = cnae.replace(/\D/g, "");
  return PREFIXOS_GRANEL.some((p) => limpo.startsWith(p));
}
