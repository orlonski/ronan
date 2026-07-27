/** Dono/repo a partir da URL do remoto (https ou ssh). */
export function repoDaUrl(url: string): { dono: string; repo: string } | null {
  const limpa = url.trim().replace(/\.git$/, "");
  const https = limpa.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!https) return null;
  return { dono: https[1]!, repo: https[2]! };
}

export type ResultadoPr = { url: string; jaExistia: boolean };

/**
 * Abre o PR da branch da task contra a base. Idempotente: se já existe PR
 * aberto pra essa branch (task disparada de novo), devolve o que existe em vez
 * de estourar — reprocessar uma task não pode virar erro nem PR duplicado.
 *
 * Erro aqui NÃO invalida o trabalho: a branch já está publicada. Quem chama
 * reporta o motivo e segue.
 */
export async function abrirPullRequest(entrada: {
  repoUrl: string;
  token: string;
  branch: string;
  base: string;
  titulo: string;
  corpo: string;
  apiUrl?: string;
}): Promise<ResultadoPr> {
  const alvo = repoDaUrl(entrada.repoUrl);
  if (!alvo) throw new Error(`Não reconheci dono/repo em "${entrada.repoUrl}"`);
  if (!entrada.token) throw new Error("Sem GITHUB_TOKEN para abrir o PR");

  const api = entrada.apiUrl ?? "https://api.github.com";
  const base = `${api}/repos/${alvo.dono}/${alvo.repo}`;
  const headers = {
    authorization: `Bearer ${entrada.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };

  const res = await fetch(`${base}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: entrada.titulo.slice(0, 250),
      head: entrada.branch,
      base: entrada.base,
      body: entrada.corpo.slice(0, 60_000),
    }),
  });

  if (res.ok) {
    const pr = (await res.json()) as { html_url?: string };
    if (!pr.html_url) throw new Error("GitHub aceitou mas não devolveu a URL do PR");
    return { url: pr.html_url, jaExistia: false };
  }

  // 422 costuma ser "já existe PR pra essa head" — procura e devolve o mesmo.
  if (res.status === 422) {
    const busca = await fetch(
      `${base}/pulls?state=open&head=${encodeURIComponent(`${alvo.dono}:${entrada.branch}`)}`,
      { headers },
    );
    if (busca.ok) {
      const lista = (await busca.json()) as { html_url?: string }[];
      const existente = lista.find((p) => p.html_url);
      if (existente?.html_url) return { url: existente.html_url, jaExistia: true };
    }
  }

  const corpo = await res.text().catch(() => "");
  throw new Error(`GitHub recusou o PR (${res.status}): ${corpo.slice(0, 300)}`);
}
