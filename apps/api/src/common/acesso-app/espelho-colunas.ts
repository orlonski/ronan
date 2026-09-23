import {
  CAPACIDADES_APP,
  type AcessoAppChave,
  type CapacidadeApp,
} from "@ronan/shared-types";

/**
 * O ESPELHO DO CADASTRO: perfil padrão + exceções que reproduzem, pessoa por
 * pessoa, exatamente o que as colunas `pode*` dizem hoje.
 *
 * ⚠️ É o que permite ligar o sistema novo sem mexer em ninguém. Enquanto a
 * empresa estiver em `fonte: COLUNAS`, a ficha continua mandando e isto aqui
 * roda de hora em hora: o que o escritório mudou na ficha vira exceção no
 * espelho. Quando a empresa passar a `REGRAS`, o espelho para e o que ele
 * deixou vira o ponto de partida — o presente congelado, sem nada vencer.
 *
 * Função pura. Quem carrega e grava é o `AcessoAppService`.
 */

export type ColunasAcesso = Partial<Record<AcessoAppChave, boolean>>;

/**
 * Nomes dos grupos que o espelho cria. Editáveis depois como qualquer outro.
 *
 * ⚠️ São o que o escritório LÊ na tela, então são nomes de gente, não de
 * mecanismo. Até 22/09/2026 eram "Padrão da empresa (herdado)" e "Registrado
 * (herdado)" — e o dono, vendo a tela, disse que não entendeu nada. Os nomes
 * antigos continuam reconhecidos (`NOMES_ANTIGOS_HERDADOS`) pra renomear o
 * que já existe sem criar um grupo duplicado.
 */
/** O motorista que ainda não tem modalidade (tela Motoristas › Modalidades). */
export const PERFIL_HERDADO_MOTORISTA = "Sem modalidade";
/** O CLT sem cadastro de motorista (mecânico, escritório). */
export const PERFIL_HERDADO_FUNCIONARIO = "Só bate ponto";
export const NOMES_ANTIGOS_HERDADOS: Record<string, string[]> = {
  [PERFIL_HERDADO_MOTORISTA]: ["Motorista parceiro", "Motoristas", "Padrão da empresa (herdado)"],
  [PERFIL_HERDADO_FUNCIONARIO]: ["CLT que não dirige", "Registrados (CLT)", "Registrado (herdado)"],
};

/**
 * ⚠️ Os perfis herdados NÃO aparecem na tela antiga de perfis (a das 13
 * colunas): lá eles mostrariam as colunas, que não dizem o que o perfil
 * herdado é — e "aplicar" o Registrado num motorista desligaria tudo dele.
 * Ficam invisíveis até a tela nova, que lê `capacidades`.
 */
export const PERFIS_HERDADOS = [
  PERFIL_HERDADO_MOTORISTA,
  PERFIL_HERDADO_FUNCIONARIO,
  ...Object.values(NOMES_ANTIGOS_HERDADOS).flat(),
];

export const MOTIVO_ESPELHO = "Já era assim na ficha dele.";

/**
 * O que um conjunto de colunas significa em capacidades.
 *
 * As capacidades NOVAS (sem coluna) nascem LIGADAS pra quem tem cadastro de
 * motorista: hoje ninguém as barra — "Minha programação", "Meus acertos",
 * "Compartilhar posição", navegação por voz e documentos aparecem pra todo
 * cadastro de empresa. Nascer desligado seria tirar do celular de alguém uma
 * coisa que ele usa, que é exatamente o que não pode acontecer.
 */
export function capacidadesDasColunas(colunas: ColunasAcesso): CapacidadeApp[] {
  const out: CapacidadeApp[] = [];
  for (const def of CAPACIDADES_APP) {
    if (def.colunaLegada) {
      if (colunas[def.colunaLegada.coluna] === true) out.push(def.chave);
    } else if (def.vinculo !== "FUNCIONARIO" && def.tipo === "EMPRESA") {
      out.push(def.chave);
    }
  }
  return out;
}

