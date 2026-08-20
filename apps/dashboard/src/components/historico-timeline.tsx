"use client";

import {
  CheckCircle2,
  Ban,
  Clock,
  Edit3,
  History,
  Image as ImageIcon,
  MessageCircle,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fmtBR, fmtDataHoraBR } from "@/lib/fechamento-helpers";
import type { AuditEntry } from "@/lib/fechamentos-api";

/**
 * Timeline de eventos de auditoria. Aceita entries no formato AuditEntry
 * (compartilhado entre viagens, abastecimentos, etc). Mostra label, badge
 * do campo, antes/depois diff, motivo, e quem fez.
 */
export function HistoricoTimeline({
  entries,
  loading,
  labelForCampo,
  emptyMsg = "Sem eventos ainda.",
}: {
  entries: AuditEntry[] | undefined;
  loading?: boolean;
  /** Override do label do campo (ex: campos de abastecimento). Default usa o próprio nome. */
  labelForCampo?: (campo: string) => string;
  emptyMsg?: string;
}) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-base font-medium">
        <History className="mr-2 inline h-4 w-4" />
        Linha do tempo
      </h3>
      {loading && <p className="text-sm">Carregando…</p>}
      {entries?.length === 0 && (
        <p className="text-sm text-muted-foreground">{emptyMsg}</p>
      )}
      <ol className="relative space-y-4 border-l border-border pl-6">
        {entries?.map((ev) => {
          const Icon = iconForAcao(ev.acao);
          return (
            <li key={ev.id} className="relative">
              <span
                className={`absolute -left-[27px] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background ${colorForAcao(ev.acao)}`}
              >
                <Icon className="h-3 w-3 text-white" />
              </span>
              <div className="rounded-md border bg-background p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{labelForAcao(ev.acao)}</span>
                  {ev.campo && (
                    <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                      {labelForCampo ? labelForCampo(ev.campo) : ev.campo}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtDataHoraBR(ev.criadoEm)}
                  </span>
                </div>
                {(ev.usuario?.nome ??
                  (ev.metadata as { motoristaNome?: string } | null)?.motoristaNome) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <UserIcon className="mr-1 inline h-3 w-3" />
                    {ev.usuario?.nome ??
                      (ev.metadata as { motoristaNome?: string } | null)?.motoristaNome}
                  </p>
                )}
                {ev.motivo && <p className="mt-2 text-sm">{ev.motivo}</p>}
                {(ev.valorAntes !== null || ev.valorDepois !== null) && (
                  <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                    {ev.valorAntes !== null && ev.valorAntes !== undefined && (
                      <div className="rounded bg-red-50 p-2 text-red-900">
                        <p className="font-medium">Antes</p>
                        <pre className="whitespace-pre-wrap break-words font-mono">
                          {formatVal(ev.valorAntes)}
                        </pre>
                      </div>
                    )}
                    {ev.valorDepois !== null && ev.valorDepois !== undefined && (
                      <div className="rounded bg-green-50 p-2 text-green-900">
                        <p className="font-medium">Depois</p>
                        <pre className="whitespace-pre-wrap break-words font-mono">
                          {formatVal(ev.valorDepois)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function labelForAcao(acao: string): string {
  return (
    {
      UPDATE: "Atualização",
      DELETE: "Remoção",
      RESOLVER: "Resolução manual",
      SUBSTITUIR: "Substituição",
      EXPORTAR: "Exportação",
      MARCAR_ENVIADO: "Marcado como enviado",
      MATCH_AUTOMATICO: "Match automático",
      MATCH_IA: "Match via IA",
      RECALCULAR_TRAJETO: "Recálculo de trajeto",
      ADMIN_ALTEROU_KM: "Conferente alterou o km",
      MOTORISTA_AJUSTOU_KM: "Motorista ajustou o km",
      PRE_VALIDAR_VIAGEM: "Pré-validação manual",
      ADICIONAR_FOTO: "Foto anexada",
      COMPARTILHAR_VIAGEM: "Link de comprovante gerado",
      REVOGAR_COMPARTILHAMENTO: "Link de comprovante revogado",
      ENVIAR_COMPARTILHAMENTO: "Comprovante enviado no WhatsApp",
    } as const
  )[acao as never] ?? acao;
}

function iconForAcao(acao: string) {
  if (acao === "MATCH_IA") return Sparkles;
  if (acao === "MATCH_AUTOMATICO" || acao === "RESOLVER") return CheckCircle2;
  if (acao === "UPDATE" || acao === "MOTORISTA_AJUSTOU_KM") return Edit3;
  if (acao === "RECALCULAR_TRAJETO") return RefreshCw;
  if (acao === "PRE_VALIDAR_VIAGEM") return ShieldCheck;
  if (acao === "ADICIONAR_FOTO") return ImageIcon;
  if (acao === "COMPARTILHAR_VIAGEM") return Share2;
  if (acao === "REVOGAR_COMPARTILHAMENTO") return Ban;
  if (acao === "ENVIAR_COMPARTILHAMENTO") return MessageCircle;
  return Clock;
}

function colorForAcao(acao: string): string {
  if (acao === "MATCH_IA") return "bg-emerald-500";
  if (acao === "MATCH_AUTOMATICO") return "bg-green-500";
  if (acao === "RESOLVER") return "bg-blue-500";
  if (acao === "UPDATE") return "bg-orange-500";
  if (acao === "EXPORTAR" || acao === "MARCAR_ENVIADO") return "bg-purple-500";
  if (acao === "RECALCULAR_TRAJETO") return "bg-cyan-500";
  if (acao === "MOTORISTA_AJUSTOU_KM") return "bg-amber-500";
  if (acao === "PRE_VALIDAR_VIAGEM") return "bg-indigo-500";
  if (acao === "ADICIONAR_FOTO") return "bg-sky-500";
  if (acao === "COMPARTILHAR_VIAGEM") return "bg-teal-500";
  if (acao === "REVOGAR_COMPARTILHAMENTO") return "bg-rose-500";
  if (acao === "ENVIAR_COMPARTILHAMENTO") return "bg-lime-600";
  return "bg-gray-500";
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (
    typeof v === "object" &&
    v !== null &&
    "nome" in v &&
    typeof (v as { nome: unknown }).nome === "string"
  ) {
    return (v as { nome: string }).nome;
  }
  if (
    typeof v === "object" &&
    v !== null &&
    "placa" in v &&
    typeof (v as { placa: unknown }).placa === "string"
  ) {
    return (v as { placa: string }).placa;
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const formatted = fmtBR(v);
      if (formatted !== "—") return formatted;
    }
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v, null, 2);
}
