/** Dono/repo a partir da URL do remoto (https ou ssh). */
export function repoDaUrl(url: string): { dono: string; repo: string } | null {
  const limpa = url.trim().replace(/\.git$/, "");
  const https = limpa.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!https) return null;
  return { dono: https[1]!, repo: https[2]! };
}

export type ResultadoPr = { url: string; numero: number; jaExistia: boolean };

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
    const pr = (await res.json()) as { html_url?: string; number?: number };
    if (!pr.html_url || !pr.number) {
      throw new Error("GitHub aceitou mas não devolveu URL/número do PR");
    }
    return { url: pr.html_url, numero: pr.number, jaExistia: false };
  }

  // 422 costuma ser "já existe PR pra essa head" — procura e devolve o mesmo.
  if (res.status === 422) {
    const busca = await fetch(
      `${base}/pulls?state=open&head=${encodeURIComponent(`${alvo.dono}:${entrada.branch}`)}`,
      { headers },
    );
    if (busca.ok) {
      const lista = (await busca.json()) as { html_url?: string; number?: number }[];
      const existente = lista.find((p) => p.html_url && p.number);
      if (existente?.html_url && existente.number) {
        return { url: existente.html_url, numero: existente.number, jaExistia: true };
      }
    }
  }

  const corpo = await res.text().catch(() => "");
  throw new Error(`GitHub recusou o PR (${res.status}): ${corpo.slice(0, 300)}`);
}

/**
 * Mescla o PR na base e apaga a branch.
 *
 * Tenta mais de uma vez de propósito: recém-criado, o PR ainda está com a
 * mesclabilidade sendo calculada e o GitHub responde 405 nesse meio-tempo —
 * desistir na primeira daria "não consegui mesclar" num PR perfeitamente
 * mesclável. Conflito de verdade também é 405, então quem separa os dois é o
 * tempo: depois das tentativas, o PR fica aberto e o relato diz o motivo.
 */
export async function mesclarPullRequest(entrada: {
  repoUrl: string;
  token: string;
  numero: number;
  branch: string;
  metodo: "squash" | "merge" | "rebase";
  titulo: string;
  apiUrl?: string;
  esperarMs?: number;
}): Promise<{ sha: string }> {
  const alvo = repoDaUrl(entrada.repoUrl);
  if (!alvo) throw new Error(`Não reconheci dono/repo em "${entrada.repoUrl}"`);

  const api = entrada.apiUrl ?? "https://api.github.com";
  const base = `${api}/repos/${alvo.dono}/${alvo.repo}`;
  const headers = {
    authorization: `Bearer ${entrada.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };

  let ultimoErro = "";
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const res = await fetch(`${base}/pulls/${entrada.numero}/merge`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        merge_method: entrada.metodo,
        commit_title: `${entrada.titulo} (#${entrada.numero})`,
      }),
    });

    if (res.ok) {
      const corpo = (await res.json()) as { sha?: string };
      // Branch mesclada não serve mais pra nada: deixá-la acumula lixo no
      // remoto e faz o próximo disparo da mesma task colidir com ela.
      await fetch(`${base}/git/refs/heads/${encodeURIComponent(entrada.branch)}`, {
        method: "DELETE",
        headers,
      }).catch(() => undefined);
      return { sha: corpo.sha ?? "" };
    }

    ultimoErro = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (res.status !== 405 || tentativa === 3) break;
    await new Promise((r) => setTimeout(r, entrada.esperarMs ?? 4_000));
  }

  throw new Error(`GitHub recusou o merge (${ultimoErro})`);
}
