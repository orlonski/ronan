"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * O BOTÃO QUE LIBERA O PONTO.
 *
 * Antes era um checkbox no meio do formulário de Regras de ponto, atrás de dois
 * quadros de ajuda: o gestor da Schaba preencheu CNPJ e dia de fechamento,
 * salvou, viu "regras salvas" — e as telas continuaram fechadas, porque o que
 * abre é o checkbox que ele não achou. Agora é uma pergunta com um botão, no
 * lugar onde a pessoa está travada.
 *
 * ⚠️ Continua sendo DECLARAÇÃO da empresa (o fundamento é o acordo coletivo), só
 * que em um clique. O número do acordo é opcional de propósito: o gestor nem
 * sempre sabe de cabeça, e o contador preenche depois em Regras de ponto.
 */
export function LiberarPonto() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [ref, setRef] = useState("");

  const liberar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/config`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          fundamento: "ACORDO_COLETIVO",
          fundamentoReferencia: ref.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Ponto liberado.", {
        description: "Agora é só criar a jornada e cadastrar quem bate ponto.",
      });
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (e: Error) => toast.error("Não consegui liberar", { description: e.message }),
  });

  if (!temPermissao("config-ponto.editar")) {
    return (
      <p className="mt-1 text-muted-foreground">
        Seu acesso não inclui esta etapa: peça a quem administra a empresa no painel.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-background p-3">
      <div className="space-y-2 text-sm">
        <p>
          <strong>Pra que serve:</strong> a lei só aceita ponto pelo celular, sem relógio de ponto
          certificado, se a <strong>convenção ou o acordo coletivo da sua categoria</strong>{" "}
          permitir. Aqui você declara que isso existe.
        </p>
        <p>
          <strong>O que muda no sistema:</strong> só libera as telas do escritório (jornadas,
          cadastro e fechamento) e guarda quem confirmou e quando. Os cálculos e o app do
          funcionário não mudam.
        </p>
        <p>
          <strong>Não sabe se tem?</strong> Nem toda empresa tem. Pergunte ao{" "}
          <strong>contador</strong> ou ao <strong>sindicato</strong> antes de confirmar. Enquanto
          isso, o funcionário já consegue bater ponto no app: só as telas do escritório esperam.
        </p>
      </div>
      <Input
        aria-label="Nome ou número do acordo (opcional)"
        placeholder="Nome ou número do acordo, se souber (opcional — pode preencher depois)"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      <Button variant="success" disabled={liberar.isPending} onClick={() => liberar.mutate()}>
        {liberar.isPending ? "Liberando…" : "Sim, existe acordo coletivo: liberar o ponto"}
      </Button>
    </div>
  );
}

/**
 * A tela que aparece enquanto a empresa não confirmou o acordo coletivo.
 *
 * ⚠️ Não é burocracia nossa: controle eletrônico de jornada sem REP
 * certificado depende de previsão em convenção ou acordo coletivo.
 *
 * ⚠️ O que ISSO NÃO BLOQUEIA: a marcação. O funcionário continua batendo o
 * ponto pelo app desde o primeiro dia. Quem espera é o escritório.
 */
export function PrecisaFundamento() {
  const q = useApiQuery<Comecar>(`${PATH}/comecar`);
  // O quadro de etapas já traz o botão na etapa 1, mas some quando alguém já
  // bateu ponto — e aí a tela precisa ter o botão por conta própria.
  const quadroVisivel = !!q.data && !q.data.jaBateram;
  return (
    <div className="space-y-4">
      <ComecarPonto />
      {!quadroVisivel && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-5 text-sm">
          <p className="text-base font-semibold">Falta uma confirmação pra abrir esta tela</p>
          <LiberarPonto />
        </div>
      )}
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
      titulo: "Confirmar que a empresa tem acordo coletivo",
      texto: "",
      feita: d.fundamento,
      perm: "config-ponto.editar",
    },
    {
      titulo: "Criar a jornada de trabalho",
      texto:
        "É o horário combinado. Exemplo: segunda a sexta, das 8h às 17h, com 1h de almoço. O espelho compara as batidas com ela.",
      feita: d.jornadas > 0,
      href: "/ponto/jornadas",
      rotulo: "Criar a jornada",
      perm: "jornadas.editar",
    },
    {
      titulo: "Escolher quem bate ponto",
      texto:
        "Toque em “Registrar contratação” e informe nome, CPF e a jornada. Se a pessoa já é motorista, dá pra fazer isso direto na ficha dela em Motoristas (botão “Registrar pra bater ponto”).",
      feita: d.funcionarios > 0,
      href: "/ponto/funcionarios",
      rotulo: "Escolher quem bate ponto",
      perm: "funcionarios.criar",
    },
    {
      titulo: "A pessoa bate o primeiro ponto no celular",
      texto:
        'Ela abre o app Movatruck e entra com o CPF e a senha de sempre. Quem nunca usou o app toca em “Não tem cadastro? Criar agora”. Depois é só tocar no botão de ponto.',
      feita: d.jaBateram,
    },
  ];
  const atual = etapas.findIndex((e) => !e.feita);

  return (
    <div className="rounded-md border border-blue-300 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      <p className="text-base font-semibold">Pra começar o ponto: 4 passos</p>
      <p className="mb-3 text-sm text-muted-foreground">
        Faça um de cada vez, nesta ordem. O passo que falta está aberto. Este quadro some quando
        o primeiro ponto chegar.
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
                {eAtual && i === 0 && !path.startsWith("/ponto/configuracoes") && <LiberarPonto />}
                {eAtual && i === 0 && path.startsWith("/ponto/configuracoes") && (
                  <p className="mt-0.5 font-medium text-blue-700 dark:text-blue-300">
                    É o quadro logo abaixo, em “Regras de ponto”.
                  </p>
                )}
                {eAtual && i > 0 && (
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
