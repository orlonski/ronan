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
 * - Uma seção por grupo do menu, na ordem do menu; uma linha por item, e logo
 *   abaixo uma sub-linha por aba.
 * - TODO item do menu vira linha, mesmo quando divide a permissão com outro: a
 *   tela tem que refletir o menu, e quem procura o nome do menu tem que achar.
 *   A linha que divide a chave anota os outros lugares em `tambemEm` — marcar
 *   numa marca na outra, porque é a mesma chave.
 *   ⚠️ No menu real isso NÃO acontece mais: desde 23/09/2026 cada item e cada
 *   aba tem chave própria (Torre e Programação dividiam `programacao`, Ao vivo
 *   e Viagens dividiam `viagens`), e o menu-matriz.spec.ts barra o retorno. O
 *   caminho fica aqui como rede, pra matriz não esconder uma tela se a regra um
 *   dia ganhar exceção.
 * - A aba que repete a chave do próprio item não vira linha: é a mesma tela.
 * - Recurso do catálogo que o menu não alcança vai pra seção final
 *   "Sem item próprio no menu", na ordem do catálogo.
 * - Recurso do menu que não está em `recursos` (o catálogo que ESTA pessoa
 *   enxerga) não vira linha: a matriz só mostra o que dá pra marcar.
 *
 * Invariante (testado): todo recurso de `recursos` aparece em pelo menos uma
 * linha, e fora do menu em no máximo uma.
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
  const secoes: SecaoMatrizMenu[] = [];
  const nomeRecurso = (r: string) => rotulos.recurso?.(r) ?? r;
  /** Onde cada recurso aparece no menu ("Grupo › Item"), pra anotar nos outros. */
  const lugaresDe = new Map<string, string[]>();
  const todas: { linha: LinhaMatrizMenu; onde: string }[] = [];

  for (const grupo of menu) {
    const secao: SecaoMatrizMenu = { titulo: grupo.titulo, linhas: [] };
    for (const item of grupo.itens) {
      const lugares: { recurso: string | null; rotulo: string; aba: boolean }[] = [
        { recurso: recursoDe(item.perm), rotulo: item.label, aba: false },
        ...item.abas.map((a) => {
          const r = recursoDe(a.perm);
          const nomeAba = rotulos.aba?.(a.href) ?? (r ? nomeRecurso(r) : a.href);
          return { recurso: r, rotulo: `${item.label} › ${nomeAba}`, aba: true };
        }),
      ];
      const doItem = new Set<string>();
      for (const l of lugares) {
        if (!l.recurso || !noCatalogo.has(l.recurso) || doItem.has(l.recurso)) continue;
        doItem.add(l.recurso);
        const onde = `${grupo.titulo} › ${l.rotulo}`;
        const linha: LinhaMatrizMenu = { recurso: l.recurso, rotulo: l.rotulo, aba: l.aba, tambemEm: [] };
        secao.linhas.push(linha);
        todas.push({ linha, onde });
        lugaresDe.set(l.recurso, [...(lugaresDe.get(l.recurso) ?? []), onde]);
      }
    }
    if (secao.linhas.length > 0) secoes.push(secao);
  }
  for (const { linha, onde } of todas) {
    linha.tambemEm = (lugaresDe.get(linha.recurso) ?? []).filter((o) => o !== onde);
  }

  const sobras = recursos.filter((r, i) => !lugaresDe.has(r) && recursos.indexOf(r) === i);
  if (sobras.length > 0) {
    secoes.push({
      titulo: SECAO_SEM_ITEM_NO_MENU,
      linhas: sobras.map((r) => ({ recurso: r, rotulo: nomeRecurso(r), aba: false, tambemEm: [] })),
    });
  }
  return secoes;
}