/**
 * O que todo registrado tem: o ponto inteiro e os documentos que a empresa
 * pedir de quem é registrado.
 *
 * Documentos entrou em 22/09/2026, quando o registrado passou a poder mandar
 * papel pelo app. Não muda nada pra ninguém até a empresa criar uma exigência
 * "de quem é registrado": a tela só aparece quando há o que mandar.
 */
export function capacidadesDoRegistradoHerdado(): CapacidadeApp[] {
  return [
    ...CAPACIDADES_APP.filter((d) => d.vinculo === "FUNCIONARIO").map((d) => d.chave),
    "app.documentos.enviar",
  ];
}

const chaveDoConjunto = (c: readonly string[]) => [...c].sort().join("|");

export type MotoristaEspelho = {
  id: string;
  cpf: string;
  perfilAcessoId: string | null;
  colunas: ColunasAcesso;
};

export type ExcecaoPlanejada = {
  cpf: string;
  capacidade: CapacidadeApp;
  efeito: "CONCEDER" | "NEGAR";
};

export type PlanoEspelho = {
  /** Capacidades do perfil padrão herdado (o conjunto mais comum). */
  padrao: CapacidadeApp[];
  /** Capacidades de cada perfil já existente, lidas das colunas dele. */
  perfis: Map<string, CapacidadeApp[]>;
  /** O que cada motorista tem que ter no fim (é o que o portão confere). */
  desejado: Map<string, CapacidadeApp[]>;
  excecoes: ExcecaoPlanejada[];
};

/**
 * Monta o espelho.
 *
 * O padrão é o conjunto MAIS COMUM entre quem não está em perfil nenhum —
 * assim o número de exceções é o menor possível, e cada exceção que sobra é
 * uma diferença real que alguém pôs na ficha. Empate: o menor conjunto em
 * ordem de chave, só pra dar o mesmo resultado em toda rodada.
 */
export function planejarEspelho(
  motoristas: readonly MotoristaEspelho[],
  perfisExistentes: readonly { id: string; colunas: ColunasAcesso }[],
  padraoSemMotoristas: ColunasAcesso,
): PlanoEspelho {
  const perfis = new Map<string, CapacidadeApp[]>();
  for (const p of perfisExistentes) perfis.set(p.id, capacidadesDasColunas(p.colunas));

  const desejado = new Map<string, CapacidadeApp[]>();
  for (const m of motoristas) desejado.set(m.id, capacidadesDasColunas(m.colunas));

  const contagem = new Map<string, { n: number; caps: CapacidadeApp[] }>();
  for (const m of motoristas) {
    if (m.perfilAcessoId && perfis.has(m.perfilAcessoId)) continue;
    const caps = desejado.get(m.id)!;
    const k = chaveDoConjunto(caps);
    const atual = contagem.get(k);
    if (atual) atual.n++;
    else contagem.set(k, { n: 1, caps });
  }
  let padrao: CapacidadeApp[] | null = null;
  let melhor: { n: number; k: string } | null = null;
  for (const [k, v] of contagem) {
    if (!melhor || v.n > melhor.n || (v.n === melhor.n && k < melhor.k)) {
      melhor = { n: v.n, k };
      padrao = v.caps;
    }
  }
  padrao ??= capacidadesDasColunas(padraoSemMotoristas);

  const excecoes: ExcecaoPlanejada[] = [];
  for (const m of motoristas) {
    const base = new Set(
      m.perfilAcessoId && perfis.has(m.perfilAcessoId) ? perfis.get(m.perfilAcessoId)! : padrao,
    );
    const quer = new Set(desejado.get(m.id)!);
    for (const def of CAPACIDADES_APP) {
      if (def.vinculo === "FUNCIONARIO") continue;
      const b = base.has(def.chave);
      const q = quer.has(def.chave);
      if (b === q) continue;
      excecoes.push({ cpf: m.cpf, capacidade: def.chave, efeito: q ? "CONCEDER" : "NEGAR" });
    }
  }
  return { padrao, perfis, desejado, excecoes };
}
