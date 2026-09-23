"use client";

import Link from "next/link";
import type { Route } from "next";
import { BASE_PRECO_LABEL, type BasePrecoTipo } from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Preco = {
  id: string;
  material: { nome: string } | null;
  tipoServico: { nome: string } | null;
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  base: BasePrecoTipo;
  precoUnitario: string;
  vigenciaDe: string;
  vigenciaAte: string | null;
  ativo: boolean;
};

type Regra = {
  id: string;
  material: { nome: string } | null;
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  kmMinimo: string | null;
  toneladasMinimo: string | null;
  ativo: boolean;
};

function fmtNum(v: string | null): string {
  if (v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : v;
}

function fmtMoeda(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : v;
}

function fmtData(v: string): string {
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function faixa(de: string, ate: string | null): string {
  return `${fmtNum(de)} – ${ate ? fmtNum(ate) : "∞"} km`;
}

/**
 * PREÇO E MÍNIMO DESTE CLIENTE, dentro da página dele.
 *
 * Decidido com o dono em 23/09/2026: quem abre o cliente pensando "quanto eu
 * cobro dele?" não devia ter que ir a duas telas do menu e filtrar. Aqui é só
 * o RESUMO, de leitura — criar e mudar continua nas telas de Preço e de
 * Mínimo, que já chegam filtradas neste cliente (`?empresaId=`).
 *
 * Cada metade obedece à própria permissão: preço é comercial e nem todo mundo
 * que confere mínimo pode ver (ver o comentário em shared-types/permissoes.ts).
 * Sem nenhuma das duas, o cartão não existe.
 */
export function PrecoMinimoDoCliente({ clienteId }: { clienteId: string }) {
  const { temPermissao, temModulo } = usePermissoes();
  const vePreco = temPermissao("tabelas-preco.ver") && temModulo("tabelas-preco.ver");
  const veMinimo = temPermissao("regras-minimo.ver") && temModulo("regras-minimo.ver");

  const precos = useApiQuery<{ data: Preco[]; pagination: { total: number } }>(
    vePreco
      ? `/admin/tabelas-preco?empresaId=${clienteId}&pageSize=100&sort=vigenciaDe&order=desc`
      : undefined,
  );
  const regras = useApiQuery<{ data: Regra[]; pagination: { total: number } }>(
    veMinimo ? `/admin/regras-minimo?empresaId=${clienteId}&pageSize=100` : undefined,
  );

  if (!vePreco && !veMinimo) return null;

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Preço e mínimo deste cliente</h2>
      <p className="text-sm text-muted-foreground">
        O mínimo decide quanto se conta de cada viagem; o preço, quanto vale o que foi contado.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {vePreco && (
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Preço</h3>
              <Link
                href={`/tabelas-preco?empresaId=${clienteId}` as Route}
                className="text-sm text-primary underline"
              >
                Gerenciar preços
              </Link>
            </div>
            {precos.isLoading && <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>}
            {precos.data && precos.data.data.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhum preço cadastrado: as viagens deste cliente entram valendo zero.
              </p>
            )}
            {precos.data && precos.data.data.length > 0 && (
              <div className="mt-2 divide-y divide-border rounded-md border border-border">
                {precos.data.data.map((p) => (
                  <div key={p.id} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {p.material?.nome ?? "Qualquer material"}
                        {p.tipoServico && (
                          <span className="font-normal text-muted-foreground"> · {p.tipoServico.nome}</span>
                        )}
                      </span>
                      <span className="tabular-nums font-medium">
                        {fmtMoeda(p.precoUnitario)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {BASE_PRECO_LABEL[p.base].unidade.replace("R$", "")}
                        </span>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {faixa(p.kmFaixaDe, p.kmFaixaAte)} ·{" "}
                      {p.vigenciaAte
                        ? `${fmtData(p.vigenciaDe)} a ${fmtData(p.vigenciaAte)}`
                        : `desde ${fmtData(p.vigenciaDe)}`}
                      {!p.ativo && (
                        <Badge className="ml-2 border-border text-muted-foreground">Inativo</Badge>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {precos.data && precos.data.pagination.total > precos.data.data.length && (
              <p className="mt-1 text-xs text-muted-foreground">
                Mostrando {precos.data.data.length} de {precos.data.pagination.total}.
              </p>
            )}
          </section>
        )}

        {veMinimo && (
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Mínimo por viagem (km e tonelada)</h3>
              <Link
                href={`/regras-minimo?empresaId=${clienteId}` as Route}
                className="text-sm text-primary underline"
              >
                Gerenciar mínimos
              </Link>
            </div>
            {regras.isLoading && <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>}
            {regras.data && regras.data.data.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhum mínimo: cada viagem conta o km e o peso reais.
              </p>
            )}
            {regras.data && regras.data.data.length > 0 && (
              <div className="mt-2 divide-y divide-border rounded-md border border-border">
                {regras.data.data.map((r) => (
                  <div key={r.id} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{r.material?.nome ?? "Qualquer material"}</span>
                      <span className="tabular-nums">
                        {[
                          r.kmMinimo ? `${fmtNum(r.kmMinimo)} km` : null,
                          r.toneladasMinimo ? `${fmtNum(r.toneladasMinimo)} t` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {faixa(r.kmFaixaDe, r.kmFaixaAte)}
                      {!r.ativo && (
                        <Badge className="ml-2 border-border text-muted-foreground">Desligada</Badge>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {regras.data && regras.data.pagination.total > regras.data.data.length && (
              <p className="mt-1 text-xs text-muted-foreground">
                Mostrando {regras.data.data.length} de {regras.data.pagination.total}.
              </p>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
