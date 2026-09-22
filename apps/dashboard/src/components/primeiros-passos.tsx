"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LinksLoja } from "@/components/links-loja";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export type Passo = {
  chave: string;
  titulo: string;
  descricao: string;
  rota: string;
  cumprido: boolean;
  /** Atalho, não requisito — não conta pro "X de Y" nem segura a lista. */
  opcional?: boolean;
};

export type EstadoPrimeirosPassos = {
  concluido: boolean;
  passos: Passo[];
  chegadaDispensada: boolean;
};

export const CAMINHO_PRIMEIROS_PASSOS = "/admin/primeiros-passos";

/**
 * O estado do caminho da conta. Uma chamada, três telas: a home, a chegada e
 * /comecar. `staleTime` curto porque o caminho normal é a pessoa sair daqui,
 * cadastrar, e voltar — ela precisa ver o risco na volta.
 */
export function usePrimeirosPassos() {
  const token = useAuthToken();
  return useQuery({
    queryKey: [CAMINHO_PRIMEIROS_PASSOS],
    enabled: !!token,
    staleTime: 10_000,
    queryFn: () => fetchApi<EstadoPrimeirosPassos>(CAMINHO_PRIMEIROS_PASSOS, { token }),
  });
}

/**
 * O caminho da conta vazia até a primeira viagem.
 *
 * Some da home quando tudo está feito, e não tem botão de fechar: fechar seria
 * esconder o que ainda falta. O que ele NÃO faz mais é sumir pra sempre — a
 * lista continua em /comecar, porque quem contrata um auxiliar em março precisa
 * de um lugar pra onde mandá-lo.
 */
export function PrimeirosPassos() {
  const { data } = usePrimeirosPassos();
  if (!data || data.concluido) return null;
  return (
    <Card className="space-y-4 p-5">
      <Cabecalho passos={data.passos} />
      <ListaDePassos passos={data.passos} />
    </Card>
  );
}

/** A mesma lista, sem o cartão em volta — pra quem já está numa tela dedicada. */
export function ListaDePassos({ passos }: { passos: Passo[] }) {
  const proximo = passos.find((p) => !p.cumprido);

  return (
    <ul className="space-y-1">
      {passos.map((p) => {
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
                  {p.opcional && (
                    <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      atalho
                    </span>
                  )}
                </span>
                {!p.cumprido && (
                  <span className="block text-xs text-muted-foreground">{p.descricao}</span>
                )}
              </span>
              {ehProximo && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            </Link>
            {/* Este é o único passo que o dono NÃO cumpre sozinho: a viagem
                nasce no celular do motorista. */}
            {ehProximo && p.chave === "app" && <LinksLoja recuado />}
          </li>
        );
      })}
    </ul>
  );
}

export function Cabecalho({ passos }: { passos: Passo[] }) {
  const { feitos, total } = contar(passos);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Primeiros passos</h2>
          <p className="text-sm text-muted-foreground">
            Faltam algumas coisas para você lançar sua primeira viagem.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {feitos} de {total}
        </span>
      </div>
      <Barra feitos={feitos} total={total} />
    </>
  );
}

/**
 * O "X de Y" conta só o que é obrigatório.
 *
 * O atalho da planilha entra na lista mas não no placar: quem não tem planilha
 * veria um contador que nunca fecha, e um progresso que não chega ao fim
 * desmotiva mais do que a ausência dele.
 */
export function contar(passos: Passo[]): { feitos: number; total: number } {
  const obrigatorios = passos.filter((p) => !p.opcional);
  return {
    feitos: obrigatorios.filter((p) => p.cumprido).length,
    total: obrigatorios.length,
  };
}

/** O que já foi feito também motiva. */
export function Barra({ feitos, total }: { feitos: number; total: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${total === 0 ? 0 : (feitos / total) * 100}%` }}
      />
    </div>
  );
}
