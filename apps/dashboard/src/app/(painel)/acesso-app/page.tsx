"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
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
import { AbaExcecoes } from "./_components/excecoes";
import { AbaPerfis } from "./_components/perfis";
import { AbaPlataforma } from "./_components/plataforma";
import { AbaQuemRecebe } from "./_components/quem-recebe";
import { CHAVE_PAINEL, type PainelAcessoApp } from "./_components/tipos";

type Aba = "perfis" | "quem-recebe" | "excecoes" | "plataforma";

/**
 * ACESSO AO APP — quem vê o quê no celular, configurado aqui e não mais
 * pessoa por pessoa.
 *
 * O desenho está em `docs/acesso-app-desenho.md`. A frase que resume: a
 * empresa diz quem recebe o quê; o sistema calcula o acesso de cada pessoa
 * pelo que já sabe dela; o contrato e a lei cortam por cima; e quando precisa
 * de exceção, ela tem motivo e autor.
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
  const [aba, setAba] = useState<Aba>("perfis");

  if (painel.isLoading) return <LoadingCard />;
  if (painel.error || !painel.data) {
    return <ErroCard erro={painel.error} onRetry={() => painel.refetch()} />;
  }
  const p = painel.data;
  const herdadas = p.excecoes.MIGRACAO ?? 0;

  const abas: { id: Aba; label: string }[] = [
    { id: "perfis", label: "Perfis" },
    { id: "quem-recebe", label: "Quem recebe" },
    { id: "excecoes", label: `Exceções${herdadas + (p.excecoes.MANUAL ?? 0) ? ` (${herdadas + (p.excecoes.MANUAL ?? 0)})` : ""}` },
    ...(p.plataforma ? [{ id: "plataforma" as const, label: "Plataforma" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Acesso ao app</h1>
        <p className="text-sm text-muted-foreground">
          O que cada pessoa vê no celular. Você diz quem recebe qual perfil; o sistema aplica pra
          todo mundo, e a exceção de uma pessoa só fica na ficha dela, com motivo.
        </p>
      </div>

      {p.fonte === "COLUNAS" && <BannerEspelho painel={p} />}

      {!!p.espelho.divergencias && (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm">
            O cálculo não conseguiu reproduzir a ficha de {p.espelho.divergencias} pessoa(s) e{" "}
            <strong>nada foi alterado</strong>. É defeito nosso — avise o suporte.
          </p>
        </Card>
      )}

      {p.sombra.length > 0 && <BannerSombra painel={p} />}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              aba === a.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === "perfis" && <AbaPerfis painel={p} />}
      {aba === "quem-recebe" && <AbaQuemRecebe key={p.versao} painel={p} />}
      {aba === "excecoes" && <AbaExcecoes painel={p} />}
      {aba === "plataforma" && p.plataforma && <AbaPlataforma key={p.versao} painel={p} />}
    </div>
  );
}

/**
 * Enquanto a empresa segue a ficha: o que se vê aqui é o ESPELHO dela, e o
 * caminho é passar pras regras — conferido pessoa por pessoa, sem mudar nada.
 */
function BannerEspelho({ painel }: { painel: PainelAcessoApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [passando, setPassando] = useState(false);
  const herdadas = painel.excecoes.MIGRACAO ?? 0;

  return (
    <Card className="border-blue-300 bg-blue-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1 text-sm">
          <p className="font-semibold">Hoje, quem manda é a ficha de cada motorista.</p>
          <p className="text-muted-foreground">
            O que você vê abaixo é o espelho dela: o perfil que a maioria tem, mais{" "}
            <strong>{herdadas}</strong> diferença(s) de quem tem algo a mais ou a menos. Pra
            configurar por aqui, passe a empresa pras regras. <strong>Não muda nada pra
            ninguém</strong>: conferimos pessoa por pessoa antes de virar, e as diferenças de hoje
            ficam guardadas, sem prazo pra vencer.
          </p>
        </div>
        <Permitido chave="perfis-acesso.editar">
          <Button onClick={() => setConfirmando(true)}>Configurar por aqui</Button>
        </Permitido>
      </div>

      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Passar a configurar o acesso por aqui</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Ninguém ganha nem perde nada agora — o sistema confere antes e, se não bater, não
                vira.
              </p>
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                As {herdadas} diferença(s) de hoje viram exceções com motivo, sem prazo.
              </p>
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Depois disso, os interruptores da ficha do motorista saem: mudar pra uma pessoa só
                passa a ser uma exceção com motivo.
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
                    toast.success("Pronto. A empresa agora configura o acesso por aqui.");
                    setConfirmando(false);
                    void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setPassando(false);
                  }
                }}
              >
                {passando ? "Conferindo…" : "Passar a configurar por aqui"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

/** "Se as travas valessem, N pessoas perderiam X" — informa, não impede. */
function BannerSombra({ painel }: { painel: PainelAcessoApp }) {
  const [aberto, setAberto] = useState(false);
  const total = painel.sombra.reduce((s, x) => s + x.pessoas, 0);
  return (
    <Card className="p-4">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setAberto((v) => !v)}>
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="text-sm">
          <p className="font-medium">
            Há {total} acesso(s) que hoje valem só porque algumas travas estão em aviso.
          </p>
          <p className="text-muted-foreground">
            Nada é tirado de ninguém enquanto a plataforma não ligar a trava.{" "}
            {aberto ? "Esconder" : "Ver quais"}
          </p>
        </div>
      </button>
      {aberto && (
        <ul className="mt-3 space-y-1 pl-8 text-sm">
          {painel.sombra.map((s) => (
            <li key={s.capacidade}>
              {CAPACIDADE_POR_CHAVE[s.capacidade as CapacidadeApp]?.label ?? s.capacidade}:{" "}
              <strong>{s.pessoas}</strong> pessoa(s)
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
