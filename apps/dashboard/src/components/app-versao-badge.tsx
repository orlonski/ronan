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

export type LatestRef = {
  latestUpdateId: string | null;
  latestBuiltAt: string | null;
  /** true quando a Expo não respondeu e a referência caiu no fallback antigo. */
  degradado?: boolean;
};

// Tolerância de relógio ao comparar a data de publicação do bundle (1 min).
const TOL_MS = 60_000;

function resolverStatus(m: AppVersaoInfo, latest: LatestRef): Status {
  if (!m.appVistoEm) return "sem-dados";
  // Reporta versão mas sem data do bundle (ex.: dev build sem OTA) — não dá pra
  // afirmar se está atualizado.
  if (!m.appBuiltAt) return "sem-dados";
  if (latest.latestBuiltAt) {
    // Autoritativo (referência vinda do servidor de OTA da Expo): atualizado =
    // roda o último bundle publicado (ou mais novo). Compara por data de publish,
    // que é idêntica entre iOS/Android pro mesmo update.
    return new Date(m.appBuiltAt).getTime() >= new Date(latest.latestBuiltAt).getTime() - TOL_MS
      ? "atualizado"
      : "desatualizado";
  }
  // Fallback (Expo indisponível): compara pelo bundle mais novo visto entre os
  // motoristas.
  return m.appUpdateId != null && m.appUpdateId === latest.latestUpdateId
    ? "atualizado"
    : "desatualizado";
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
  latest,
}: {
  motorista: AppVersaoInfo;
  latest: LatestRef;
}) {
  const status = resolverStatus(motorista, latest);
  if (status === "sem-dados") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const codigo = dataCurta(motorista.appBuiltAt);
  const ultimaPublicada = dataCurta(latest.latestBuiltAt);
  const title = [
    motorista.appVersion ? `Versão ${motorista.appVersion}` : null,
    codigo ? `Código de ${codigo}` : null,
    status === "desatualizado" && ultimaPublicada ? `Última versão de ${ultimaPublicada}` : null,
    motorista.appCanal ? `Canal ${motorista.appCanal}` : null,
    `Visto ${tempoRelativo(motorista.appVistoEm)}`,
    latest.degradado ? "Referência aproximada (Expo indisponível)" : null,
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
  latest,
}: {
  motorista: AppVersaoInfo;
  latest: LatestRef;
}) {
  const status = resolverStatus(motorista, latest);
  const fmtBundle = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const codigo = fmtBundle(motorista.appBuiltAt);
  const ultimaPublicada = fmtBundle(latest.latestBuiltAt);

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

          {status === "desatualizado" && ultimaPublicada && (
            <>
              <dt className="text-muted-foreground">Última publicada</dt>
              <dd className="font-medium">{ultimaPublicada}</dd>
            </>
          )}
        </dl>
      )}

      {latest.degradado && (
        <p className="mt-3 text-xs text-amber-600">
          Referência aproximada — não consegui confirmar o último OTA com a Expo agora.
        </p>
      )}
    </div>
  );
}
