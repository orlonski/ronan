"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Passo = {
  chave: string;
  titulo: string;
  descricao: string;
  rota: string;
  cumprido: boolean;
};

const PATH = "/admin/primeiros-passos";

/**
 * O caminho da conta vazia até a primeira viagem.
 *
 * Some sozinho quando tudo está feito, e nunca mais volta — quem já opera não
 * precisa ver lista de tarefas na home todo dia. É por isso que ele não tem
 * botão de fechar: fechar seria esconder o que ainda falta, e quem fecha por
 * engano no primeiro dia perde a única indicação de por onde começar.
 */
export function PrimeirosPassos() {
  const token = useAuthToken();
  const { data } = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    // Cada passo cumprido muda o card, e o caminho normal é a pessoa sair
    // daqui, cadastrar, e voltar. Cache curto pra ela ver o risco na volta.
    staleTime: 10_000,
    queryFn: () => fetchApi<{ concluido: boolean; passos: Passo[] }>(PATH, { token }),
  });

  if (!data || data.concluido) return null;

  const feitos = data.passos.filter((p) => p.cumprido).length;
  const proximo = data.passos.find((p) => !p.cumprido);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Primeiros passos</h2>
          <p className="text-sm text-muted-foreground">
            Faltam algumas coisas para você lançar sua primeira viagem.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {feitos} de {data.passos.length}
        </span>
      </div>

      {/* Barra de progresso: o que já foi feito também motiva. */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(feitos / data.passos.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-1">
        {data.passos.map((p) => {
          const ehProximo = p.chave === proximo?.chave;
          return (
            <li key={p.chave}>
              <Link
                href={p.rota as never}
                className={
                  ehProximo
                    ? "flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
                    : "flex items-start gap-3 rounded-md p-3 transition-colors hover:bg-muted"
                }
              >
                {p.cumprido ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      p.cumprido
                        ? "block text-sm font-medium text-muted-foreground line-through"
                        : "block text-sm font-medium"
                    }
                  >
                    {p.titulo}
                  </span>
                  {!p.cumprido && (
                    <span className="block text-xs text-muted-foreground">{p.descricao}</span>
                  )}
                </span>
                {ehProximo && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
