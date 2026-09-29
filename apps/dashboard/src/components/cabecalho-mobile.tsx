"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LogoConta } from "@/components/logo-conta";
import { Topbar } from "@/components/topbar";
import { useCabecalhoDeclarado } from "@/lib/cabecalho";
import { ehPaginaRaiz, rotaPai, tituloDaRota } from "@/lib/menu";

/**
 * Cabeçalho do CELULAR (abaixo de 768px; no desktop quem manda é o cabeçalho
 * fininho só com o sino, no painel-shell).
 *
 * - Página raiz (as da barra inferior e as do menu): logo da empresa + sino.
 * - Página filha (ficha, edição, cadastro novo): botão Voltar + título + sino.
 *
 * O título é o que a tela declarou (usePageTitle) ou, sem isso, o nome do item
 * do menu a que a rota pertence. O Voltar leva ao destino que a tela declarou;
 * sem declaração, volta no histórico e, se não houver (app aberto direto na
 * ficha), sobe um nível na rota.
 */
export function CabecalhoMobile() {
  const pathname = usePathname();
  const router = useRouter();
  const { titulo: declarado, voltarHref } = useCabecalhoDeclarado();
  const raiz = ehPaginaRaiz(pathname);
  const titulo = declarado ?? (raiz ? null : tituloDaRota(pathname));

  function voltar() {
    if (window.history.length > 1) router.back();
    else router.push(rotaPai(pathname) as any);
  }

  const classeVoltar =
    "-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted";

  return (
    <header className="flex min-h-14 items-center gap-1 border-b bg-background px-3 md:hidden">
      {!raiz &&
        (voltarHref ? (
          <Link href={voltarHref as any} aria-label="Voltar" className={classeVoltar}>
            <ArrowLeft className="h-6 w-6" />
          </Link>
        ) : (
          <button type="button" onClick={voltar} aria-label="Voltar" className={classeVoltar}>
            <ArrowLeft className="h-6 w-6" />
          </button>
        ))}
      <div className="flex min-w-0 flex-1 items-center">
        {titulo ? (
          <p className="truncate text-lg font-semibold">{titulo}</p>
        ) : (
          <LogoConta width={112} className="text-foreground" />
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <Topbar />
      </div>
    </header>
  );
}
