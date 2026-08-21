"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { MapaTrajetoViagem, type Ponto } from "@/components/mapa-trajeto-viagem";

type RotaOpcao = {
  km: string;
  duracaoSegundos: number;
  geometria: string | null;
  recomendada: boolean;
  emVigor: boolean;
};

type RotasResposta = {
  rotas: RotaOpcao[];
  erro?: string;
  kmAtual: string | null;
  kmMotorista: string | null;
  kmFonte: string | null;
  kmDigitadoPeloMotorista: boolean;
  emFechamento: boolean;
};

// Mesma paleta do seletor no app do motorista — quem confere no painel vê a
// estrada com a cor que o motorista viu na tela dele.
const CORES = ["#ea580c", "#2563eb", "#16a34a"];

function fmtKm(km: string): string {
  return km.replace(".", ",");
}

/**
 * Registra, pelo painel, por qual estrada o motorista foi.
 *
 * Existe porque muita viagem foi lançada quando a tela do app oferecia uma
 * opção só — o motorista nunca teve o que escolher. Corrigir isso não pode
 * virar tarefa dele: quem opera a plataforma acerta o registro depois, com
 * calma, vendo as mesmas estradas que apareceram (ou deveriam ter aparecido)
 * pra ele.
 *
 * O traçado sempre muda. O km só acompanha se quem está corrigindo pedir e
 * escrever o porquê — o km do motorista continua sendo lei.
 */
export function EscolherRotaModal({
  viagemId,
  carga,
  descarga,
}: {
  viagemId: string;
  carga: Ponto | null;
  descarga: Ponto | null;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [atualizarKm, setAtualizarKm] = useState(false);
  const [motivo, setMotivo] = useState("");

  const dados = useQuery({
    queryKey: ["viagem-rotas", viagemId],
    enabled: !!token && aberto,
    staleTime: 60_000,
    queryFn: () => fetchApi<RotasResposta>(`/admin/viagens/${viagemId}/rotas`, { token }),
  });

  // Abre já apontando pra estrada que está registrada hoje — se for uma das
  // opções. Não havendo, abre sem nada marcado: a viagem é antiga e ninguém
  // escolheu nada ainda, então o painel também não deve escolher sozinho.
  useEffect(() => {
    if (!aberto || !dados.data) return;
    setEscolhida(dados.data.rotas.find((r) => r.emVigor)?.geometria ?? null);
  }, [aberto, dados.data]);

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi(`/admin/viagens/${viagemId}/rota`, {
        token,
        method: "POST",
        body: JSON.stringify({
          geometria: escolhida,
          atualizarKm,
          motivo: atualizarKm ? motivo.trim() : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Estrada registrada. O motorista foi avisado na conversa.");
      void qc.invalidateQueries({ queryKey: ["viagem", viagemId] });
      void qc.invalidateQueries({ queryKey: ["viagem-historico", viagemId] });
      void qc.invalidateQueries({ queryKey: ["viagem-mensagens", viagemId] });
      void qc.invalidateQueries({ queryKey: ["viagem-rotas", viagemId] });
      setAberto(false);
      setAtualizarKm(false);
      setMotivo("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotas = dados.data?.rotas ?? [];
  const opcaoEscolhida = rotas.find((r) => r.geometria === escolhida);
  const mudouEstrada = !!opcaoEscolhida && !opcaoEscolhida.emVigor;
  const motivoFalta = atualizarKm && motivo.trim().length < 10;
  const emFechamento = dados.data?.emFechamento === true;
  const nadaAMudar = !!opcaoEscolhida && !mudouEstrada && !atualizarKm;

  const mapaGeometria = useMemo(
    () => opcaoEscolhida?.geometria ?? null,
    [opcaoEscolhida],
  );

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Registrar por qual estrada o motorista foi">
          <Route className="h-4 w-4" />
          Escolher a estrada
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Por qual estrada o motorista foi?</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Estas são as estradas possíveis deste trecho, calculadas agora. A lista que
          apareceu pro motorista no dia do lançamento não fica guardada — e por muito
          tempo a tela dele oferecia uma opção só.
        </p>

        {dados.isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Calculando as estradas…
          </p>
        )}

        {dados.data?.erro && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{dados.data.erro}</p>
          </div>
        )}

        {emFechamento && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Viagem já vinculada a um fechamento. Desfaça o match antes de mexer no
              trajeto.
            </p>
          </div>
        )}

        {rotas.length > 0 && (
          <>
            <MapaTrajetoViagem
              carga={carga}
              descarga={descarga}
              lancamento={null}
              geometria={mapaGeometria}
            />

            <div className="space-y-2">
              {rotas.map((r, idx) => {
                const cor = CORES[idx % CORES.length]!;
                const sel = r.geometria === escolhida;
                const min = Math.round(r.duracaoSegundos / 60);
                return (
                  <button
                    key={r.geometria ?? idx}
                    type="button"
                    onClick={() => setEscolhida(r.geometria)}
                    className="flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors hover:bg-muted/40"
                    style={{
                      borderColor: sel ? cor : "#e2e8f0",
                      backgroundColor: sel ? `${cor}12` : "transparent",
                    }}
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cor }}
                    />
                    <span className="flex-1">
                      <span className="text-base font-semibold">{fmtKm(r.km)} km</span>
                      <span className="text-sm font-normal text-muted-foreground">
                        {"  ·  "}
                        {min} min
                      </span>
                      {r.emVigor && (
                        <span className="ml-2 text-xs font-medium text-muted-foreground">
                          registrada nesta viagem
                        </span>
                      )}
                    </span>
                    {sel && <Check className="h-5 w-5 shrink-0" style={{ color: cor }} />}
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border bg-muted/20 p-3">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={atualizarKm}
                  onChange={(e) => setAtualizarKm(e.target.checked)}
                />
                <span className="text-sm">
                  <span className="font-medium">
                    Atualizar também o km faturado
                    {opcaoEscolhida ? ` para ${fmtKm(opcaoEscolhida.km)} km` : ""}
                  </span>
                  <span className="block text-muted-foreground">
                    Deixando desmarcado, só o traçado do mapa muda. O km faturado
                    {dados.data?.kmAtual ? ` (${fmtKm(dados.data.kmAtual)} km)` : ""} fica
                    como está.
                  </span>
                </span>
              </label>

              {atualizarKm && (
                <div className="mt-3 space-y-2">
                  {dados.data?.kmDigitadoPeloMotorista && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p>
                        Atenção: o km desta viagem foi digitado à mão pelo motorista
                        {dados.data?.kmMotorista
                          ? ` (${fmtKm(dados.data.kmMotorista)} km)`
                          : ""}
                        . Ele estava na estrada — confirme com ele antes de passar por
                        cima.
                      </p>
                    </div>
                  )}
                  <Textarea
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Por que o km está mudando? Ex.: motorista confirmou por telefone que pegou a BR-277."
                  />
                  <p className="text-xs text-muted-foreground">
                    O motivo fica no histórico e aparece pro motorista na conversa da
                    viagem. Mínimo 10 caracteres.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={
              !escolhida ||
              emFechamento ||
              motivoFalta ||
              nadaAMudar ||
              salvar.isPending
            }
          >
            {salvar.isPending ? "Registrando…" : "Registrar estrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
