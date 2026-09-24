"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Banknote, Check, Circle, Upload, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LinksLoja } from "@/components/links-loja";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export type Passo = {
  chave: string;
  titulo: string;
  descricao: string;
  rota: string;
  cumprido: boolean;
};

export type EstadoPrimeirosPassos = {
  concluido: boolean;
  passos: Passo[];
  /** Fora da sequência: convites que não travam o caminho de ninguém. */
  ofertas: Passo[];
  /** A conta já roda: a primeira viagem do app chegou. */
  veterana: boolean;
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
 * O caminho da conta vazia até o primeiro motorista convidado.
 *
 * Some da home quando tudo está feito, e não tem botão de fechar: fechar seria
 * esconder o que ainda falta. O que ele NÃO faz mais é sumir pra sempre — a
 * lista continua em /comecar, porque quem contrata um auxiliar em março precisa
 * de um lugar pra onde mandá-lo.
 *
 * `veterana` é a outra porta de saída, e a mais importante: conta cuja primeira
 * viagem já chegou não está mais começando. Sem ela, todo item novo acrescentado
 * aqui reaparecia na home de quem usa o painel há meses — foi o que aconteceu
 * quando "Diga quanto vale a viagem" entrou na lista.
 */
export function PrimeirosPassos() {
  const { data } = usePrimeirosPassos();
  if (!data || data.concluido || data.veterana) return null;
  return (
    <Card className="space-y-4 p-5">
      <Cabecalho passos={data.passos} />
      <ListaDePassos passos={data.passos} />
      <Ofertas itens={data.ofertas} />
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
                </span>
                {!p.cumprido && (
                  <span className="block text-xs text-muted-foreground">{p.descricao}</span>
                )}
              </span>
              {ehProximo && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            </Link>
            {/* Este passo é do motorista, não do dono: ele baixa o app e se
                cadastra pelo celular. Aqui só vai o link. */}
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
            Faltam algumas coisas para o seu primeiro motorista começar a lançar.
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

/** Quantos passos da sequência já fecharam. */
export function contar(passos: Passo[]): { feitos: number; total: number } {
  return { feitos: passos.filter((p) => p.cumprido).length, total: passos.length };
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

const ICONE_OFERTA: Record<string, LucideIcon> = { historico: Upload, preco: Banknote };

/**
 * O que se PODE fazer, oferecido DEPOIS da lista — nunca o que falta fazer.
 *
 * Contorno tracejado e fora do placar de propósito: oferta não entra no "faltam
 * algumas coisas" nem segura o card na home. A importação já esteve em primeiro
 * lugar como passo e estava errado — a lista é uma ordem de dependência, e um
 * atalho que pula metade dela não tem posição nessa ordem. Embaixo, ela responde
 * a uma pergunta que a pessoa já faz sozinha enquanto lê a lista: "vou ter que
 * digitar tudo isso na mão?".
 *
 * O preço veio parar aqui pelo mesmo motivo: como passo, ele cobrava de quem
 * fatura fora do sistema uma tabela que essa pessoa nunca vai preencher.
 */
export function Ofertas({ itens }: { itens: Passo[] }) {
  // `?? []` porque painel e API sobem em builds separados: por alguns minutos o
  // painel novo conversa com a API velha, que ainda não manda `ofertas`. Sem
  // isto, a home inteira quebra num `.filter` de `undefined`.
  const abertas = (itens ?? []).filter((o) => !o.cumprido);
  if (abertas.length === 0) return null;
  return (
    <div className="space-y-2">
      {abertas.map((oferta) => {
        const Icone = ICONE_OFERTA[oferta.chave] ?? ArrowRight;
        return (
          <Link
            key={oferta.chave}
            href={oferta.rota as never}
            className="flex items-center gap-3 rounded-md border border-dashed p-3 transition-colors hover:bg-muted"
          >
            <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{oferta.titulo}</span>
              <span className="block text-xs text-muted-foreground">{oferta.descricao}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
