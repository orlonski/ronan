import { notFound } from "next/navigation";
import type { TermoPublico } from "@ronan/shared-types";
import { TextoMarkdown } from "@/components/texto-markdown";

export const revalidate = 3600;

/**
 * Uma versão específica dos Termos.
 *
 * Existe porque a prova de aceite aponta pra um texto exato. Quem aceitou a 1.0
 * precisa conseguir reler a 1.0 mesmo depois da 2.0 entrar — senão o recibo
 * dele vira um número sem documento por trás.
 */
export default async function TermoVersaoPage({
  params,
}: {
  params: Promise<{ versao: string }>;
}) {
  const { versao } = await params;
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;

  let lista: TermoPublico[] = [];
  try {
    const r = await fetch(`${base}/termos?tipo=USO`, { next: { revalidate } });
    if (r.ok) lista = await r.json();
  } catch {
    // cai no notFound
  }

  const doc = lista.find((v) => v.versao === versao);
  if (!doc) notFound();

  const vigente = lista[0]?.versao === doc.versao;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Termos de Uso</h1>
        <p className="mt-2 text-sm text-slate-500">
          Versão {doc.versao} — a partir de{" "}
          {new Date(doc.vigenteDesde).toLocaleDateString("pt-BR")}
        </p>
        {!vigente ? (
          <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 px-4 py-3 text-sm">
            Esta não é a versão em vigor.{" "}
            <a href="/termos" className="font-medium underline underline-offset-2">
              Ver a versão atual
            </a>
            .
          </div>
        ) : null}
      </header>

      <article>
        <TextoMarkdown texto={doc.corpo} />
      </article>

      {/* O hash fica visível de propósito: é ele que liga o recibo do cliente a
          este texto. Sem isso, "aceitei a 1.0" não tem como ser conferido por
          quem aceitou. */}
      <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-400">
        <p>Identificador do texto (SHA-256):</p>
        <p className="mt-1 break-all font-mono">{doc.sha256}</p>
      </footer>
    </main>
  );
}
