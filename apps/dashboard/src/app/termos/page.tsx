import type { Metadata } from "next";
import type { TermoPublico } from "@ronan/shared-types";
import { TextoMarkdown } from "@/components/texto-markdown";

export const metadata: Metadata = {
  title: "Termos de Uso — Movatruck",
  description: "Os Termos de Uso do sistema Movatruck, e as versões anteriores.",
};

// Contrato muda raramente, mas quando muda todo mundo precisa ver a versão
// nova. Uma hora de cache é o meio-termo entre não martelar a API e não deixar
// texto velho no ar depois de uma publicação.
export const revalidate = 3600;

/**
 * A tela pública dos Termos.
 *
 * É pública porque contrato que só quem já é cliente consegue ler é contrato
 * que ninguém lê antes de assinar — e o checkbox do cadastro aponta pra cá,
 * antes de existir login.
 *
 * Mostra TODAS as versões publicadas, não só a vigente. Quem aceitou a 1.0
 * precisa conseguir reler a 1.0: a prova guardada aponta pra um texto
 * específico, e esconder o texto antigo esvaziaria a prova.
 */
export default async function TermosPage() {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  let versoes: TermoPublico[] = [];

  try {
    const r = await fetch(`${base}/termos?tipo=USO`, { next: { revalidate } });
    if (r.ok) versoes = await r.json();
  } catch {
    // Cai no aviso abaixo em vez de estourar a página inteira.
  }

  const vigente = versoes[0];
  const anteriores = versoes.slice(1);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      {!vigente ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Não consegui carregar os Termos agora. Recarregue em instantes ou fale com
          a gente em contato@movatruck.com.br.
        </div>
      ) : (
        <>
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900">Termos de Uso</h1>
            <p className="mt-2 text-sm text-slate-500">
              Versão {vigente.versao} — em vigor desde{" "}
              {new Date(vigente.vigenteDesde).toLocaleDateString("pt-BR")}
            </p>
          </header>

          <article>
            <TextoMarkdown texto={vigente.corpo} />
          </article>

          {anteriores.length > 0 ? (
            <section className="mt-12 border-t border-slate-200 pt-6">
              <h2 className="text-lg font-semibold text-slate-900">Versões anteriores</h2>
              <p className="mt-1 text-sm text-slate-500">
                Se você aceitou uma versão anterior, é ela que vale para o seu contrato
                até você aceitar a nova.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {anteriores.map((v) => (
                  <li key={v.id}>
                    <a
                      href={`/termos/${v.versao}`}
                      className="font-medium text-slate-900 underline underline-offset-2"
                    >
                      Versão {v.versao}
                    </a>
                    <span className="text-slate-500">
                      {" "}
                      — vigorou a partir de{" "}
                      {new Date(v.vigenteDesde).toLocaleDateString("pt-BR")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
