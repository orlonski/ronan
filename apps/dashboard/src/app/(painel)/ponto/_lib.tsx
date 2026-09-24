"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

export const PATH = "/admin/ponto";

/** "-1h20" / "+8h05". O espelho é lido por gente, não por máquina. */
export function hm(min: number): string {
  const sinal = min < 0 ? "-" : min > 0 ? "+" : "";
  const abs = Math.abs(min);
  return `${sinal}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

/** Sem sinal: total trabalhado não é saldo. */
export function duracao(min: number): string {
  const abs = Math.abs(min);
  return `${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

export function diaBr(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export type ConfigPonto = {
  contaId: string;
  razaoSocial: string;
  cnpj: string;
  fundamento: "ACORDO_COLETIVO" | null;
  fundamentoReferencia: string | null;
  diaFechamento: number;
  identificacaoRep: string;
  diasRetencaoLocalizacao: number;
  avisoLgpdTexto: string;
  mesesAcessoAposDesligamento: number;
};

export function useConfigPonto() {
  const token = useAuthToken();
  return useQuery({
    queryKey: [PATH, "config"],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigPonto>(`${PATH}/config`, { token }),
  });
}

/**
 * A tela que aparece ANTES de qualquer outra enquanto a empresa não disse por
 * que o controle dela vale.
 *
 * ⚠️ Não é burocracia nossa: controle eletrônico de jornada sem REP
 * certificado depende de previsão em convenção ou acordo coletivo. Deixar
 * operar sem isso seria a gente entregando uma ferramenta que o cliente não
 * pode usar — e ele só descobriria na fiscalização.
 *
 * ⚠️ O que ISSO NÃO BLOQUEIA: a marcação. O funcionário continua batendo o
 * ponto pelo app desde o primeiro dia. Quem espera é o escritório.
 */
export function PrecisaFundamento() {
  return (
    <div className="space-y-4">
    <ComecarPonto />
    <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-6">
      <p className="text-base font-semibold">Falta dizer por que o controle desta empresa vale</p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        O registro eletrônico de jornada por aplicativo, sem equipamento certificado, depende de
        previsão em convenção ou acordo coletivo da categoria. Informe qual é o acordo em{" "}
        <strong>Regras de ponto</strong> e as telas abrem.
      </p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Enquanto isso, quem é registrado <strong>já pode bater o ponto pelo app</strong> — o
        registro nunca fica travado por configuração nossa.
      </p>
    </div>
    </div>
  );
}

type Comecar = { fundamento: boolean; jornadas: number; funcionarios: number; jaBateram: boolean };

/**
 * "PRA COMEÇAR O PONTO": as quatro etapas, na ordem, no alto de toda tela de
 * ponto até a primeira batida chegar.
 *
 * Pedido do dono (23/09/2026): a ordem só existia espalhada — o aviso do
 * acordo sem link, a jornada numa dica dentro do formulário de contratação, e
 * o "entra com o CPF" num toast que some. Quem começa do zero ia perguntar.
 *
 * Cada etapa diz o que é, marca ✓ quando já foi feita e leva à tela certa. Quem
 * não pode fazer a etapa lê a quem pedir, em vez de um botão que dá 403.
 * Some sozinho quando alguém bate o primeiro ponto: não atrapalha quem já usa.
 */
export function ComecarPonto() {
  const path = usePathname();
  const { temPermissao } = usePermissoes();
  const q = useApiQuery<Comecar>(`${PATH}/comecar`);
  const d = q.data;
  if (!d || d.jaBateram) return null;

  const etapas: {
    titulo: string;
    texto: string;
    feita: boolean;
    href?: string;
    rotulo?: string;
    perm?: string;
  }[] = [
    {
      titulo: "Dizer qual acordo coletivo permite o ponto pelo app",
      texto:
        "Ponto por aplicativo depende de previsão na convenção ou no acordo coletivo da categoria. Quem sabe qual é o de vocês é o contador ou o sindicato.",
      feita: d.fundamento,
      href: "/ponto/configuracoes",
      rotulo: "Abrir Regras de ponto",
      perm: "config-ponto.editar",
    },
    {
      titulo: "Criar a jornada de trabalho",
      texto:
        "Por exemplo: segunda a sexta, das 8h às 17h, com 1h de almoço. É com ela que o espelho compara as batidas.",
      feita: d.jornadas > 0,
      href: "/ponto/jornadas",
      rotulo: "Abrir Jornadas e escalas",
      perm: "jornadas.editar",
    },
    {
      titulo: "Registrar quem bate ponto",
      texto:
        "Nome, CPF, data de admissão e a jornada. Motorista registrado em carteira também entra aqui, e continua com o cadastro de motorista.",
      feita: d.funcionarios > 0,
      href: "/ponto/funcionarios",
      rotulo: "Abrir Quem bate ponto",
      perm: "funcionarios.criar",
    },
    {
      titulo: "A pessoa bate o primeiro ponto no celular",
      texto:
        'Ela instala o app "Movatruck" (Play Store ou App Store). Na primeira vez, toca em "Não tem cadastro? Criar agora" e cria a senha com o CPF dela. Quem já usa o app (motorista registrado, por exemplo) entra com o CPF e a senha de sempre.',
      feita: d.jaBateram,
    },
  ];
  const atual = etapas.findIndex((e) => !e.feita);

  return (
    <div className="rounded-md border border-blue-300 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      <p className="text-base font-semibold">Pra começar o ponto</p>
      <p className="mb-3 text-sm text-muted-foreground">
        Quatro etapas, nesta ordem. Este quadro some quando o primeiro ponto chegar.
      </p>
      <ol className="space-y-3">
        {etapas.map((e, i) => {
          const eAtual = i === atual;
          const aqui = e.href && (path === e.href || path.startsWith(`${e.href}/`));
          const pode = !e.perm || temPermissao(e.perm);
          return (
            <li key={e.titulo} className={cn("flex gap-3", !eAtual && !e.feita && "opacity-60")}>
              {e.feita ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-label="Feito" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Falta" />
              )}
              <div className="min-w-0 text-sm">
                <p className={cn("font-medium", e.feita && "text-muted-foreground line-through")}>
                  {i + 1}. {e.titulo}
                </p>
                {eAtual && (
                  <>
                    <p className="mt-0.5 text-muted-foreground">{e.texto}</p>
                    {e.href &&
                      (aqui ? (
                        <p className="mt-1 font-medium text-blue-700 dark:text-blue-300">
                          É nesta tela.
                        </p>
                      ) : pode ? (
                        <Link
                          href={e.href as Route}
                          className="mt-1 inline-block font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                        >
                          {e.rotulo} →
                        </Link>
                      ) : (
                        <p className="mt-1 text-muted-foreground">
                          Seu acesso não inclui esta etapa: peça a quem administra a empresa no
                          painel.
                        </p>
                      ))}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
