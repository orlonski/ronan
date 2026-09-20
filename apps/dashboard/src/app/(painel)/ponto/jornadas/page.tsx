"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus } from "lucide-react";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { duracao, PATH, PrecisaFundamento, useConfigPonto } from "../_lib";

const NOMES_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type DiaModelo = {
  posicao: number;
  trabalha: boolean;
  entrada: string | null;
  saida: string | null;
  intervaloMin: number;
  cargaMin: number;
};

type Modelo = {
  id: string;
  nome: string;
  tipo: "SEMANAL" | "CICLO";
  cicloDias: number | null;
  ancoraCiclo: string | null;
  toleranciaPorMarcacaoMin: number;
  toleranciaDiariaMin: number;
  intervaloMinimoMin: number;
  preAssinalacaoIntervalo: boolean;
  preAssinalacaoMinutos: number | null;
  maxDirecaoContinuaMin: number | null;
  dias: DiaModelo[];
};

/**
 * JORNADAS E ESCALAS: a carga horária que a empresa define.
 *
 * Sem jornada não existe previsto, e sem previsto não existe saldo — é por
 * isso que a tela de fechamento trava em quem está sem.
 */
export default function JornadasPage() {
  return (
    <RequerTela chave="jornadas.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const [editando, setEditando] = useState<Modelo | "novo" | null>(null);
  const config = useConfigPonto();

  const lista = useQuery({
    queryKey: [PATH, "jornadas"],
    enabled: !!token,
    queryFn: () => fetchApi<Modelo[]>(`${PATH}/jornadas`, { token }),
  });

  if (config.data && !config.data.fundamento) return <PrecisaFundamento />;

  const itens = lista.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <CalendarRange className="h-6 w-6 text-muted-foreground" />
            Jornadas e escalas
          </h1>
          <p className="text-sm text-muted-foreground">
            A carga horária de cada dia. É ela que diz o que era esperado.
          </p>
        </div>
        {temPermissao("jornadas.editar") && (
          <Button onClick={() => setEditando("novo")}>
            <Plus className="mr-1 h-4 w-4" /> Nova jornada
          </Button>
        )}
      </div>

      {itens.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma jornada cadastrada"
          descricao="Crie ao menos uma: sem jornada o espelho não tem o que comparar."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {itens.map((m) => (
            <Card key={m.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.tipo === "CICLO" ? `Ciclo de ${m.cicloDias} dias` : "Semanal"} · tolerância{" "}
                    {m.toleranciaPorMarcacaoMin}min por batida, {m.toleranciaDiariaMin}min no dia
                  </p>
                </div>
                {temPermissao("jornadas.editar") && (
                  <Button variant="outline" size="sm" onClick={() => setEditando(m)}>
                    Editar
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {m.dias.map((d) => (
                  <span
                    key={d.posicao}
                    className={`rounded border px-2 py-1 ${d.trabalha ? "" : "text-muted-foreground"}`}
                  >
                    {m.tipo === "CICLO" ? `D${d.posicao + 1}` : NOMES_SEMANA[d.posicao]?.slice(0, 3)}
                    {d.trabalha ? ` ${d.entrada}–${d.saida} (${duracao(d.cargaMin)})` : " folga"}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editando && (
        <DialogJornada modelo={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />
      )}
    </div>
  );
}

function DialogJornada({ modelo, onFechar }: { modelo: Modelo | null; onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();

  const [tipo, setTipo] = useState<"SEMANAL" | "CICLO">(modelo?.tipo ?? "SEMANAL");
  const [nome, setNome] = useState(modelo?.nome ?? "");
  const [cicloDias, setCicloDias] = useState(modelo?.cicloDias ?? 2);
  const [ancoraCiclo, setAncoraCiclo] = useState(modelo?.ancoraCiclo?.slice(0, 10) ?? "");
  const [tolMarcacao, setTolMarcacao] = useState(modelo?.toleranciaPorMarcacaoMin ?? 5);
  const [tolDia, setTolDia] = useState(modelo?.toleranciaDiariaMin ?? 10);
  const [intervaloMinimo, setIntervaloMinimo] = useState(modelo?.intervaloMinimoMin ?? 60);
  const [preAssinala, setPreAssinala] = useState(modelo?.preAssinalacaoIntervalo ?? false);
  const [preMinutos, setPreMinutos] = useState(modelo?.preAssinalacaoMinutos ?? 60);
  const [maxDirecao, setMaxDirecao] = useState(modelo?.maxDirecaoContinuaMin ?? 0);

  const quantos = tipo === "CICLO" ? cicloDias : 7;
  const [dias, setDias] = useState<DiaModelo[]>(() => {
    const base = modelo?.dias ?? [];
    return Array.from({ length: modelo?.tipo === "CICLO" ? (modelo.cicloDias ?? 2) : 7 }, (_, i) => {
      const d = base.find((x) => x.posicao === i);
      return (
        d ?? {
          posicao: i,
          trabalha: i >= 1 && i <= 5,
          entrada: i >= 1 && i <= 5 ? "08:00" : null,
          saida: i >= 1 && i <= 5 ? "17:00" : null,
          intervaloMin: 60,
          cargaMin: 480,
        }
      );
    });
  });

  function ajustar(i: number, patch: Partial<DiaModelo>) {
    setDias((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/jornadas`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          id: modelo?.id,
          nome: nome.trim(),
          tipo,
          cicloDias: tipo === "CICLO" ? cicloDias : undefined,
          ancoraCiclo: tipo === "CICLO" ? ancoraCiclo || undefined : undefined,
          toleranciaPorMarcacaoMin: tolMarcacao,
          toleranciaDiariaMin: tolDia,
          intervaloMinimoMin: intervaloMinimo,
          preAssinalacaoIntervalo: preAssinala,
          preAssinalacaoMinutos: preAssinala ? preMinutos : undefined,
          maxDirecaoContinuaMin: maxDirecao > 0 ? maxDirecao : undefined,
          dias: dias.slice(0, quantos).map((d) => ({
            posicao: d.posicao,
            trabalha: d.trabalha,
            entrada: d.entrada ?? undefined,
            saida: d.saida ?? undefined,
            intervaloMin: d.intervaloMin,
          })),
        }),
      }),
    onSuccess: () => {
      toast.success("Jornada salva.");
      void qc.invalidateQueries({ queryKey: [PATH, "jornadas"] });
      onFechar();
    },
    onError: (e: Error) => toast.error("Não consegui salvar", { description: e.message }),
  });

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{modelo ? "Editar jornada" : "Nova jornada"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="j-nome">Nome</Label>
              <Input
                id="j-nome"
                placeholder="ex: Motorista 8h seg-sex"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="j-tipo">Tipo</Label>
              <Select
                id="j-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "SEMANAL" | "CICLO")}
              >
                <option value="SEMANAL">Semanal (5x2, 6x1…)</option>
                <option value="CICLO">Ciclo (12x36 e afins)</option>
              </Select>
            </div>
          </div>

          {tipo === "CICLO" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="j-ciclo">Dias do ciclo</Label>
                <Input
                  id="j-ciclo"
                  type="number"
                  min={2}
                  max={30}
                  value={cicloDias}
                  onChange={(e) => setCicloDias(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="j-ancora">Primeiro dia do ciclo</Label>
                <Input
                  id="j-ancora"
                  type="date"
                  value={ancoraCiclo}
                  onChange={(e) => setAncoraCiclo(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Os dias</Label>
            {dias.slice(0, quantos).map((d, i) => (
              <div key={d.posicao} className="flex flex-wrap items-center gap-2 rounded border p-2">
                <span className="w-20 text-sm">
                  {tipo === "CICLO" ? `Dia ${d.posicao + 1}` : NOMES_SEMANA[d.posicao]}
                </span>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={d.trabalha}
                    onChange={(e) => ajustar(i, { trabalha: e.target.checked })}
                  />
                  trabalha
                </label>
                {d.trabalha && (
                  <>
                    <Input
                      type="time"
                      className="w-28"
                      value={d.entrada ?? ""}
                      onChange={(e) => ajustar(i, { entrada: e.target.value })}
                    />
                    <span className="text-muted-foreground">até</span>
                    <Input
                      type="time"
                      className="w-28"
                      value={d.saida ?? ""}
                      onChange={(e) => ajustar(i, { saida: e.target.value })}
                    />
                    <Input
                      type="number"
                      className="w-24"
                      min={0}
                      value={d.intervaloMin}
                      onChange={(e) => ajustar(i, { intervaloMin: Number(e.target.value) })}
                    />
                    <span className="text-xs text-muted-foreground">min de intervalo</span>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label htmlFor="j-tolm">Tolerância por batida (min)</Label>
              <Input
                id="j-tolm"
                type="number"
                min={0}
                max={5}
                value={tolMarcacao}
                onChange={(e) => setTolMarcacao(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="j-told">Tolerância no dia (min)</Label>
              <Input
                id="j-told"
                type="number"
                min={0}
                max={10}
                value={tolDia}
                onChange={(e) => setTolDia(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="j-int">Intervalo mínimo (min)</Label>
              <Input
                id="j-int"
                type="number"
                min={0}
                value={intervaloMinimo}
                onChange={(e) => setIntervaloMinimo(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O teto da tolerância é 5 minutos por batida e 10 no dia — é o limite da lei. Passou
            disso, a jornada inteira conta, não só o excedente.
          </p>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={preAssinala}
              onChange={(e) => setPreAssinala(e.target.checked)}
            />
            <span>
              Pré-assinalar o intervalo (desconta sozinho quando ele bate só entrada e saída). É o
              único pré-preenchimento que a lei permite, e aparece marcado como tal no espelho
              dele.
            </span>
          </label>
          {preAssinala && (
            <div className="w-40">
              <Label htmlFor="j-pre">Minutos</Label>
              <Input
                id="j-pre"
                type="number"
                min={0}
                value={preMinutos}
                onChange={(e) => setPreMinutos(Number(e.target.value))}
              />
            </div>
          )}

          <div className="w-64">
            <Label htmlFor="j-dir">Direção contínua máxima (min)</Label>
            <Input
              id="j-dir"
              type="number"
              min={0}
              value={maxDirecao}
              onChange={(e) => setMaxDirecao(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Só pra motorista (Lei 13.103). 0 = não avisa. Gera alerta no espelho e nunca impede
              marcação nem viagem.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={nome.trim().length < 2 || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar jornada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
