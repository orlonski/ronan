"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { CAPACIDADE_POR_CHAVE, type CapacidadeApp } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { PessoasDiferentes } from "./_components/excecoes";
import { Grupos } from "./_components/perfis";
import { AbaPlataforma } from "./_components/plataforma";
import { QuemEntra } from "./_components/quem-recebe";
import { CHAVE_PAINEL, type PainelAcessoApp } from "./_components/tipos";

/**
 * ACESSO AO APP — o que aparece no celular de cada pessoa.
 *
 * ⚠️ Lida de cima pra baixo, na ordem da pergunta de quem abre a tela:
 * 1. Quais GRUPOS existem e o que cada um vê.
 * 2. QUEM ENTRA em cada grupo (em frase; as regras especiais ficam ali dentro).
 * 3. Quem tem ALGO DIFERENTE do grupo, e por quê.
 *
 * A versão anterior (abas "Perfis / Quem recebe / Exceções / Plataforma", faixas
 * de "sombra" e "diferenças herdadas") era o motor à mostra, e o dono, vendo em
 * produção, disse que não entendeu nada. O mecanismo segue igual por baixo; a
 * tela fala a língua de quem configura. O que é da PLATAFORMA (travas, sombra,
 * liberações) fica num bloco recolhido no fim, que só a plataforma vê.
 *
 * Desenho do motor: `docs/acesso-app-desenho.md`.
 */
export default function AcessoAppPage() {
  return (
    <RequerTela chave="perfis-acesso.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const painel = useApiQuery<PainelAcessoApp>("/admin/acesso-app");

  if (painel.isLoading) return <LoadingCard />;
  if (painel.error || !painel.data) {
    return <ErroCard erro={painel.error} onRetry={() => painel.refetch()} />;
  }
  const p = painel.data;
  const porGrupos = p.fonte === "REGRAS";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Acesso ao app</h1>
        <p className="text-sm text-muted-foreground">O que aparece no celular de cada pessoa.</p>
      </div>

      {!porGrupos && <PassarParaGrupos />}

      {!!p.espelho.divergencias && (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm">
            Não conseguimos montar os grupos a partir das fichas de {p.espelho.divergencias} pessoa(s),
            e <strong>nada foi alterado</strong>. É defeito nosso: avise o suporte.
          </p>
        </Card>
      )}

      <Grupos painel={p} />
      <QuemEntra key={`q${p.versao}`} painel={p} />
      <PessoasDiferentes painel={p} />

      {p.plataforma && <ControlesDaPlataforma painel={p} />}
    </div>
  );
}

/**
 * Enquanto a empresa liga os acessos na ficha de cada motorista, a tela
 * mostra os grupos que essas fichas formam — e oferece passar a configurar
 * por aqui. Conferido pessoa por pessoa; ninguém perde nada.
 */
function PassarParaGrupos() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [passando, setPassando] = useState(false);

  return (
    <Card className="border-blue-300 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl space-y-1 text-sm">
          <p className="font-semibold">Hoje você liga os acessos motorista por motorista, na ficha de cada um.</p>
          <p className="text-muted-foreground">
            Abaixo estão os grupos que essas fichas já formam. Organizando por aqui, motorista novo
            já entra no grupo certo e você muda todo mundo de uma vez.{" "}
            <strong className="text-foreground">Ninguém perde nada na troca.</strong>
          </p>
        </div>
        <Permitido chave="perfis-acesso.editar">
          <Button onClick={() => setConfirmando(true)}>Organizar por grupos</Button>
        </Permitido>
      </div>

      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Organizar o acesso por grupos</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Cada pessoa continua vendo exatamente o que vê hoje. A gente confere antes; se algo não bater, não muda nada.</p>
              <p>
                Depois disso, as chavinhas de acesso saem da ficha do motorista. Pra mudar uma pessoa
                só, você usa “Dar ou tirar algo só dele”, na ficha dela.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmando(false)}>
                Agora não
              </Button>
              <Button
                variant="success"
                disabled={passando}
                onClick={async () => {
                  setPassando(true);
                  try {
                    await fetchApi("/admin/acesso-app/passar-para-regras", { method: "POST", token });
                    toast.success("Pronto. O acesso agora é organizado por grupos.");
                    setConfirmando(false);
                    void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setPassando(false);
                  }
                }}
              >
                {passando ? "Conferindo…" : "Organizar por grupos"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

/**
 * SÓ A PLATAFORMA VÊ: as travas, o que ainda não corta ("sombra") e as
 * liberações. Recolhido de propósito: não é o que se configura no dia a dia,
 * e é justamente o que deixava a tela incompreensível.
 */
function ControlesDaPlataforma({ painel }: { painel: PainelAcessoApp }) {
  const [aberto, setAberto] = useState(false);
  const total = painel.sombra.reduce((s, x) => s + x.pessoas, 0);
  return (
    <section className="border-t border-border pt-6">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Controles da plataforma (só você vê)
      </button>
      {aberto && (
        <div className="mt-4 space-y-4">
          {total > 0 && (
            <Card className="p-4 text-sm">
              <p className="font-medium">
                {total} acesso(s) que cortariam se as travas desta empresa fossem ligadas:
              </p>
              <ul className="mt-2 space-y-0.5 pl-4 text-muted-foreground">
                {painel.sombra.map((s) => (
                  <li key={s.capacidade}>
                    {CAPACIDADE_POR_CHAVE[s.capacidade as CapacidadeApp]?.label ?? s.capacidade}:{" "}
                    {s.pessoas} pessoa(s)
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <AbaPlataforma key={painel.versao} painel={painel} />
        </div>
      )}
    </section>
  );
}
