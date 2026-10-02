"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, PlugZap } from "lucide-react";
import { toast } from "sonner";
import {
  AMBIENTE_ASAAS_LABEL,
  detectarAmbienteAsaas,
  type AmbienteAsaasTipo,
  type ConexaoAsaasResumo,
} from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export default function CobrancaAsaasPage() {
  return (
    <RequerTela chave="cobranca-asaas.ver">
      <Conteudo />
    </RequerTela>
  );
}

function dataHoraBR(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

function Conteudo() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [trocando, setTrocando] = React.useState(false);

  const conexao = useQuery({
    queryKey: ["cobranca-asaas-conexao"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<ConexaoAsaasResumo>("/admin/cobranca-asaas/conexao", { token: token! }),
  });

  async function atualizar(r?: ConexaoAsaasResumo) {
    if (r) queryClient.setQueryData(["cobranca-asaas-conexao"], r);
    await queryClient.invalidateQueries({ queryKey: ["cobranca-asaas-conexao"] });
    await queryClient.invalidateQueries({ queryKey: ["cobranca-asaas-situacao"] });
  }

  async function registrarWebhook() {
    if (!token) return;
    try {
      const r = await fetchApi<ConexaoAsaasResumo>("/admin/cobranca-asaas/conexao/webhook", { token, method: "POST" });
      await atualizar(r);
      if (r.webhookRegistrado) toast.success("Aviso de pagamento registrado no Asaas.");
      else toast.error("O Asaas ainda não aceitou o aviso de pagamento.", { description: r.webhookErro ?? undefined });
    } catch (e) {
      toast.error("Não consegui registrar", { description: (e as Error).message });
    }
  }

  async function desconectar() {
    if (!token) return;
    const ok = await confirmar({
      variant: "destructive",
      title: "Desconectar a conta Asaas?",
      description:
        "Os boletos e Pix já emitidos continuam valendo no Asaas, mas o pagamento deles deixa de dar baixa sozinho aqui. Novas cobranças só depois de conectar de novo.",
      confirmLabel: "Desconectar",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      await fetchApi("/admin/cobranca-asaas/conexao", { token, method: "DELETE" });
      await atualizar();
      toast.success("Conta Asaas desconectada.");
    } catch (e) {
      toast.error("Não consegui desconectar", { description: (e as Error).message });
    }
  }

  const c = conexao.data;

  return (
    <div className="space-y-5">
      <ConfirmDialog />
      <FormPageHeader
        title="Cobrança pelo Asaas"
        description="Boleto e Pix das faturas saem da SUA conta Asaas, e o pagamento dá baixa sozinho no título."
        backHref="/financeiro"
      />

      {conexao.isLoading && <LoadingCard />}
      {!conexao.isLoading && conexao.isError && (
        <ErroCard erro={conexao.error} onRetry={() => void conexao.refetch()} />
      )}

      {c && !c.disponivel && (
        <Card className="border-l-4 border-l-amber-500 p-4 text-sm">{c.motivoIndisponivel}</Card>
      )}

      {c?.conectada && !trocando && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium">
                  Conectado à conta Asaas {c.nomeContaAsaas ? <strong>{c.nomeContaAsaas}</strong> : "(nome não informado pelo Asaas)"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {c.documentoContaAsaas && <>Documento {c.documentoContaAsaas} · </>}
                  chave terminada em <span className="font-mono">…{c.chaveFinal}</span>
                  {c.conectadoEm && <> · desde {dataHoraBR(c.conectadoEm)}</>}
                </p>
              </div>
            </div>
            {c.ambiente && (
              <Badge
                className={`border-transparent ${
                  c.ambiente === "PRODUCAO" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {AMBIENTE_ASAAS_LABEL[c.ambiente]}
              </Badge>
            )}
          </div>

          {c.ambiente === "SANDBOX" && (
            <p className="text-sm text-amber-800">
              Ambiente de teste: os boletos gerados aqui não cobram ninguém de verdade.
            </p>
          )}

          {c.webhookRegistrado ? (
            <p className="text-sm text-muted-foreground">
              Aviso de pagamento ligado: quando o cliente pagar, o título recebe a baixa sozinho.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                As cobranças já podem sair, mas a baixa automática ainda não chega. {c.webhookErro}
              </span>
              <Permitido chave="cobranca-asaas.editar">
                <Button size="sm" onClick={() => void registrarWebhook()}>
                  Tentar de novo
                </Button>
              </Permitido>
            </div>
          )}

          <Permitido chave="cobranca-asaas.editar">
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setTrocando(true)}>
                Trocar a chave
              </Button>
              <Button variant="destructive" onClick={() => void desconectar()}>
                Desconectar
              </Button>
            </div>
          </Permitido>
        </Card>
      )}

      {c && (!c.conectada || trocando) && c.disponivel && (
        <Permitido chave="cobranca-asaas.editar">
          <FormConectar
            trocando={trocando}
            onPronto={async (r) => {
              setTrocando(false);
              await atualizar(r);
            }}
            onVoltar={trocando ? () => setTrocando(false) : undefined}
          />
        </Permitido>
      )}

      {c && !c.conectada && (
        <Card className="space-y-2 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Como funciona</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>No Asaas, abra Integrações → Chaves de API e gere uma chave.</li>
            <li>Cole a chave aqui. O sistema confere no Asaas de quem é a conta antes de guardar.</li>
            <li>
              Em Contas a pagar e receber → A receber, cada parcela ganha o botão “Gerar boleto/Pix”. O cliente escolhe
              como pagar na página do Asaas.
            </li>
            <li>Quando ele paga, o título recebe a baixa sozinho e você é avisado no sininho.</li>
          </ol>
          <p>O dinheiro cai direto na sua conta Asaas — a Movatruck não passa a mão nele.</p>
        </Card>
      )}
    </div>
  );
}

function FormConectar({
  trocando,
  onPronto,
  onVoltar,
}: {
  trocando: boolean;
  onPronto: (r: ConexaoAsaasResumo) => void | Promise<void>;
  onVoltar?: () => void;
}) {
  const token = useAuthToken();
  const [chave, setChave] = React.useState("");
  const [ambienteEscolhido, setAmbienteEscolhido] = React.useState<AmbienteAsaasTipo | "">("");
  const [ocupado, setOcupado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const pelaChave = chave.trim() ? detectarAmbienteAsaas(chave) : null;
  const precisaEscolher = chave.trim().length > 0 && !pelaChave;

  async function conectar() {
    if (!token) return;
    if (chave.trim().length < 20) return setErro("Cole a chave inteira, começando por $aact_.");
    if (precisaEscolher && !ambienteEscolhido) return setErro("Escolha se a chave é de teste ou de produção.");
    setErro(null);
    setOcupado(true);
    try {
      const r = await fetchApi<ConexaoAsaasResumo>("/admin/cobranca-asaas/conexao", {
        token,
        method: "POST",
        body: JSON.stringify({ chave: chave.trim(), ...(precisaEscolher ? { ambiente: ambienteEscolhido } : {}) }),
      });
      setChave("");
      toast.success(r.nomeContaAsaas ? `Conectado à conta ${r.nomeContaAsaas}.` : "Conta Asaas conectada.");
      await onPronto(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-2">
        <PlugZap className="h-5 w-5 text-blue-600" />
        <p className="font-medium">{trocando ? "Colar a chave nova" : "Conectar a sua conta Asaas"}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="asaas-chave">Chave de API do Asaas</Label>
        <Input
          id="asaas-chave"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="$aact_prod_…"
          value={chave}
          onChange={(e) => setChave(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {pelaChave
            ? `Chave de ${AMBIENTE_ASAAS_LABEL[pelaChave].toLowerCase()}.`
            : "Fica guardada cifrada. Depois de salva, ninguém consegue ver a chave de novo — só o final dela."}
        </p>
      </div>

      {precisaEscolher && (
        <div className="space-y-1.5">
          <Label htmlFor="asaas-ambiente">Essa chave é de qual ambiente?</Label>
          <select
            id="asaas-ambiente"
            className="h-10 w-full max-w-xs rounded-md border bg-background px-3 text-sm"
            value={ambienteEscolhido}
            onChange={(e) => setAmbienteEscolhido(e.target.value as AmbienteAsaasTipo | "")}
          >
            <option value="">Escolha…</option>
            <option value="PRODUCAO">{AMBIENTE_ASAAS_LABEL.PRODUCAO}</option>
            <option value="SANDBOX">{AMBIENTE_ASAAS_LABEL.SANDBOX}</option>
          </select>
        </div>
      )}

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <div className="flex flex-wrap gap-2">
        {onVoltar && (
          <Button variant="outline" onClick={onVoltar} disabled={ocupado}>
            Voltar
          </Button>
        )}
        <Button variant="success" onClick={() => void conectar()} disabled={ocupado}>
          {ocupado ? "Conferindo no Asaas…" : "Testar e conectar"}
        </Button>
      </div>
    </Card>
  );
}
