"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, CircleAlert, FileCheck2, FlaskConical } from "lucide-react";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { BotaoDacte } from "@/components/botao-dacte";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { useConfirm } from "@/components/confirm-dialog";

type Achado = { campo: string; mensagem: string };

type Previa = {
  validacao: { ok: boolean; erros: Achado[]; avisos: Achado[] };
  /** Erros de LEIAUTE, do XSD oficial da SEFAZ. Diferente das regras acima. */
  leiaute: { mensagem: string; linha?: number }[];
  numeroPrevisto: number;
  ambiente: number;
  emissor: string;
};

type Documento = {
  id: string;
  serie: number;
  numero: number;
  chave: string;
  ambiente: number;
  emissor: string;
  status: "RASCUNHO" | "ENVIADO" | "AUTORIZADO" | "REJEITADO" | "CANCELADO" | "ERRO";
  protocolo: string | null;
  autorizadoEm: string | null;
  codigoRetorno: string | null;
  motivo: string | null;
};

/**
 * O CT-e desta viagem.
 *
 * A prévia roda SEMPRE que o painel abre, e é ela que mostra o que falta antes
 * de alguém apertar o botão — descobrir pendência de cadastro por rejeição da
 * SEFAZ custa um número da série e uma ida ao contador.
 */
