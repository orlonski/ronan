"use client";

import * as React from "react";
import { flexRender, type Cell, type Row } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import "./column-meta";
import type { MobileColuna } from "./column-meta";
import { LINHA_CLICAVEL_CLASSES, useLinhaClicavel } from "./linha-clicavel";

/** Sem `meta.mobile`, quantas colunas viram "campo" do cartão (as demais ficam só na tabela do desktop). */
const MAX_CAMPOS_PALPITE = 3;

type Papel = MobileColuna | "selecao";

/** `id` de coluna que costuma ser a de botões / a de checkbox de seleção em lote. */
const ID_ACOES = /^(acoes|acao|actions|action|menu)$/i;
const ID_SELECAO = /^(select|selecao|selecionar)$/i;

export function rotuloDaColuna(coluna: { columnDef: { header?: unknown; meta?: { rotulo?: string } } }): string | undefined {
  const r = coluna.columnDef.meta?.rotulo;
  if (r) return r;
  const h = coluna.columnDef.header;
  return typeof h === "string" && h.trim() ? h : undefined;
}

/** Decide o papel de cada coluna visível no cartão. Explícito (`meta.mobile`) sempre vence o palpite. */
export function classificarCelulas<T>(cells: Cell<T, unknown>[]): Papel[] {
  const explicitos = cells.map((c) => c.column.columnDef.meta?.mobile);
  const temTitulo = explicitos.includes("titulo");
  let tituloDado = temTitulo;
  let campos = 0;
  return cells.map((c, i) => {
    const e = explicitos[i];
    if (e) return e;
    if (ID_SELECAO.test(c.column.id)) return "selecao";
    if (ID_ACOES.test(c.column.id)) return "acoes";
    if (!tituloDado) {
      tituloDado = true;
      return "titulo";
    }
    if (campos < MAX_CAMPOS_PALPITE) {
      campos++;
      return "campo";
    }
    return "oculta";
  });
}

/**
 * Cartão montado a partir das colunas da tabela, pra tela que não tem `renderMobileCard` próprio.
 * Só aparece abaixo de 768px (quem decide é o `DataTable`). O cartão inteiro abre `href` (mesma regra
 * `useLinhaClicavel` da linha da tabela); botões e links de dentro seguem funcionando sem navegar.
 */
export function CartaoAutomatico<T>({ row, href }: { row: Row<T>; href?: string }) {
  const linhaClicavel = useLinhaClicavel();
  const cells = row.getVisibleCells();
  const papeis = classificarCelulas(cells);
  const doPapel = (p: Papel) => cells.filter((_, i) => papeis[i] === p);
  const render = (c: Cell<T, unknown>) => (
    <React.Fragment key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</React.Fragment>
  );
  const selecao = doPapel("selecao");
  const titulo = doPapel("titulo");
  const subtitulo = doPapel("subtitulo");
  const selos = doPapel("selo");
  const campos = doPapel("campo");
  const acoes = doPapel("acoes");

  return (
    <Card
      className={cn("overflow-hidden border-border/60 p-4", href && LINHA_CLICAVEL_CLASSES)}
      {...(href ? linhaClicavel(href) : {})}
    >
      <div className="flex items-start gap-3">
        {selecao.length > 0 && <div className="shrink-0 pt-0.5">{selecao.map(render)}</div>}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 break-words text-base font-medium [&_*]:break-words">{titulo.map(render)}</div>
            {selos.length > 0 && <div className="flex shrink-0 flex-wrap justify-end gap-1">{selos.map(render)}</div>}
          </div>
          {subtitulo.length > 0 && (
            <div className="break-words text-sm text-muted-foreground [&_*]:break-words">{subtitulo.map(render)}</div>
          )}
        </div>
      </div>
      {campos.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {campos.map((c) => {
            const rotulo = rotuloDaColuna(c.column);
            return (
              <div key={c.id} className="min-w-0">
                {rotulo && <dt className="text-sm text-muted-foreground">{rotulo}</dt>}
                <dd className="break-words [&_*]:break-words">{flexRender(c.column.columnDef.cell, c.getContext())}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {acoes.length > 0 && (
        <div data-no-row-click className="mt-3 flex items-center justify-end gap-1 border-t pt-2">{acoes.map(render)}</div>
      )}
    </Card>
  );
}
