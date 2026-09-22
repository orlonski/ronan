"use client";

import { menuDoApp } from "@ronan/shared-types";

/**
 * O CELULAR DELE, desenhado a partir das capacidades.
 *
 * Usa o mesmo `MENU_APP` de `shared-types` que o app vai usar pra montar as
 * abas — então a prévia não tem como dizer uma coisa e o app mostrar outra.
 * É esboço, não print: serve pra responder "o que aparece pra ele?" sem
 * precisar pegar o celular de ninguém.
 */
export function AppPreview({ capacidades, nome }: { capacidades: string[]; nome?: string }) {
  const itens = menuDoApp(capacidades);
  const abas = itens.filter((i) => i.onde === "aba");
  const inicio = itens.filter((i) => i.onde === "inicio");
  const perfil = itens.filter((i) => i.onde === "perfil");

  return (
    <div className="mx-auto w-[260px] rounded-[2rem] border-4 border-foreground/80 bg-background p-2 shadow-lg">
      <div className="flex h-[480px] flex-col overflow-hidden rounded-[1.5rem] border border-border">
        <div className="bg-[#DF7234] px-3 py-3 text-white">
          <p className="text-[10px] uppercase tracking-wider opacity-80">Início</p>
          <p className="truncate text-sm font-semibold">{nome ?? "Motorista"}</p>
        </div>
        <div className="flex-1 space-y-1.5 overflow-y-auto bg-muted/40 p-2">
          {inicio.map((i) => (
            <div
              key={i.id}
              className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-medium"
            >
              {i.label}
            </div>
          ))}
          {perfil.length > 0 && (
            <>
              <p className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                No perfil
              </p>
              {perfil.map((i) => (
                <div
                  key={i.id}
                  className="rounded-lg border border-dashed border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground"
                >
                  {i.label}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="grid border-t border-border bg-card" style={{ gridTemplateColumns: `repeat(${abas.length}, 1fr)` }}>
          {abas.map((a) => (
            <div key={a.id} className="py-2 text-center text-[10px] font-medium text-muted-foreground">
              {a.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
