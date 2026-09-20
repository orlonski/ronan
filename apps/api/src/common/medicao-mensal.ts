import type { Ymd } from "./espelho-mensal";

/**
 * A COMPARAÇÃO: o que nós registramos contra o que o contratante mediu.
 *
 * É o artefato que muda a conversa do dia 20. Hoje a transportadora recebe a
 * planilha e confere no olho, obra por obra, sem base própria — e quando acha
 * um erro, discute de memória. Aqui a discussão passa a ser entre dois
 * registros, e o que ela leva pra mesa é uma lista de dias, não uma
 * impressão.
 *
 * ⚠️ Regra pura de propósito: nada de Prisma, nada de planilha. Recebe dois
 * lados já normalizados e devolve a diferença. É isso que permite trocar o
 * formato do arquivo do contratante — e ele vai mudar — sem encostar na regra
 * que decide quanto se cobra.
 *
 * ⚠️ E não existe "falta" aqui. Um dia que só nós temos NÃO é o contratante
 * mentindo, e um dia que só eles têm NÃO é o motorista relaxado: são duas
 * contagens que divergem, e quem resolve é gente olhando. O vocabulário desta
 * regra é "só nosso" e "só deles" exatamente pra não embutir culpa numa
 * subtração.
 */

/** O que NÓS registramos no período, por alocação. */
export type LadoNosso = {
  /** Como esta linha é identificada nos dois lados (alocação, motorista…). */
  chave: string;
  dias: Ymd[];
};

/**
 * O que ELES mediram.
 *
 * Dois modos porque existem dois tipos de planilha, e a diferença não é
 * cosmética: com a grade dia a dia dá pra apontar QUAL dia caiu, que é a
 * contestação que se ganha; com o total só dá pra dizer que o número não bate,
 * e alguém ainda vai ter que achar os dias no braço.
 */
export type LadoDeles = {
  chave: string;
  /** Planilha em grade: os dias que eles reconhecem. */
  dias?: Ymd[];
  /** Planilha resumida: só quantos dias eles contaram. */
  totalDias?: number;
};

export type Divergencia = {
  chave: string;
  /** POR_DIA aponta o dia; SO_TOTAL só sabe dizer que o número não bate. */
  modo: "POR_DIA" | "SO_TOTAL";
  concordam: Ymd[];
  /**
   * Temos registro e eles não contaram. É dinheiro a menos, e é o que se
   * contesta — com a data na mão.
   */
  soNosso: Ymd[];
  /**
   * Eles contaram e não temos registro. Não é dinheiro a menos, mas é o que
   * mais merece atenção: ou o motorista não marcou (e o próximo mês pode vir
   * sem esse dia), ou estão pagando por um dia que não aconteceu — e isso
   * volta como glosa depois.
   */
  soDeles: Ymd[];
  totalNosso: number;
  totalDeles: number;
  /** Positivo = eles contaram menos do que registramos. */
  diferenca: number;
  /**
   * A linha existe só de um lado.
   *
   * `NOSSO` = motorista alocado que não apareceu na medição: ninguém vai pagar
   * por ele, e passa despercebido justamente porque não tem linha pra comparar.
   * `DELES` = alguém na medição sem alocação nossa: ou é erro deles, ou é uma
   * alocação que ninguém cadastrou.
   */
  semContraparte: "NOSSO" | "DELES" | null;
  /** True quando os dois lados fecham. É o caso comum e merece sair da frente. */
  bate: boolean;
};

/**
 * Compara os dois lados. A união das chaves, não a interseção — quem aparece
 * só de um lado é justamente o erro mais caro e o mais fácil de não ver.
 */
export function compararMedicao(nossos: LadoNosso[], deles: LadoDeles[]): Divergencia[] {
  const porChaveNosso = new Map(nossos.map((n) => [n.chave, n]));
  const porChaveDeles = new Map(deles.map((d) => [d.chave, d]));
  const chaves = [...new Set([...porChaveNosso.keys(), ...porChaveDeles.keys()])].sort();

  return chaves.map((chave) => {
    const n = porChaveNosso.get(chave);
    const d = porChaveDeles.get(chave);

    const diasNossos = [...new Set(n?.dias ?? [])].sort();
    const temGrade = Array.isArray(d?.dias);
    const diasDeles = temGrade ? [...new Set(d!.dias!)].sort() : [];

    const totalNosso = diasNossos.length;
    const totalDeles = temGrade ? diasDeles.length : (d?.totalDias ?? 0);

    const setNossos = new Set(diasNossos);
    const setDeles = new Set(diasDeles);

    // No modo SO_TOTAL não dá pra dizer QUAL dia divergiu, e inventar uma
    // lista seria pior que não ter: a transportadora levaria pra mesa uma data
    // que ninguém consegue sustentar.
    const concordam = temGrade ? diasNossos.filter((x) => setDeles.has(x)) : [];
    const soNosso = temGrade ? diasNossos.filter((x) => !setDeles.has(x)) : [];
    const soDeles = temGrade ? diasDeles.filter((x) => !setNossos.has(x)) : [];

    const semContraparte = !d ? "NOSSO" : !n ? "DELES" : null;

    return {
      chave,
      modo: temGrade ? "POR_DIA" : "SO_TOTAL",
      concordam,
      soNosso,
      soDeles,
      totalNosso,
      totalDeles,
      diferenca: totalNosso - totalDeles,
      semContraparte,
      bate: semContraparte === null && totalNosso === totalDeles && soNosso.length === 0,
    };
  });
}

/** O resumo que a tela mostra antes de qualquer tabela. */
export function resumirDivergencias(divs: Divergencia[]) {
  const aContestar = divs.filter((d) => d.diferenca > 0 || d.semContraparte === "NOSSO");
  return {
    linhas: divs.length,
    batem: divs.filter((d) => d.bate).length,
    /** Dias que registramos e eles não contaram — o que vira pedido de ajuste. */
    diasAMenos: divs.reduce((s, d) => s + Math.max(0, d.diferenca), 0),
    /** Dias que eles contaram e não temos registro. */
    diasAMais: divs.reduce((s, d) => s + Math.max(0, -d.diferenca), 0),
    aContestar: aContestar.length,
    /** Linhas que existem só de um lado: o erro que passa despercebido. */
    semContraparte: divs.filter((d) => d.semContraparte !== null).length,
  };
}
