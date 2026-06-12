"use client";

import { Smartphone } from "lucide-react";

/** Campos de versão do app que o backend expõe em cada motorista. */
export type AppVersaoInfo = {
  appVersion: string | null;
  appUpdateId: string | null;
  appBuiltAt: string | null;
  appCanal: string | null;
  appVistoEm: string | null;
};

type Status = "atualizado" | "desatualizado" | "sem-dados";

function resolverStatus(m: AppVersaoInfo, latestUpdateId: string | null): Status {
  if (!m.appVistoEm) return "sem-dados";
  // Auto-calibrado: "atualizado" = roda o mesmo bundle OTA mais novo visto
  // entre todos os motoristas. (Se ninguém reportou updateId ainda, latest é
  // null e quem também não tem updateId casa como atualizado.)
  return m.appUpdateId === latestUpdateId ? "atualizado" : "desatualizado";
}

function tempoRelativo(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  const meses = Math.floor(d / 30);
  return `há ${meses} ${meses > 1 ? "meses" : "mês"}`;
}

function dataCurta(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}

const DOT: Record<Status, string> = {
  atualizado: "bg-green-500",
  desatualizado: "bg-amber-500",
  "sem-dados": "bg-muted-foreground/40",
};

const ROTULO: Record<Status, string> = {
  atualizado: "Atualizado",
  desatualizado: "Desatualizado",
  "sem-dados": "Sem dados",
};

/**
 * Badge compacto pra lista: bolinha de status + versão + "visto há X".
 * Tooltip traz o detalhe completo (data do código, canal).
 */
export function AppVersaoCell({
  motorista,
  latestUpdateId,
}: {
  motorista: AppVersaoInfo;
  latestUpdateId: string | null;
}) {
  const status = resolverStatus(motorista, latestUpdateId);
  if (status === "sem-dados") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const codigo = dataCurta(motorista.appBuiltAt);
  const title = [
    motorista.appVersion ? `Versão ${motorista.appVersion}` : null,
    codigo ? `Código de ${codigo}` : null,
    motorista.appCanal ? `Canal ${motorista.appCanal}` : null,
    `Visto ${tempoRelativo(motorista.appVistoEm)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-2" title={title}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />
      <div className="min-w-0 leading-tight">
        <div className="text-xs font-medium">
          {motorista.appVersion ?? "?"}
          {codigo && (
            <span className="font-normal text-muted-foreground"> · {codigo}</span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {tempoRelativo(motorista.appVistoEm)}
        </div>
      </div>
    </div>
  );
}

/**
 * Bloco maior pra página de detalhe do motorista.
 */
export function AppVersaoCard({
  motorista,
  latestUpdateId,
}: {
  motorista: AppVersaoInfo;
  latestUpdateId: string | null;
}) {
  const status = resolverStatus(motorista, latestUpdateId);
  const codigo = motorista.appBuiltAt
    ? new Date(motorista.appBuiltAt).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Versão do app</h3>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            status === "atualizado"
              ? "bg-green-100 text-green-700"
              : status === "desatualizado"
                ? "bg-amber-100 text-amber-700"
                : "bg-muted text-muted-foreground"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
          {ROTULO[status]}
        </span>
      </div>

      {status === "sem-dados" ? (
        <p className="text-sm text-muted-foreground">
          Este motorista ainda não abriu o app com a versão que reporta dados.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Versão</dt>
          <dd className="font-medium">{motorista.appVersion ?? "—"}</dd>

          <dt className="text-muted-foreground">Código de</dt>
          <dd className="font-medium">{codigo ?? "—"}</dd>

          <dt className="text-muted-foreground">Canal</dt>
          <dd className="font-medium">{motorista.appCanal ?? "—"}</dd>

          <dt className="text-muted-foreground">Visto online</dt>
          <dd className="font-medium">{tempoRelativo(motorista.appVistoEm)}</dd>
        </dl>
      )}
    </div>
  );
}
