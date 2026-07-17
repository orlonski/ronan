"use client";

import { AlertTriangle, CheckCircle2, History, Info, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Permitido } from "@/components/requer-tela";
import { fmtBR, fmtNum } from "@/lib/fechamento-helpers";

type EstatisticaPar = {
  mediana: number;
  amostra: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

export type ReferenciaKmDetalhe = {
  baseConsistente: boolean;
  motivoInconsistencia: string | null;
  estaViagem: {
    km: number | null;
    kmCalculado: number | null;
    kmFonte: string | null;
    temTrechos: boolean;
  };
  historico: EstatisticaPar | null;
  osrm: { km: number } | null;
  efetiva: { km: number; fonte: "HISTORICO" | "ROTA_OSRM" } | null;
  carimbo: {
    kmForaDoPadrao: boolean | null;
    kmReferencia: number | null;
    kmReferenciaFonte: string | null;
    kmReferenciaAmostra: number | null;
    kmDesvioPct: number | null;
    kmAvaliadoEm: string | null;
    justificativaKm: string | null;
  };
  comparaveis: Array<{
    id: string;
    data: string | null;
    km: number;
    motoristaNome: string | null;
  }>;
  quarentena: number;
  config: {
    ativo: boolean;
    amostraMinima: number;
    desvioPct: number;
    desvioPctOsrm: number;
  };
};

function km(n: number | null | undefined): string {
  return n == null ? "—" : `${fmtNum(n, 1)} km`;
}

/**
 * Card "Km do trajeto" no detalhe da viagem. Mostra o histórico do par
 * carga→descarga (mediana das viagens da frota) e a rota calculada lado a lado,
 * e — se o backend carimbou — o desvio + a justificativa do motorista.
 *
 * RECUSA base inconsistente: quando o km da viagem não descreve o par atual
 * (troca de local sem recálculo), não exibe número nenhum — só a explicação.
 * É o requisito que derrubou o card de bota-fora (b729175) aplicado de novo.
 */
export function ReferenciaKmCard({
  data,
  loading,
  onAceitarKm,
  aceitando,
}: {
  data: ReferenciaKmDetalhe | undefined;
  loading: boolean;
  onAceitarKm: () => void;
  aceitando: boolean;
}) {
  if (loading || !data) {
    return (
      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
          <Route className="h-4 w-4" /> Km do trajeto
        </h3>
        <p className="text-sm text-muted-foreground">
          {loading ? "Carregando referência…" : "Sem referência."}
        </p>
      </Card>
    );
  }

  const { estaViagem, historico, osrm, efetiva, carimbo, config } = data;
  const kmViagem = estaViagem.km;
  const foraDoPadrao = carimbo.kmForaDoPadrao === true;
  const amostraOk = !!historico && historico.amostra >= config.amostraMinima;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-medium">
          <Route className="h-4 w-4" /> Km do trajeto
        </h3>
        {foraDoPadrao && (
          <Badge className="border-amber-300 bg-amber-100 text-amber-800">
            <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Km atípico
          </Badge>
        )}
      </div>

      {!data.baseConsistente ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{data.motivoInconsistencia ?? "Não dá pra comparar esta viagem."}</p>
        </div>
      ) : (
        <>
          {/* Duas referências lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <div
              className={`rounded-md border p-3 ${
                amostraOk ? "border-border" : "border-dashed border-muted-foreground/30 opacity-70"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Histórico do trajeto
              </div>
              {historico ? (
                <>
                  <p className="text-lg font-semibold">{km(historico.mediana)}</p>
                  <p className="text-xs text-muted-foreground">
                    {amostraOk
                      ? `${historico.amostra} viagens · faixa ${fmtNum(historico.p25, 0)}–${fmtNum(historico.p75, 0)}`
                      : `só ${historico.amostra} de ${config.amostraMinima} — amostra insuficiente`}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Sem viagens comparáveis ainda.</p>
              )}
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Route className="h-3.5 w-3.5" /> Rota calculada
              </div>
              {osrm ? (
                <>
                  <p className="text-lg font-semibold">{km(osrm.km)}</p>
                  <p className="text-xs text-muted-foreground">estimativa do roteador</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Não foi possível calcular.</p>
              )}
            </div>
          </div>

          {/* Esta viagem + desvio */}
          <div className="mt-3 flex items-baseline justify-between gap-2 border-t pt-3">
            <span className="text-sm text-muted-foreground">Esta viagem</span>
            <div className="text-right">
              <span className={`text-lg font-semibold ${foraDoPadrao ? "text-amber-700" : ""}`}>
                {km(kmViagem)}
              </span>
              {carimbo.kmDesvioPct != null && efetiva && (
                <p className="text-xs text-muted-foreground">
                  {carimbo.kmDesvioPct >= 0 ? "+" : ""}
                  {fmtNum(carimbo.kmDesvioPct, 0)}% vs.{" "}
                  {carimbo.kmReferenciaFonte === "HISTORICO" ? "histórico" : "rota calculada"}
                </p>
              )}
            </div>
          </div>

          {/* Justificativa do motorista (o que o admin quer ler) */}
          {carimbo.justificativaKm && (
            <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Justificativa do motorista
              </p>
              <p className="text-sm">{carimbo.justificativaKm}</p>
            </div>
          )}
          {foraDoPadrao && !carimbo.justificativaKm && (
            <p className="mt-3 text-xs text-muted-foreground">
              Sem justificativa (lançada offline, app antigo ou fora do teste).
            </p>
          )}

          {/* Quarentena: sinal de que a mediana pode ter envelhecido */}
          {data.quarentena > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {data.quarentena} viagem(ns) deste trajeto em revisão (fora da média até
              alguém aceitar o km).
            </p>
          )}

          {/* Aceitar km — readmite na média */}
          {foraDoPadrao && (
            <Permitido chave="viagens.editar">
              <div className="mt-3 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAceitarKm}
                  disabled={aceitando}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {aceitando ? "Aceitando…" : "Aceitar km (está certo)"}
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Confirma que este km está correto e devolve a viagem pra referência do
                  trajeto.
                </p>
              </div>
            </Permitido>
          )}

          {/* Comparáveis recentes */}
          {data.comparaveis.length > 0 && (
            <details className="mt-3 border-t pt-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Ver {data.comparaveis.length} viagens comparáveis
              </summary>
              <ul className="mt-2 space-y-1">
                {data.comparaveis.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {fmtBR(c.data)} · {c.motoristaNome ?? "—"}
                    </span>
                    <span className="font-medium">{km(c.km)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
