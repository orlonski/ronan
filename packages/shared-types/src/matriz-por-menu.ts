/**
 * A MATRIZ DE PAPÉIS SEGUE O MENU.
 *
 * Pedido do dono (23/09/2026): quem monta um papel procura a linha pelo lugar
 * onde a tela mora no menu. Antes a matriz agrupava pelo `modulo` do catálogo
 * ("Operação", "Cadastros", "Sistema") — uma divisão que o menu abandonou faz
 * tempo, então cada reorganização do menu deixava a matriz falando outra língua.
 *
 * Aqui a matriz é DERIVADA do menu: item que muda de grupo ou vira aba de outro
 * item leva a linha junto, sem ninguém editar a matriz.
 *
 * ⚠️ O `modulo` do catálogo continua existindo e não é daqui: o papel padrão
 * "Operador" (PERMISSOES_OPERADOR) e o seed do backend dependem dele.
 *
 * Mora em shared-types, e não no dashboard, porque é função pura sobre o
 * catálogo — e porque assim o teste de invariante (apps/api, o único pacote com
 * runner) consegue importá-la.
 */

/** O menu sem ícones: só o que a matriz precisa saber. */
export type MenuDescricao = {
  titulo: string;
  soPlataforma?: boolean;
  itens: {
    label: string;
    href: string;
    perm?: string;
    /** As outras abas do item (o `ou` do menu), em ordem. */
    abas: { href: string; perm?: string }[];
  }[];
}[];

export type LinhaMatrizMenu = {
  recurso: string;
  /** "Item" ou "Item › Aba". */
  rotulo: string;
  /** É aba de um item (sub-linha)? */
  aba: boolean;
  /** Outros lugares do menu onde o mesmo recurso aparece ("Grupo › Item"). */
  tambemEm: string[];
};

export type SecaoMatrizMenu = { titulo: string; linhas: LinhaMatrizMenu[] };

export const SECAO_SEM_ITEM_NO_MENU = "Sem item próprio no menu";

function recursoDe(perm: string | undefined): string | null {
  if (!perm) return null;
  return perm.split(".")[0] || null;
}

/**
 * Distribui os recursos do catálogo pelas seções do menu.
 *
 * - Uma seção por grupo do menu, na ordem do menu; uma linha por recurso do
 *   item, e logo abaixo uma sub-linha por recurso de cada aba.
 * - Recurso que aparece em vários lugares fica UMA vez, na CASA dele: o item
 *   cujo endereço tem o nome do recurso (`viagens` em /viagens, `programacao`
 *   em /programacao). Sem casa, na primeira posição. As outras vão pra
 *   `tambemEm`. Sem essa regra os checkboxes de Viagens caíam em "Ao vivo",
 *   que vem antes no menu e usa a mesma chave.
 * - Recurso do catálogo que o menu não alcança vai pra seção final
 *   "Sem item próprio no menu", na ordem do catálogo.
 * - Recurso do menu que não está em `recursos` (o catálogo que ESTA pessoa
 *   enxerga) não vira linha: a matriz só mostra o que dá pra marcar.
 *
 * Invariante (testado): todo recurso de `recursos` sai em exatamente uma linha.
 */
export function agruparRecursosPorMenu(
  menu: MenuDescricao,
  recursos: readonly string[],
  rotulos: {
    /** Rótulo da aba pelo href (o das abas da tela). */
    aba?: (href: string) => string | undefined;
    /** Rótulo do recurso no catálogo (RECURSOS_LABEL). */
    recurso?: (recurso: string) => string | undefined;
  } = {},
): SecaoMatrizMenu[] {
  const noCatalogo = new Set(recursos);
  const linhaDe = new Map<string, LinhaMatrizMenu>();
  const secoes: SecaoMatrizMenu[] = [];
  const nomeRecurso = (r: string) => rotulos.recurso?.(r) ?? r;
  const ehCasa = (recurso: string, href: string) =>
    href === `/${recurso}` || href.startsWith(`/${recurso}/`);
  const temCasa = new Set<string>();
  for (const grupo of menu)
    for (const item of grupo.itens) {
      for (const h of [{ href: item.href, perm: item.perm }, ...item.abas]) {
        const r = recursoDe(h.perm);
        if (r && ehCasa(r, h.href)) temCasa.add(r);
      }
    }
  /** Lugares vistos antes de chegar na casa: viram `tambemEm` dela. */
  const antesDaCasa = new Map<string, string[]>();

  for (const grupo of menu) {
    const secao: SecaoMatrizMenu = { titulo: grupo.titulo, linhas: [] };
    for (const item of grupo.itens) {
      const lugares: { recurso: string | null; rotulo: string; aba: boolean; href: string }[] = [
        { recurso: recursoDe(item.perm), rotulo: item.label, aba: false, href: item.href },
        ...item.abas.map((a) => {
          const r = recursoDe(a.perm);
          const nomeAba = rotulos.aba?.(a.href) ?? (r ? nomeRecurso(r) : a.href);
          return { recurso: r, rotulo: `${item.label} › ${nomeAba}`, aba: true, href: a.href };
        }),
      ];
      // Recursos já vistos NESTE item: a aba que repete o recurso do próprio
      // item (Torre › Quando avisar) é a mesma tela, não "outro lugar".
      const doItem = new Set<string>();
      for (const l of lugares) {
        if (!l.recurso || !noCatalogo.has(l.recurso)) continue;
        const existente = linhaDe.get(l.recurso);
        if (existente) {
          const onde = `${grupo.titulo} › ${l.rotulo}`;
          if (!doItem.has(l.recurso) && !existente.tambemEm.includes(onde)) existente.tambemEm.push(onde);
          doItem.add(l.recurso);
          continue;
        }
        // Tem casa e ainda não chegamos nela: anota este lugar e segue.
        if (temCasa.has(l.recurso) && !ehCasa(l.recurso, l.href)) {
          const lista = antesDaCasa.get(l.recurso) ?? [];
          const onde = `${grupo.titulo} › ${l.rotulo}`;
          if (!lista.includes(onde)) lista.push(onde);
          antesDaCasa.set(l.recurso, lista);
          continue;
        }
        doItem.add(l.recurso);
        const linha: LinhaMatrizMenu = {
          recurso: l.recurso,
          rotulo: l.rotulo,
          aba: l.aba,
          tambemEm: [...(antesDaCasa.get(l.recurso) ?? [])],
        };
        linhaDe.set(l.recurso, linha);
        secao.linhas.push(linha);
      }
    }
    if (secao.linhas.length > 0) secoes.push(secao);
  }

  const sobras = recursos.filter((r, i) => !linhaDe.has(r) && recursos.indexOf(r) === i);
  if (sobras.length > 0) {
    secoes.push({
      titulo: SECAO_SEM_ITEM_NO_MENU,
      linhas: sobras.map((r) => ({ recurso: r, rotulo: nomeRecurso(r), aba: false, tambemEm: [] })),
    });
  }
  return secoes;
}