export function PainelCte({ viagemId }: { viagemId: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [emitindo, setEmitindo] = React.useState(false);
  const { confirmar, ConfirmDialog } = useConfirm();
  const [cancelando, setCancelando] = React.useState(false);
  const [justificativa, setJustificativa] = React.useState("");
  const [abrirCancelar, setAbrirCancelar] = React.useState(false);

  const docs = useQuery({
    queryKey: ["cte", "viagem", viagemId],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Documento[]>(`/admin/cte?viagemId=${viagemId}`, { token: token! }),
  });

  const vivo = (docs.data ?? []).find((d) =>
    ["AUTORIZADO", "ENVIADO"].includes(d.status),
  );
  const ultimo = (docs.data ?? [])[0] ?? null;

  const previa = useQuery({
    queryKey: ["cte", "previa", viagemId],
    // Só vale calcular a prévia quando não há CT-e vivo: com um autorizado, o
    // que importa é o documento, não o que ele seria.
    enabled: Boolean(token) && !vivo,
    retry: false,
    queryFn: () => fetchApi<Previa>(`/admin/cte/previa/${viagemId}`, { token: token! }),
  });

  async function emitir() {
    if (!token) return;
    // Em produção o CT-e é documento fiscal válido e o número não volta — o
    // próprio painel já diz isso num <span> ao lado do botão, mas texto ao lado
    // de um botão verde não é barreira nenhuma. Em homologação e no simulador
    // segue direto: ali errar não custa.
    const producao = previa.data?.emissor !== "SIMULADOR" && previa.data?.ambiente === 1;
    if (producao) {
      const ok = await confirmar({
        variant: "warning",
        title: `Emitir o CT-e nº ${previa.data?.numeroPrevisto} na SEFAZ?`,
        description:
          "É documento fiscal de verdade. Se estiver errado, só dá pra cancelar dentro do prazo legal — e esse número não volta.",
        confirmLabel: "Emitir na SEFAZ",
        cancelLabel: "Revisar antes",
      });
      if (!ok) return;
    }
    setEmitindo(true);
    try {
      const r = await fetchApi<{ documento: Documento; avisos: Achado[] }>(
        `/admin/cte/emitir/${viagemId}`,
        { token, method: "POST" },
      );
      if (r.documento.status === "AUTORIZADO") toast.success(`CT-e ${r.documento.numero} autorizado.`);
      else toast.error(r.documento.motivo ?? "O CT-e não foi autorizado.");
      await qc.invalidateQueries({ queryKey: ["cte"] });
      await qc.invalidateQueries({ queryKey: ["viagem", viagemId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEmitindo(false);
    }
  }

  async function cancelar() {
    if (!token || !vivo) return;
    setCancelando(true);
    try {
      await fetchApi(`/admin/cte/${vivo.id}/cancelar`, {
        token,
        method: "POST",
        body: JSON.stringify({ justificativa }),
      });
      toast.success("CT-e cancelado.");
      setAbrirCancelar(false);
      setJustificativa("");
      await qc.invalidateQueries({ queryKey: ["cte"] });
      await qc.invalidateQueries({ queryKey: ["viagem", viagemId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelando(false);
    }
  }

  const erroPrevia = previa.error as Error | null;

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <ConfirmDialog />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-medium">
          <FileCheck2 className="h-4 w-4" />
          CT-e
        </h3>
        {/* O emissor é outra tela, com chave própria (config-cte). */}
        <Permitido chave="config-cte.ver">
          <Link href="/configuracoes/cte" className="text-xs text-muted-foreground underline">
            Configuração
          </Link>
        </Permitido>
      </div>

      {/* --- já tem documento --- */}
      {vivo && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-transparent bg-emerald-100 text-emerald-800">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Nº {vivo.numero} · série {vivo.serie}
            </Badge>
            {vivo.emissor === "SIMULADOR" && (
              <Badge className="border-transparent bg-purple-100 text-purple-800">
                <FlaskConical className="mr-1 h-3 w-3" />
                Simulado
              </Badge>
            )}
            {vivo.ambiente === 2 && (
              <Badge className="border-transparent bg-slate-100 text-slate-600">Homologação</Badge>
            )}
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">{vivo.chave}</p>
          {vivo.protocolo && (
            <p className="text-sm text-muted-foreground">Protocolo {vivo.protocolo}</p>
          )}

          {/* O papel que vai com o caminhão. Fica aqui, na viagem, porque é
              daqui que alguém imprime — não da tela de auditoria de CT-e. */}
          <BotaoDacte id={vivo.id} rotulo="Imprimir DACTE" />

          <Permitido chave="cte.cancelar">
            {!abrirCancelar ? (
              <Button size="sm" variant="outline" onClick={() => setAbrirCancelar(true)}>
                <Ban className="h-3.5 w-3.5" /> Cancelar CT-e
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label htmlFor="just">Por que está cancelando</Label>
                <Input
                  id="just"
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Mínimo de 15 letras — a SEFAZ exige"
                  maxLength={255}
                />
                <p className="text-xs text-muted-foreground">
                  {justificativa.trim().length}/15 · o cancelamento é registrado na SEFAZ e
                  tem prazo legal.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={justificativa.trim().length < 15 || cancelando}
                    onClick={() => void cancelar()}
                  >
                    {cancelando ? "Cancelando…" : "Confirmar cancelamento"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAbrirCancelar(false)}>
                    Voltar
                  </Button>
                </div>
              </div>
            )}
          </Permitido>
        </div>
      )}

      {/* --- última tentativa que não deu certo --- */}
      {!vivo && ultimo && ["REJEITADO", "ERRO"].includes(ultimo.status) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            Tentativa {ultimo.numero} não passou
          </p>
          <p className="mt-1 text-sm text-destructive">
            {ultimo.codigoRetorno ? `${ultimo.codigoRetorno} — ` : ""}
            {ultimo.motivo}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Corrija o que a mensagem aponta e emita de novo. O número {ultimo.numero} fica
            registrado como tentativa — a numeração segue do próximo.
          </p>
        </div>
      )}

      {/* --- pendências antes de emitir --- */}
      {!vivo && erroPrevia && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm">{erroPrevia.message}</p>
        </div>
      )}

      {!vivo && previa.data && !previa.data.validacao.ok && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium">Falta preencher antes de emitir:</p>
          <ul className="ml-5 list-disc space-y-0.5 text-sm text-muted-foreground">
            {previa.data.validacao.erros.map((e, i) => (
              <li key={`${e.campo}-${i}`}>{e.mensagem}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Aviso não trava: o documento sai, e alguém reclama depois. Dizer isso
          antes é o que permite decidir conscientemente. */}
      {/* Leiaute é outra conversa: as regras acima são do negócio (falta o
          CNPJ do destinatário), estas são do documento (o nome passou de 60
          caracteres). Misturar as duas listas faria o usuário procurar no
          cadastro errado. */}
      {!vivo && (previa.data?.leiaute.length ?? 0) > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            O documento não fecha com o leiaute oficial da SEFAZ:
          </p>
          <ul className="ml-5 list-disc space-y-0.5 text-sm text-destructive">
            {previa.data!.leiaute.map((e, i) => (
              <li key={i}>{e.mensagem}</li>
            ))}
          </ul>
        </div>
      )}

      {!vivo && previa.data && previa.data.validacao.avisos.length > 0 && (
        <ul className="ml-5 list-disc space-y-0.5 text-sm text-muted-foreground">
          {previa.data.validacao.avisos.map((a, i) => (
            <li key={`${a.campo}-${i}`}>{a.mensagem}</li>
          ))}
        </ul>
      )}

      {!vivo && previa.data?.validacao.ok && previa.data.leiaute.length === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Permitido chave="cte.emitir">
            <Button
              variant={
                previa.data.emissor !== "SIMULADOR" && previa.data.ambiente === 1
                  ? "warning"
                  : "success"
              }
              disabled={emitindo}
              onClick={() => void emitir()}
            >
              <FileCheck2 className="h-4 w-4" />
              {emitindo ? "Emitindo…" : `Emitir CT-e nº ${previa.data.numeroPrevisto}`}
            </Button>
          </Permitido>
          <span className="text-sm text-muted-foreground">
            {previa.data.emissor === "SIMULADOR"
              ? "Simulador — não vai pra SEFAZ."
              : previa.data.ambiente === 2
                ? "Homologação — sem valor fiscal."
                : "Produção — documento fiscal de verdade."}
          </span>
        </div>
      )}
    </Card>
  );
}
