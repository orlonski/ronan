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
/** Empresa fictícia da demonstração: nunca o nome de um cliente de verdade. */
const EMPRESA_DEMO = "Transportes Exemplo";
const CASOS: { valor: Caso | ""; rotulo: string }[] = [
  { valor: "", rotulo: "Em sequência" },
  { valor: "OK", rotulo: "OK" },
  { valor: "SEMTK", rotulo: "Sem ticket" },
  { valor: "DIV", rotulo: "Devolvida" },
  { valor: "AJ", rotulo: "Ajustada" },
  { valor: "TRAV", rotulo: "Travada" },
  { valor: "HUM", rotulo: "Humano" },
];

const TOM_LOG: Record<EntradaLog["tom"], string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  no: "text-red-600 dark:text-red-400",
  wait: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
};

function tempoParado(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

const INTERVALO_MS = 20_000;
const MAX_INTERVALO_MS = 120_000;

/** Largura da cena = o que cabe na altura da janela (menos barra, placas e chips), na proporção do desenho. */
const LARGURA_DA_CENA = `min(100%, calc((100dvh - 11rem) * ${(LARGURA / ALTURA).toFixed(4)}))`;

export function EscritorioCliente() {
  const [modo, setModo] = useState<Modo>("vivo");
  const [pausado, setPausado] = useState(false);
  const [rapido, setRapido] = useState(false);
  const [caso, setCaso] = useState<Caso | "">("");
  const [reduzir, setReduzir] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [cenaKey, setCenaKey] = useState(0);
  const [semCanvas, setSemCanvas] = useState(false);
  const [dicaOculta, setDicaOculta] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
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

  // a preferência do sistema pode mudar com a tela aberta
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aoMudar = (): void => setReduzir(mq.matches);
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cena: Cena;
    try {
      cena = criarCena(
        canvas,
        {
          onNumeros: setNumeros,
          onLog: (e) => setLog((antes) => [e, ...antes].slice(0, 7)),
        },
        reduzir,
      );
    } catch {
      setSemCanvas(true);
      return;
    }
    setSemCanvas(false);
    cenaRef.current = cena;
    if (reduzir) setPausado(true);
    setCenaKey((k) => k + 1);
    return () => {
      cena.destruir();
      cenaRef.current = null;
    };
  }, [reduzir]);

  // relógio pra saber se o dado ao vivo envelheceu
  useEffect(() => {
    if (modo !== "vivo") return;
    const id = window.setInterval(() => setAgora(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [modo]);

  useEffect(() => {
    cenaRef.current?.setModo(modo);
    setLog(modo === "demo" ? [{ h: "--:--", msg: "Demonstração iniciada com dados de exemplo", tom: "info", gl: "•" }] : []);
    setCaso("");
    cenaRef.current?.setCaso("");
    if (modo === "demo") setNumeros({ fila: 7, val: 81, dev: 287, aj: 4, trav: 2, age: 195 });
    else setNumeros(ZERADO);
  }, [modo, cenaKey]);

  useEffect(() => {
    cenaRef.current?.setSnapshot(snapshot);
  }, [snapshot, modo, cenaKey]);

  useEffect(() => {
    cenaRef.current?.setPausado(pausado);
  }, [pausado, cenaKey]);
  useEffect(() => {
    cenaRef.current?.setVelocidade(rapido ? 2 : 1);
  }, [rapido, cenaKey]);

  const vivo = modo === "vivo";
  const semDados = vivo && !snapshot;
  const carregando = vivo && consulta.isPending && !consulta.isError;
  const erro = vivo && consulta.isError && !snapshot;
  const n = vivo && !snapshot ? null : numeros;
  const robo = vivo ? snapshot?.robo : undefined;
  const empresa = vivo ? snapshot?.empresa?.trim() || undefined : EMPRESA_DEMO;
  const recentes = vivo && snapshot ? snapshot.chegadas.length : null;
  const geradoMs = snapshot ? Date.parse(snapshot.geradoEm) : NaN;
  const idadeDadoMin = vivo && snapshot && !Number.isNaN(geradoMs) ? Math.max(0, Math.floor((agora - geradoMs) / 60_000)) : 0;
  const defasado = vivo && !!snapshot && !Number.isNaN(geradoMs) && agora - geradoMs > 60_000;
  const erroComDado = vivo && consulta.isError && !!snapshot;
  useEffect(() => {
    cenaRef.current?.setDefasado(defasado);
  }, [defasado, cenaKey]);
  const semMovimento =
    vivo && !!snapshot && snapshot.contagens.fila === 0 && snapshot.chegadas.length === 0 && snapshot.veredictos.length === 0 && !!n && n.val + n.dev + n.aj + n.trav === 0;

  const resumoAcessivel = n
    ? `${n.fila} na fila, ${n.val} validadas, ${n.dev} devolvidas, ${n.aj} ajustadas, ${n.trav} esperando o escritório.`
    : "Aguardando os dados.";
  const rotuloCena = `Escritório de agentes${empresa ? ` de ${empresa}` : ""}${vivo ? "" : ", demonstração com dados fictícios"}: obra à esquerda, escritório à direita. ${resumoAcessivel}`;

  const chips: { chave: keyof Numeros; rotulo: string; cor: string; marca: string; cls: string }[] = [
    { chave: "fila", rotulo: "Fila de análise", cor: "text-[#5B8AE8]", marca: "bg-[#5B8AE8]", cls: "" },
    { chave: "val", rotulo: vivo ? "Validadas (24 h)" : "Validadas", cor: "text-[#7ED9A6]", marca: "rounded-full bg-[#27A06A]", cls: "" },
    { chave: "dev", rotulo: "Devolvidas pra conferir", cor: "text-[#E05A4E]", marca: "bg-[#E05A4E]", cls: "" },
    { chave: "aj", rotulo: "Ajustadas", cor: "text-[#EEF1F8]", marca: "rounded-tl-full rounded-tr-full rounded-br-full bg-[#5B8AE8]", cls: "" },
    { chave: "trav", rotulo: "Esperando o escritório", cor: "text-[#F2B53F]", marca: "bg-[#F2B53F] [clip-path:polygon(50%_0,100%_100%,0_100%)]", cls: "flex-[1.6_1_132px] border-[#F2B53F]/35" },
  ];
  const ultimo = log[0];

  const chipsObra = (
    <>
      {vivo ? (
        recentes !== null && (
          <div className="min-w-0 rounded-md border-l-[3px] border-[#DF7234] bg-[#0A0F1E]/60 px-2.5 py-1.5">
            <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-[#A6B3D2]">Obra · últimos 10 min</p>
            <p className="text-sm font-extrabold leading-tight">
              {recentes === 0 ? "Nenhuma viagem lançada nos últimos 10 min" : `${recentes}${recentes >= 50 ? "+" : ""} ${recentes === 1 ? "lançada" : "lançadas"} nos últimos 10 min`}
            </p>
          </div>
        )
      ) : (
        <p className="rounded-md border border-dashed border-[#2A3760] px-2.5 py-1.5 text-xs text-[#A6B3D2]">Encenação em ciclo contínuo, com dados fictícios</p>
      )}
      {vivo && <p className="rounded-md border border-dashed border-[#2A3760] px-2.5 py-1.5 text-xs text-[#A6B3D2]">Reprodução da rotina — pode atrasar alguns segundos</p>}
    </>
  );
  const chipsEsc = (
    <dl aria-label="Números do escritório" className="flex flex-wrap content-start gap-1.5 px-[3px]">
      {chips.map((c) => (
        <div key={c.chave} className={cn("min-w-[76px] flex-[1_1_76px] rounded-md border border-transparent bg-[#0A0F1E]/60 px-2 py-1.5", c.cls)}>
          <dt className="flex min-h-[23px] items-start gap-[5px] text-[10px] font-semibold uppercase leading-tight tracking-wide text-[#A6B3D2]">
            <i className={cn("mt-[2px] inline-block h-[9px] w-[9px] shrink-0", c.marca)} aria-hidden />
            {c.rotulo}
          </dt>
          <dd className={cn("text-[22px] font-extrabold leading-[1.05] tabular-nums", c.cor)}>{n ? n[c.chave === "age" ? "fila" : c.chave] : "–"}</dd>
          {c.chave === "trav" && (
            <dd className="mt-px text-[11px] text-[#A6B3D2]">
              {n && n.trav > 0 ? `Mais antiga: ${n.age === null ? "—" : tempoParado(n.age)}` : n ? "Nada parado." : ""}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );

  const aviso = "rounded-md border px-3 py-1.5 text-xs max-2xl:py-1";
  const botao = "bg-transparent text-inherit hover:bg-white/10";

  return (
    <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-label="Cena do escritório" className="min-w-0 space-y-2 rounded-lg border bg-[#151E38] p-2 text-[#EEF1F8] max-2xl:p-1.5">
        {/* barra única */}
        <div role="toolbar" aria-label="Controles da cena" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-label="Origem dos dados" className="inline-flex rounded-md border border-[#2A3760] p-0.5">
            {(["vivo", "demo"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => setModo(m)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-semibold transition-colors max-md:min-h-11",
                  modo === m ? "bg-primary text-primary-foreground" : "text-[#A6B3D2] hover:text-white",
                )}
              >
                {m === "vivo" ? "Ao vivo" : "Demonstração"}
              </button>
            ))}
          </div>
          {vivo && reduzir ? (
            <Button type="button" size="sm" disabled className="max-md:min-h-11" title="Seu sistema pede menos movimento: ao vivo, só os números se atualizam">
              <Pause className="h-4 w-4" aria-hidden />
              Sem animação (preferência do sistema)
            </Button>
          ) : (
            <Button type="button" size="sm" className={cn("max-md:min-h-11", pausado && "bg-emerald-600 text-white hover:bg-emerald-700")} onClick={() => setPausado((p) => !p)}>
              {pausado ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
              {pausado ? "Continuar" : "Pausar"}
            </Button>
          )}
          {!vivo && (
            <Button type="button" size="sm" variant="outline" className={cn(botao, "max-md:min-h-11")} aria-pressed={rapido} onClick={() => setRapido((r) => !r)}>
              {rapido ? "Velocidade 1x" : "Velocidade 2x"}
            </Button>
          )}
          {!vivo && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Mostrar caso">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-[#A6B3D2]">Mostrar caso</span>
              {CASOS.map((c) => (
                <Button
                  key={c.rotulo}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={caso === c.valor}
                  className={cn(botao, "max-md:min-h-11", caso === c.valor && "border-[#5B8AE8] bg-[#1F2D56]")}
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
          {!vivo && (
            <span className="ml-auto rounded border border-[#F2B53F]/50 bg-[#F2B53F]/10 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#F2B53F] max-md:ml-0">
              Dados de exemplo
            </span>
          )}
        </div>

        {/* avisos: uma linha cada, sem roubar altura da cena */}
        {robo && !robo.ativo && (
          <p className={cn(aviso, "border-slate-400/40 bg-slate-500/15 text-slate-200")}>
            <strong>Agente desligado.</strong> A conferência está desligada neste servidor: os números mostram o que já existe, mas ninguém está lendo tickets agora.
          </p>
        )}
        {robo?.ativo && robo.modoSombra && (
          <p className={cn(aviso, "border-amber-400/40 bg-amber-400/10 text-amber-100")}>
            <strong>Modo sombra:</strong> o agente só anota, a viagem não muda. A cena mostra o que ele leu e decidiria, mas nada foi aprovado nem devolvido de verdade.
          </p>
        )}
        {erroComDado && (
          <p className={cn(aviso, "border-red-400/40 bg-red-950/60 text-red-100")} role="status">
            Não consegui atualizar agora: mostrando o último dado recebido. Tento de novo sozinho, com intervalo crescente.
          </p>
        )}
        {vivo && snapshot?.desatualizado && (
          <p className={cn(aviso, "border-amber-400/40 bg-amber-950/60 text-amber-100")} role="status">
            Servidor ocupado: mostrando o último dado bom. Volto ao ao vivo sozinho assim que normalizar.
          </p>
        )}
        {respostaInvalida && (
          <p className={cn(aviso, "border-red-400/40 bg-red-950/70 text-red-100")} role="alert">
            A API respondeu num formato que a tela não reconhece. Atualize a página (F5).
          </p>
        )}

        {/* a cena (e os chips) rolam na horizontal DENTRO do cartão em tela estreita */}
        <div className="w-full overflow-x-auto overflow-y-hidden">
          <div className="mx-auto min-w-[760px]" style={{ width: LARGURA_DA_CENA }}>
            <div className="relative w-full overflow-hidden rounded-[10px] bg-[#070B17] [container-type:inline-size]" style={{ aspectRatio: `${LARGURA} / ${ALTURA}` }}>
              {semCanvas && (
                <div role="alert" className="absolute inset-0 z-[2] flex items-center justify-center bg-[#070B17] px-6 text-center text-sm text-[#A6B3D2]">
                  Seu navegador não conseguiu abrir o desenho da cena. Os números abaixo continuam valendo.
                </div>
              )}
              <canvas ref={canvasRef} role="img" aria-label={rotuloCena} className={cn("absolute inset-0 block h-full w-full", semDados && "opacity-30")} />

              {/* rótulos fixos em HTML */}
              {!semDados &&
                ROTULOS.map((r) => {
                  const p = pctNaCena(r.zona, r.x, r.y, r.alt);
                  return (
                    <div
                      key={r.texto}
                      className={cn(
                        "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[3px] border bg-[#0A0F1E]/80 px-[.5em] py-[.15em] font-semibold uppercase tabular-nums tracking-[.04em] text-[#EEF1F8] text-[clamp(8px,.68cqw,10px)]",
                        r.obra ? "border-[#DF7234]/60" : "border-[#2A3760]",
                        r.opc && "max-md:hidden",
                      )}
                      style={{ left: `${p.left}%`, top: `${p.top}%` }}
                    >
                      {r.texto}
                    </div>
                  );
                })}

              {/* placas dos painéis */}
              <div className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-br-md rounded-tl-[10px] bg-[#DF7234] px-[.8em] py-[.3em] font-extrabold uppercase tracking-[.06em] text-[#07090F] text-[clamp(8px,1cqw,13px)]">
                A · Obra — ponto de descarga
              </div>
              <div className="pointer-events-none absolute left-[41.25%] top-0 w-[17.5%] rounded-b-md bg-[#2C3A63] py-[.3em] text-center font-extrabold uppercase tracking-[.06em] text-[#EEF1F8] text-[clamp(8px,1cqw,13px)]">
                Sinal
              </div>
              <div
                className="pointer-events-none absolute left-[58.75%] top-0 max-w-[27%] truncate rounded-br-md bg-[#2A4A9E] px-[.8em] py-[.3em] font-extrabold uppercase tracking-[.06em] text-[#EEF1F8] text-[clamp(8px,1cqw,13px)]"
                title={empresa ? `B · Escritório · ${empresa}` : undefined}
              >
                B · Escritório{empresa ? ` · ${empresa}` : ""}
              </div>

              {/* selo da encenação (com explicação) */}
              <div
                className="group absolute right-[1.2%] top-[1.4%] z-[3]"
                onMouseEnter={() => setDicaOculta(false)}
                onFocus={() => setDicaOculta(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDicaOculta(true);
                }}
              >
                <button
                  type="button"
                  aria-describedby="dica-encenacao"
                  className="cursor-help rounded border border-dashed border-[#DF7234]/80 bg-[#07090F]/65 px-[.8em] py-[.45em] font-bold uppercase leading-none tracking-[.05em] text-[#F2D3B8] text-[clamp(8px,.85cqw,11px)] hover:bg-[#07090F]/90 focus-visible:bg-[#07090F]/90 max-md:min-h-11"
                >
                  Encenação da rotina
                </button>
                <div
                  id="dica-encenacao"
                  role="tooltip"
                  className={cn(
                    "absolute right-0 top-full mt-1 hidden w-[min(260px,30cqw)] rounded-md border border-[#DF7234]/70 bg-[#0A0F1E] px-2.5 py-2 text-[clamp(9px,.95cqw,12px)] normal-case leading-snug tracking-normal text-[#EEF1F8] group-focus-within:block group-hover:block",
                    dicaOculta && "!hidden",
                  )}
                >
                  A rotina na obra (descarga, conferência e foto do comprovante) é uma representação. Cada lançamento real dispara uma descarga.
                </div>
              </div>

              {/* legenda do sinal */}
              <div className="pointer-events-none absolute bottom-[7.4%] left-[41.5%] w-[17%] text-center text-[clamp(8px,.78cqw,10px)] leading-tight text-[#A6B3D2]">
                <span className="mr-[.3em] inline-block w-[1.8em] border-t-2 border-dotted border-[#7f95c9] align-middle" />
                tracejado: ilustração
                <br />
                <span className="mr-[.3em] inline-block w-[1.8em] border-t-2 border-solid border-[#5B8AE8] align-middle" />
                linha cheia: registro real
              </div>

              {/* faixa e moldura do modo */}
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 bottom-0 flex h-[5.2%] min-h-[15px] items-center justify-center gap-[.6em] font-extrabold uppercase tracking-[.1em] text-[clamp(8px,.85cqw,11px)]",
                  vivo && defasado
                    ? "border-t border-[#F2B53F]/70 bg-[#3a2a06]/85 text-[#FFE2A0]"
                    : vivo
                    ? "border-t border-[#27A06A]/60 bg-[#0a1e16]/80 text-[#7ED9A6]"
                    : "border-t border-[#F2B53F]/70 bg-[repeating-linear-gradient(135deg,rgba(242,181,63,.28)_0_12px,rgba(242,181,63,.16)_12px_24px)] text-[#FFE2A0]",
                )}
              >
                {vivo && defasado ? (
                  `Sem atualizar há ${idadeDadoMin} min — o que se vê pode estar velho`
                ) : vivo ? (
                  <>
                    <i className="inline-block h-[.8em] w-[.8em] rounded-full bg-[#27A06A] motion-safe:animate-pulse" aria-hidden />
                    Ao vivo — chegadas e conferências reais; a rotina da obra é encenada
                  </>
                ) : (
                  "DEMONSTRAÇÃO — dados fictícios"
                )}
              </div>
              <div className={cn("pointer-events-none absolute inset-0 rounded-[10px]", vivo && defasado ? "shadow-[inset_0_0_0_2px_rgba(242,181,63,.7)]" : vivo ? "shadow-[inset_0_0_0_2px_rgba(39,160,106,.55)]" : "shadow-[inset_0_0_0_2px_rgba(242,181,63,.7)]")} />

              {semMovimento && (
                <div className="pointer-events-none absolute left-1/2 top-[9%] -translate-x-1/2 rounded bg-[#0A0F1E]/90 px-3 py-1.5 text-xs text-[#A6B3D2]">
                  Sem movimento nas últimas 24 h. Quando uma viagem chegar, ela aparece aqui.
                </div>
              )}
              {carregando && (
                <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
                  <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden />
                  <p>Buscando os dados reais…</p>
                </div>
              )}
              {erro && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <AlertCircle className="h-7 w-7 text-red-400" aria-hidden />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Não consegui buscar os dados do escritório</p>
                    <p className="mx-auto max-w-prose text-sm text-[#A6B3D2]">
                      O Escritório pode estar desligado pela plataforma, o servidor pode estar ocupado ou esta versão da API ainda não tem a tela. Nenhum dado foi perdido. Tento de novo sozinho, com intervalo crescente.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className={cn(botao, "min-h-11")} onClick={() => void consulta.refetch()}>
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Tentar de novo
                  </Button>
                </div>
              )}
            </div>

            {/* chips resumo, alinhados aos painéis (a partir de tablet) */}
            <div className="mt-1.5 hidden grid-cols-[41.25%_17.5%_41.25%] md:grid">
              <div className="flex flex-wrap content-start gap-1.5 px-[3px]">{chipsObra}</div>
              <div />
              {chipsEsc}
            </div>
          </div>
        </div>
        {/* no celular os números ficam fora do scroller horizontal, sempre à vista */}
        <div className="space-y-1.5 md:hidden">
          <div className="flex flex-wrap gap-1.5">{chipsObra}</div>
          {chipsEsc}
        </div>
      </section>

      {/* log: coluna em telas largas, uma linha + "Ver as últimas" nas outras */}
      <aside className="hidden min-w-0 2xl:block" aria-labelledby="t-log">
        <Card className="p-3">
          <h2 id="t-log" className="text-sm font-extrabold">
            O que está acontecendo
          </h2>
          <ListaLog log={log} vivo={vivo} aoVivo />
        </Card>
      </aside>
      <details className="rounded-lg border bg-card px-3 py-1.5 text-sm 2xl:hidden">
        <summary className="flex cursor-pointer list-none items-baseline gap-3 max-md:min-h-11 max-md:items-center [&::-webkit-details-marker]:hidden">
          <b className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground max-sm:hidden">O que está acontecendo</b>
          <span className="min-w-0 flex-1 truncate" aria-live="polite">{ultimo ? `${ultimo.h}  ${ultimo.msg}` : vivo ? "Nada novo desde que a tela abriu" : "Aguardando…"}</span>
          <u className="whitespace-nowrap font-semibold text-sky-600 dark:text-sky-400">Ver as últimas</u>
        </summary>
        <ListaLog log={log} vivo={vivo} />
      </details>
    </div>
  );
}

function ListaLog({ log, vivo, aoVivo }: { log: EntradaLog[]; vivo: boolean; aoVivo?: boolean }) {
  return (
    <ol className="mt-2 flex flex-col text-[13px]" aria-live={aoVivo ? "polite" : undefined}>
      {log.length === 0 && (
        <li className="py-2 text-muted-foreground">
          {vivo ? "Nada novo desde que a tela abriu. As viagens que chegarem e forem conferidas aparecem aqui." : "Aguardando…"}
        </li>
      )}
      {log.map((e, i) => (
        <li key={`${e.h}-${i}-${e.msg}`} className="grid grid-cols-[2.75rem_1rem_minmax(0,1fr)] items-baseline gap-1.5 border-b py-1 last:border-b-0">
          <time className="tabular-nums text-muted-foreground">{e.h}</time>
          <span className={TOM_LOG[e.tom]} aria-hidden>
            {e.gl}
          </span>
          <span className={i === 0 ? "font-semibold" : undefined}>{e.msg}</span>
        </li>
      ))}
    </ol>
  );
}
