import type { ReactNode } from "react";

/**
 * Renderiza o subconjunto de Markdown que os nossos documentos legais usam.
 *
 * POR QUE NÃO UMA BIBLIOTECA:
 *
 * `react-markdown` + `remark-gfm` são ~80 KB no bundle do painel inteiro pra
 * atender duas telas. O texto aqui não vem de usuário — é escrito por nós,
 * versionado em `docs/` e revisado em diff. O subconjunto é conhecido e pequeno:
 * títulos, negrito, itálico, listas, tabela, citação, linha e código inline.
 *
 * E POR QUE RENDERIZAR, em vez de mostrar o texto cru:
 *
 * Contrato com `**asterisco**` à mostra parece amador, e é mais difícil de ler.
 * Isso importa mais do que estética: o aceite se apoia em o texto ter sido
 * EXIBIDO de forma legível. Um documento que ninguém consegue ler
 * confortavelmente é mais fácil de contestar.
 *
 * Nada aqui usa `dangerouslySetInnerHTML` — cada pedaço vira elemento React, e
 * o que não for reconhecido sai como texto puro em vez de sumir.
 */
export function TextoMarkdown({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  const saida: ReactNode[] = [];
  let paragrafo: string[] = [];
  let lista: string[] = [];
  let tabela: string[] = [];
  let i = 0;

  const fecharParagrafo = () => {
    if (!paragrafo.length) return;
    saida.push(
      <p key={`p${i++}`} className="mb-4 leading-relaxed">
        {inline(paragrafo.join(" "))}
      </p>,
    );
    paragrafo = [];
  };

  const fecharLista = () => {
    if (!lista.length) return;
    saida.push(
      <ul key={`u${i++}`} className="mb-4 list-disc space-y-1.5 pl-5">
        {lista.map((item, n) => (
          <li key={n} className="leading-relaxed">
            {inline(item)}
          </li>
        ))}
      </ul>,
    );
    lista = [];
  };

  const fecharTabela = () => {
    if (!tabela.length) return;
    const celulas = (l: string) =>
      l
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
    const [cabecalho, ...resto] = tabela;
    // A segunda linha é o separador (|---|---|) e não é dado.
    const corpo = resto.filter((l) => !/^\|[\s:|-]+\|$/.test(l));
    saida.push(
      // Tabela é o único elemento que pode passar da largura no celular — por
      // isso rola sozinha em vez de espremer a coluna e quebrar a leitura.
      <div key={`t${i++}`} className="mb-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {celulas(cabecalho ?? "").map((c, n) => (
                <th
                  key={n}
                  className="border-b border-border px-3 py-2 text-left font-semibold"
                >
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corpo.map((linha, n) => (
              <tr key={n}>
                {celulas(linha).map((c, m) => (
                  <td key={m} className="border-b border-border/50 px-3 py-2 align-top">
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tabela = [];
  };

  const fecharTudo = () => {
    fecharParagrafo();
    fecharLista();
    fecharTabela();
  };

  for (const linha of linhas) {
    const l = linha.trimEnd();

    if (l.startsWith("|")) {
      fecharParagrafo();
      fecharLista();
      tabela.push(l);
      continue;
    }
    if (tabela.length) fecharTabela();

    if (!l.trim()) {
      fecharParagrafo();
      fecharLista();
      continue;
    }

    // Linha horizontal. O `---` do frontmatter já foi removido antes de chegar
    // aqui; este é separador de seção.
    if (/^-{3,}$/.test(l.trim())) {
      fecharTudo();
      saida.push(<hr key={`h${i++}`} className="my-6 border-border" />);
      continue;
    }

    const titulo = l.match(/^(#{1,4})\s+(.*)$/);
    if (titulo) {
      fecharTudo();
      const nivel = titulo[1]!.length;
      const conteudo = inline(titulo[2]!);
      const classe =
        nivel === 1
          ? "mb-4 mt-2 text-2xl font-bold"
          : nivel === 2
            ? "mb-3 mt-8 text-xl font-semibold"
            : "mb-2 mt-6 text-base font-semibold";
      saida.push(
        nivel === 1 ? (
          <h1 key={`t${i++}`} className={classe}>
            {conteudo}
          </h1>
        ) : nivel === 2 ? (
          <h2 key={`t${i++}`} className={classe}>
            {conteudo}
          </h2>
        ) : (
          <h3 key={`t${i++}`} className={classe}>
            {conteudo}
          </h3>
        ),
      );
      continue;
    }

    if (l.startsWith("> ")) {
      fecharTudo();
      saida.push(
        <blockquote
          key={`q${i++}`}
          className="mb-4 border-l-4 border-amber-400 bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/40"
        >
          {inline(l.slice(2))}
        </blockquote>,
      );
      continue;
    }

    const item = l.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      fecharParagrafo();
      lista.push(item[1]!);
      continue;
    }

    // Continuação de item de lista (linha indentada logo abaixo de um `-`).
    if (lista.length && /^\s{2,}\S/.test(l)) {
      lista[lista.length - 1] += ` ${l.trim()}`;
      continue;
    }

    paragrafo.push(l.trim());
  }
  fecharTudo();

  return <div className="text-sm text-foreground">{saida}</div>;
}

/** Negrito, itálico e código dentro de uma linha. */
function inline(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  // Ordem importa: `**` antes de `*`, senão o negrito vira dois itálicos.
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    const t = m[0];
    if (t.startsWith("**")) {
      partes.push(
        <strong key={n++} className="font-semibold">
          {t.slice(2, -2)}
        </strong>,
      );
    } else if (t.startsWith("`")) {
      partes.push(
        <code key={n++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {t.slice(1, -1)}
        </code>,
      );
    } else {
      partes.push(<em key={n++}>{t.slice(1, -1)}</em>);
    }
    ultimo = m.index + t.length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}
