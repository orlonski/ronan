"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { EscritorioSnapshotSchema } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import {
  ALTURA,
  LARGURA,
  ROTULOS,
  criarCena,
  pctNaCena,
  type Caso,
  type Cena,
  type EntradaLog,
  type Modo,
  type Numeros,
} from "./cena";

const ZERADO: Numeros = { fila: 0, val: 0, dev: 0, aj: 0, trav: 0, age: 0 };
const ENDPOINT = "/admin/conferencias/escritorio";
const CASOS: { valor: Caso | ""; rotulo: string }[] = [
  { valor: "", rotulo: "Em sequência" },
  { valor: "OK", rotulo: "Aprovada" },
  { valor: "DIV", rotulo: "Divergente" },
  { valor: "AJ", rotulo: "Ajustada" },
  { valor: "TRAV", rotulo: "Travada" },
];

const TOM_LOG: Record<EntradaLog["tom"], string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  no: "text-red-600 dark:text-red-400",
  wait: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
};
const TOM_ROTULO: Record<string, string> = {
  "": "text-white",
  f: "text-sky-300",
  v: "text-emerald-300",
  d: "text-red-300",
  a: "text-white",
};

function tempoParado(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

const INTERVALO_MS = 20_000;
const MAX_INTERVALO_MS = 120_000;

export function EscritorioCliente() {
  const [modo, setModo] = useState<Modo>("vivo");
  const [pausado, setPausado] = useState(false);
  const [rapido, setRapido] = useState(false);
  const [caso, setCaso] = useState<Caso | "">("");
  const [numeros, setNumeros] = useState<Numeros>(ZERADO);
  const [log, setLog] = useState<EntradaLog[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cenaRef = useRef<Cena | null>(null);

  // Dados reais: só busca no modo "vivo". O React Query já pausa quando a aba
  // fica oculta e para quando a tela é desmontada.
  //
  // ⚠️ Esta consulta é polling de toda aba aberta e a 1ª versão (a cada 10 s,
  // refazendo ao focar a janela) ajudou a travar o banco da produção. Agora:
  // 20 s, sem refazer ao focar, e em erro o intervalo dobra (20 → 40 → 80 → 120 s)
  // em vez de insistir no ritmo normal contra um servidor que já está lento.
  const consulta = useApiQuery<unknown>(modo === "vivo" ? ENDPOINT : undefined, {
    refetchInterval: (q) =>
      q.state.status === "error"
        ? Math.min(MAX_INTERVALO_MS, INTERVALO_MS * 2 ** Math.min(q.state.fetchFailureCount, 4))
        : INTERVALO_MS,
    refetchOnWindowFocus: false,
    staleTime: INTERVALO_MS,
    retry: false,
  });
  const lido = useMemo(() => (consulta.data ? EscritorioSnapshotSchema.safeParse(consulta.data) : null), [consulta.data]);
  const snapshot = lido && lido.success ? lido.data : null;
  const respostaInvalida = lido !== null && !lido.success;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cena = criarCena(
      canvas,
      {
        onNumeros: setNumeros,
        onLog: (e) => setLog((antes) => [e, ...antes].slice(0, 7)),
      },
      reduzir,
    );
    cenaRef.current = cena;
    if (reduzir) setPausado(true);
    return () => {
      cena.destruir();
      cenaRef.current = null;
    };
  }, []);

  useEffect(() => {
    cenaRef.current?.setModo(modo);
    setLog(modo === "demo" ? [{ h: "--:--", msg: "Demonstração iniciada com dados de exemplo", tom: "info", gl: "•" }] : []);
    setCaso("");
    cenaRef.current?.setCaso("");
    if (modo === "demo") setNumeros({ fila: 7, val: 128, dev: 6, aj: 11, trav: 2, age: 195 });
    else setNumeros(ZERADO);
  }, [modo]);

  useEffect(() => {
    cenaRef.current?.setSnapshot(snapshot);
  }, [snapshot, modo]);

  useEffect(() => {
    cenaRef.current?.setPausado(pausado);
  }, [pausado]);
  useEffect(() => {
    cenaRef.current?.setVelocidade(rapido ? 2 : 1);
  }, [rapido]);

  const vivo = modo === "vivo";
  const semDados = vivo && !snapshot;
  const carregando = vivo && consulta.isPending && !consulta.isError;
  const erro = vivo && consulta.isError && !snapshot;
  const n = vivo && !snapshot ? null : numeros;
  const robo = vivo ? snapshot?.robo : undefined;

  const resumoAcessivel = n
    ? `${n.fila} na fila, ${n.val} validadas, ${n.dev} devolvidas, ${n.aj} ajustadas, ${n.trav} esperando o escritório.`
    : "Aguardando os dados.";

  const chips: { chave: keyof Numeros; rotulo: string; cor: string; marca: string }[] = [
    { chave: "fila", rotulo: "Fila de análise", cor: "text-sky-600 dark:text-sky-400", marca: "bg-sky-500" },
    { chave: "val", rotulo: vivo ? "Validadas (24 h)" : "Validadas", cor: "text-emerald-600 dark:text-emerald-400", marca: "rounded-full bg-emerald-500" },
    { chave: "dev", rotulo: "Devolvidas pra conferir", cor: "text-red-600 dark:text-red-400", marca: "bg-red-500" },
    { chave: "aj", rotulo: "Ajustadas", cor: "text-foreground", marca: "rounded-tl-full rounded-tr-full rounded-br-full bg-sky-400" },
    { chave: "trav", rotulo: "Esperando o escritório", cor: "text-amber-600 dark:text-amber-400", marca: "bg-amber-500 [clip-path:polygon(50%_0,100%_100%,0_100%)]" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Origem dos dados"
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {(["vivo", "demo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              onClick={() => setModo(m)}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium transition-colors max-md:min-h-11",
                modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "vivo" ? "Ao vivo" : "Demonstração"}
            </button>
          ))}
        </div>
        {!vivo && (
          <span className="rounded-md border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
            Dados de exemplo
          </span>
        )}
      </div>

      {robo && !robo.ativo && (
        <Card className="border-slate-300 bg-slate-50 p-4 text-sm text-slate-900">
          <strong>Agente desligado.</strong> A conferência está desligada neste servidor: os números abaixo
          mostram o que já existe, mas ninguém está lendo tickets agora.
        </Card>
      )}
      {robo?.ativo && robo.modoSombra && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Modo sombra:</strong> o agente só anota, a viagem não muda. A cena mostra o que ele leu e
          decidiria, mas nada foi aprovado nem devolvido de verdade.
        </Card>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Números do escritório">
        {chips.map((c) => (
          <Card key={c.chave} className="min-w-0 p-3">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <i className={cn("inline-block h-2.5 w-2.5 shrink-0", c.marca)} aria-hidden />
              <span className="truncate">{c.rotulo}</span>
            </dt>
            <dd className={cn("mt-1 text-3xl font-extrabold tabular-nums leading-tight", c.cor)}>
              {n ? n[c.chave === "age" ? "fila" : c.chave] : "–"}
            </dd>
          </Card>
        ))}
      </dl>

      <section aria-label="Cena do escritório" className="space-y-3 rounded-lg border bg-[#151E38] p-2.5 text-[#EEF1F8]">
        <div
          className="relative mx-auto w-full overflow-hidden rounded-md bg-[#0A0F1E] [container-type:inline-size]"
          style={{ aspectRatio: `${LARGURA} / ${ALTURA}` }}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Escritório de agentes. ${resumoAcessivel}`}
            className={cn("absolute inset-0 h-full w-full", semDados && "opacity-30")}
          />
          {!semDados &&
            ROTULOS.map((r) => {
              const p = pctNaCena(r.x, r.y, r.z);
              const valor = r.chave && n ? n[r.chave] : null;
              return (
                <div
                  key={r.texto}
                  className={cn(
                    "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[3px] border border-[#2A3760] bg-[#0A0F1E]/85 px-[.55em] py-[.2em] font-semibold uppercase tabular-nums tracking-[.04em] text-[clamp(8px,1.15cqw,13px)]",
                    TOM_ROTULO[r.tom],
                    r.opc && "max-md:hidden",
                  )}
                  style={{ left: `${p.left}%`, top: `${p.top}%` }}
                >
                  {r.texto}
                  {valor !== null && <b className="ml-1.5 font-extrabold">{valor}</b>}
                </div>
              );
            })}
          {!vivo && (
            <div className="pointer-events-none absolute left-3 top-3 rounded border border-amber-400 bg-amber-100/95 px-2.5 py-1 text-[clamp(9px,1.2cqw,13px)] font-bold uppercase tracking-wide text-amber-900">
              Dados de exemplo
            </div>
          )}
          {carregando && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              <p>Buscando os dados reais…</p>
            </div>
          )}
          {erro && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle className="h-7 w-7 text-red-400" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-semibold">Não consegui buscar os dados do escritório</p>
                <p className="mx-auto max-w-prose text-sm text-[#A6B3D2]">
                  O Escritório pode estar desligado pela plataforma, o servidor pode estar ocupado ou esta versão da
                  API ainda não tem a tela. Nenhum dado foi perdido. Tento de novo sozinho, com intervalo crescente.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="bg-transparent hover:bg-white/10" onClick={() => void consulta.refetch()}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                Tentar de novo
              </Button>
            </div>
          )}
          {vivo && snapshot?.desatualizado && (
            <div className="absolute inset-x-0 bottom-0 bg-amber-950/90 px-4 py-2 text-center text-xs text-amber-100">
              Servidor ocupado: mostrando o último dado bom. Volto ao ao vivo sozinho assim que normalizar.
            </div>
          )}
          {respostaInvalida && (
            <div className="absolute inset-x-0 bottom-0 bg-red-950/90 px-4 py-2 text-center text-xs text-red-100">
              A API respondeu num formato que a tela não reconhece. Atualize a página (F5).
            </div>
          )}
          {vivo && snapshot && snapshot.contagens.fila === 0 && snapshot.chegadas.length === 0 && snapshot.veredictos.length === 0 && n && n.val + n.dev + n.aj + n.trav === 0 && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-[#0A0F1E]/90 px-3 py-1.5 text-xs text-[#A6B3D2]">
              Sem movimento nas últimas 24 h. Quando uma viagem chegar, ela aparece aqui.
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => setPausado((p) => !p)}>
              {pausado ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
              {pausado ? "Continuar" : "Pausar"}
            </Button>
            {!vivo && (
              <Button type="button" size="sm" variant="outline" className="bg-transparent text-inherit hover:bg-white/10" aria-pressed={rapido} onClick={() => setRapido((r) => !r)}>
                {rapido ? "Velocidade 1x" : "Velocidade 2x"}
              </Button>
            )}
          </div>
          {!vivo && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Mostrar o caso">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[#A6B3D2]">Mostrar</span>
              {CASOS.map((c) => (
                <Button
                  key={c.rotulo}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={caso === c.valor}
                  className={cn("bg-transparent text-inherit hover:bg-white/10", caso === c.valor && "border-sky-400 bg-white/10")}
                  onClick={() => {
                    setCaso(c.valor);
                    cenaRef.current?.setCaso(c.valor);
                    if (c.valor) setPausado(false);
                  }}
                >
                  {c.rotulo}
                </Button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-4">
          <h2 className="text-base font-semibold">O que está acontecendo</h2>
          <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
            {n && n.trav > 0 ? (
              <>
                Mais antiga esperando o escritório: parada há <strong className="tabular-nums">{tempoParado(n.age)}</strong>
                {!vivo && " (relógio acelerado na demonstração)"}.
              </>
            ) : n ? (
              "Nenhuma viagem parada esperando o escritório."
            ) : (
              "Aguardando os dados."
            )}
          </p>
          <ol className="mt-3 flex flex-col text-sm">
            {log.length === 0 && (
              <li className="py-2 text-muted-foreground">
                {vivo ? "Nada novo desde que a tela abriu. As viagens que chegarem e forem conferidas aparecem aqui." : "Aguardando…"}
              </li>
            )}
            {log.map((e, i) => (
              <li key={`${e.h}-${i}-${e.msg}`} className="grid grid-cols-[3rem_1.25rem_minmax(0,1fr)] items-baseline gap-2 border-b py-1.5 last:border-b-0">
                <time className="tabular-nums text-muted-foreground">{e.h}</time>
                <span className={TOM_LOG[e.tom]} aria-hidden>{e.gl}</span>
                <span className={i === 0 ? "font-medium" : undefined}>{e.msg}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-4">
          <h2 className="text-base font-semibold">Como ler a cena</h2>
          <dl className="mt-3 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 gap-y-2 text-sm">
            <dt className="mt-1 h-3.5 w-3.5 rounded-full bg-emerald-500" />
            <dd className="text-muted-foreground"><b className="font-semibold text-foreground">Verde:</b> o ticket confere e a viagem vai pro arquivo de validadas.</dd>
            <dt className="mt-1 h-3.5 w-3.5 bg-red-500" />
            <dd className="text-muted-foreground"><b className="font-semibold text-foreground">Vermelho:</b> divergência. Se o conferente confirmar na segunda leitura, a viagem volta pro celular do motorista.</dd>
            <dt className="mt-1 h-3.5 w-3.5 bg-amber-500 [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
            <dd className="text-muted-foreground"><b className="font-semibold text-foreground">Âmbar:</b> viagem parada esperando alguém do escritório. O relógio do balcão mostra há quanto tempo.</dd>
            <dt className="mt-1 h-3.5 w-3.5 bg-sky-500" />
            <dd className="text-muted-foreground"><b className="font-semibold text-foreground">Azul:</b> dado em trânsito (celular, torre, servidor, mesa).</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            {vivo
              ? "Ao vivo, a cena só anima o que de fato aconteceu: uma viagem que chegou ou uma conferência que terminou. Os números vêm direto do servidor e se atualizam a cada 20 segundos."
              : "Na demonstração tudo é de exemplo: o caminhão, os valores e o relógio do balcão (acelerado)."}
          </p>
        </Card>
      </div>
    </div>
  );
}
