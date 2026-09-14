"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { storeUrls } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
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
              {/* Este é o único passo que o dono NÃO cumpre sozinho: a viagem
                  nasce no celular do motorista. O painel inteiro não tinha um
                  link pra loja — o teste corria enquanto ele esperava alguém
                  instalar um app que ninguém disse onde achar. */}
              {ehProximo && p.chave === "app" && <LinksDaLoja />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function LinksDaLoja() {
  const android = storeUrls("android").web;
  const ios = storeUrls("ios").web;

  async function copiar() {
    const texto = `Baixe o app da Movatruck pra lançar as viagens:\nAndroid: ${android}\niPhone: ${ios}`;
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Link copiado. Cole no WhatsApp do motorista.");
    } catch {
      toast.error("Não consegui copiar", { description: "Copie o endereço da barra da loja." });
    }
  }

  return (
    <div className="ml-10 mt-1 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
      <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Button variant="outline" size="sm" asChild>
        <a href={android} target="_blank" rel="noreferrer">
          Google Play
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={ios} target="_blank" rel="noreferrer">
          App Store
        </a>
      </Button>
      <Button variant="default" size="sm" onClick={() => void copiar()} className="gap-1.5">
        <Copy className="h-3.5 w-3.5" aria-hidden />
        Copiar link pro motorista
      </Button>
    </div>
  );
}
