/**
 * GASTO DE VIAGEM no app — a lógica das telas (sem desenho e sem falar com a
 * API direto: a conversa com o servidor mora em lib/despesas.ts).
 *
 * Tudo aqui funciona offline: o que está no servidor vem do cache (cache-first)
 * e o que ainda está no celular vem do outbox, e os dois se juntam numa lista
 * só ("o que ele vê"). Ligar um gasto a uma viagem aparece na hora, antes de
 * subir: a ligação pendente é aplicada por cima do que o servidor disse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  cacheGetAt,
  cachePut,
  listPendingDespesas,
  listPendingViagemIniciar,
  listPendingViagens,
  listPendingVinculosGasto,
  type PendingDespesa,
  type PendingViagem,
  type PendingViagemIniciar,
  type PendingVinculoGasto,
} from "@/db/database";
import {
  buscarMinhasDespesas,
  catalogoTemTiposDespesa,
  CAP_DESPESA_ACOMPANHAR,
  CAP_DESPESA_LANCAR,
  lerTiposDespesa,
  type DespesaApp,
  type TipoDespesaApp,
} from "./despesas";
import { useCapacidadeNova } from "./acessos-app";
import { getLifecycleLocal, type LifecycleLocal } from "./lifecycle";
import { cacheFirst, useCatalogos, useViagens, type Viagem } from "./queries";
import {
  descartarVinculoGastoPendente,
  enqueueVinculoGasto,
  onSyncChange,
  vincularDespesasPendentes,
} from "./sync";

// ---------------------------------------------------------------------------
// Módulo ligado?
// ---------------------------------------------------------------------------

/**
 * O módulo `despesas` contratado E a capacidade ligada pra ele. Capacidade que
 * o servidor não mandou (servidor antigo, empresa sem o módulo) = desligada:
 * sem o módulo a home fica EXATAMENTE como sempre foi.
 */
export function useModuloDespesas(): { lancar: boolean; acompanhar: boolean } {
  const capLancar = useCapacidadeNova(CAP_DESPESA_LANCAR);
  const capAcompanhar = useCapacidadeNova(CAP_DESPESA_ACOMPANHAR);
  // A capacidade sozinha NÃO basta: o corte de CONTRATO do acesso ao app nasce
  // em sombra, então o efetivo traz `app.despesa.*` até pra empresa que não
  // contratou. Quem diz se o módulo vale é o catálogo (`config.despesas`, o
  // mesmo `modulosDaConta` do servidor). Catálogo antigo, sem o campo = não.
  const cat = useCatalogos();
  const contratado = cat.data?.config?.despesas === true;
  // Acompanhar sobrevive ao cancelamento: sem o módulo, "Meus reembolsos" só
  // aparece pra quem tem gasto lançado (o GET não exige o módulo).
  const historico = useMinhasDespesas(capAcompanhar && !contratado && !!cat.data);
  const temHistorico = (historico.data?.length ?? 0) > 0;
  return {
    lancar: capLancar && contratado,
    acompanhar: capAcompanhar && (contratado || temHistorico),
  };
}

// ---------------------------------------------------------------------------
// Dinheiro, data e id
// ---------------------------------------------------------------------------

export function fmtReais(n: number): string {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Máscara de valor: só dígitos, em centavos. "1234" → 12,34. */
export function centavosDoTexto(t: string): number {
  const d = t.replace(/\D/g, "").slice(0, 9);
  return d ? parseInt(d, 10) : 0;
}

const OFFSET_BR_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" do instante no calendário de São Paulo (UTC-3 fixo). */
export function diaSP(iso: string | number | Date): string {
  const t = new Date(iso).getTime();
  const br = new Date((Number.isNaN(t) ? Date.now() : t) - OFFSET_BR_MS);
  return `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, "0")}-${String(br.getUTCDate()).padStart(2, "0")}`;
}

/** "14:32" em Brasília. */
export function horaSP(iso: string): string {
  const t = new Date(iso).getTime();
  const br = new Date((Number.isNaN(t) ? Date.now() : t) - OFFSET_BR_MS);
  return `${String(br.getUTCHours()).padStart(2, "0")}:${String(br.getUTCMinutes()).padStart(2, "0")}`;
}

/** "hoje", "ontem" ou "02/10". */
export function diaFalado(dia: string): string {
  const hoje = diaSP(Date.now());
  if (dia === hoje) return "hoje";
  if (dia === diaSP(Date.now() - 24 * 60 * 60 * 1000)) return "ontem";
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

export function novoClientId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Catálogo de tipos (offline)
// ---------------------------------------------------------------------------

/**
 * Os tipos do catálogo em cache. `chegaram` = o catálogo deste celular já tem
 * o campo (mesmo vazio). Sem ele (instalou e nunca teve sinal, ou servidor
 * antigo), a lista mostra o quadro de "ainda não chegaram".
 */
export function useTiposDespesa(): {
  daEmpresa: TipoDespesaApp[];
  chegaram: boolean;
  carregando: boolean;
  tentarAgora: () => void;
  porId: (id: string | null | undefined) => TipoDespesaApp | undefined;
} {
  const cat = useCatalogos();
  const todos = useMemo(() => lerTiposDespesa(cat.data), [cat.data]);
  // O catálogo só traz tipos da empresa (pedágio e abastecimento são do app).
  const daEmpresa = todos;
  const chegaram = catalogoTemTiposDespesa(cat.data);
  const porId = useCallback((id: string | null | undefined) => todos.find((t) => t.id === id), [todos]);
  return {
    daEmpresa,
    chegaram,
    carregando: cat.isLoading || cat.isFetching,
    tentarAgora: () => void cat.refetch(),
    porId,
  };
}

// ---------------------------------------------------------------------------
// Outbox (o que ainda está no celular)
// ---------------------------------------------------------------------------

function useFilaLocal<T>(listar: () => Promise<T[]>): T[] {
  const [itens, setItens] = useState<T[]>([]);
  useEffect(() => {
    let vivo = true;
    const refresh = async () => {
      try {
        const l = await listar();
        if (vivo) setItens(l);
      } catch {
        /* storage indisponível */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      vivo = false;
      off();
    };
  }, [listar]);
  return itens;
}

export function usePendingDespesas(): PendingDespesa[] {
  return useFilaLocal(listPendingDespesas);
}

export function usePendingVinculosGasto(): PendingVinculoGasto[] {
  return useFilaLocal(listPendingVinculosGasto);
}

// ---------------------------------------------------------------------------
// O que está no servidor (cache-first)
// ---------------------------------------------------------------------------

const CACHE_DESPESAS = "q:despesas";

export function useMinhasDespesas(enabled = true) {
  const buscarRede = async (): Promise<DespesaApp[]> => {
    const fresh = await buscarMinhasDespesas();
    void cachePut(CACHE_DESPESAS, fresh).catch(() => {});
    return fresh;
  };
  return useQuery({
    queryKey: ["despesas"],
    staleTime: 30_000,
    enabled,
    // A lista guardada passou pelo leitor tolerante antes de ir pro disco; o
    // cache antigo (ou lixo) vira lista vazia, nunca crash.
    queryFn: () =>
      cacheFirst<DespesaApp[]>(["despesas"], CACHE_DESPESAS, buscarRede, (x) =>
        Array.isArray(x) ? x : [],
      ),
  });
}

/** Quando a lista do servidor foi guardada (pro "Atualizado às 09:40"). */
export function useDespesasAtualizadasEm(): number | null {
  const q = useMinhasDespesas(false);
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    void cacheGetAt(CACHE_DESPESAS).then((at) => {
      if (vivo) setT(at);
    });
    return () => {
      vivo = false;
    };
  }, [q.dataUpdatedAt]);
  return t;
}

// ---------------------------------------------------------------------------
// A lista que ele vê (servidor + celular)
// ---------------------------------------------------------------------------

export type CorStatus = "cinza" | "azul" | "verde" | "ambar";

export type StatusExibido = {
  texto: string;
  cor: CorStatus;
  /** Frase do escritório (motivo), quando há. */
  motivo: string | null;
  /** Entra no "pra receber de volta"? Com quanto? */
  soma: number;
  /** Aprovado (verde) ou ainda com o escritório/no celular (azul/cinza). */
  grupo: "aprovado" | "escritorio" | "fora";
};

export type GastoVisto = {
  chave: string;
  origem: "celular" | "servidor";
  despesaId: string | null;
  clientId: string | null;
  tipoId: string | null;
  tipoNome: string;
  tipoIcone: string | null;
  data: string;
  dia: string;
  valorInformado: number;
  reembolsa: boolean;
  viagemId: string | null;
  viagemClientId: string | null;
  viagemRotulo: string | null;
  naoFoiEmViagem: boolean;
  /** Ninguém disse de qual viagem foi (nem "não foi em viagem"). */
  semResposta: boolean;
  /** Ainda dá pra corrigir/apagar (no celular, ou com o escritório). */
  editavel: boolean;
  status: StatusExibido;
  servidor: DespesaApp | null;
  pendente: PendingDespesa | null;
};

function fmtDM(iso: string): string {
  const [, m, d] = diaSP(iso).split("-");
  return `${d}/${m}`;
}

/**
 * O texto da tela sai da `situacao` do servidor (10-telas §8). Vermelho nunca:
 * "não vai ser reembolsado" é âmbar, e ele pode responder ao escritório.
 */
export function statusDoServidor(d: DespesaApp): StatusExibido {
  const aprovado = d.valorAprovado ?? d.valorInformado;
  const soma = d.somaPraReceber ? aprovado : 0;
  switch (d.situacao) {
    case "POR_SUA_CONTA":
      return { texto: "Por sua conta", cor: "cinza", motivo: null, soma: 0, grupo: "fora" };
    case "NAO_REEMBOLSADA":
      return { texto: "Não vai ser reembolsado", cor: "ambar", motivo: d.motivo, soma: 0, grupo: "fora" };
    case "PAGO":
      return {
        texto: d.acerto?.pagoEm ? `Pago em ${fmtDM(d.acerto.pagoEm)}` : "Pago",
        cor: "verde",
        motivo: null,
        soma,
        grupo: soma > 0 ? "aprovado" : "fora",
      };
    case "NO_ACERTO":
      return {
        texto: d.acerto?.periodoFim ? `No acerto de ${fmtDM(d.acerto.periodoFim)}` : "No acerto",
        cor: "verde",
        motivo: null,
        soma,
        grupo: soma > 0 ? "aprovado" : "fora",
      };
    case "APROVADA_OUTRO_VALOR":
      return {
        texto: `Aprovado ${fmtReais(aprovado)}`,
        cor: "ambar",
        motivo: d.motivo,
        soma,
        grupo: "aprovado",
      };
    case "PAGO_FORA_DO_ACERTO":
      return {
        texto: "Aprovado — o escritório paga fora do acerto",
        cor: "verde",
        motivo: null,
        soma,
        grupo: "aprovado",
      };
    case "APROVADA":
      return {
        texto: "Aprovado — entra no próximo acerto",
        cor: "verde",
        motivo: null,
        soma,
        grupo: "aprovado",
      };
    default:
      return {
        texto: "Com o escritório",
        cor: "azul",
        motivo: null,
        // Com o escritório sempre conta (o servidor manda `somaPraReceber`; o
        // cache de antes do campo não tem, e aí vale o lançado).
        soma: d.somaPraReceber ? aprovado : d.valorInformado,
        grupo: "escritorio",
      };
  }
}

function valorDoPayload(p: Record<string, unknown>): number {
  const v = typeof p.valor === "number" ? p.valor : Number(p.valor);
  return Number.isFinite(v) ? v : 0;
}

function doCelular(p: PendingDespesa): GastoVisto {
  const pl = p.payload;
  const data = typeof pl.data === "string" ? pl.data : new Date(p.createdAt).toISOString();
  const valor = valorDoPayload(pl);
  const viagemId = typeof pl.viagemId === "string" ? pl.viagemId : null;
  const viagemClientId = typeof pl.viagemClientId === "string" ? pl.viagemClientId : null;
  const fora = pl.foraDeViagem === true;
  const fotoNoCelular = p.fotos.length > 0 && p.fotos.some((f) => !f.fotoKey) && !!p.lastTriedAt;
  const status: StatusExibido = !p.resumo.reembolsa
    ? { texto: "Por sua conta", cor: "cinza", motivo: null, soma: 0, grupo: "fora" }
    : fotoNoCelular
      ? { texto: "Foto ainda no celular", cor: "cinza", motivo: null, soma: valor, grupo: "escritorio" }
      : { texto: "Guardado no celular", cor: "cinza", motivo: null, soma: valor, grupo: "escritorio" };
  return {
    chave: `c:${p.clientId}`,
    origem: "celular",
    despesaId: null,
    clientId: p.clientId,
    tipoId: typeof pl.tipoDespesaId === "string" ? pl.tipoDespesaId : null,
    tipoNome: p.resumo.tipoNome,
    tipoIcone: p.resumo.tipoIcone ?? null,
    data,
    dia: diaSP(data),
    valorInformado: valor,
    reembolsa: p.resumo.reembolsa,
    viagemId,
    viagemClientId,
    viagemRotulo: p.resumo.viagemRotulo ?? null,
    naoFoiEmViagem: fora,
    semResposta: !viagemId && !viagemClientId && !fora,
    editavel: true,
    status,
    servidor: null,
    pendente: p,
  };
}

function doServidor(d: DespesaApp, vinculos: PendingVinculoGasto[]): GastoVisto {
  let viagemId = d.viagem?.id ?? d.viagemId;
  let viagemClientId = d.viagem?.clientId ?? d.viagemClientId;
  let rotulo = d.viagem?.resumo ?? null;
  let vinculo = d.vinculo;
  // A ligação que ainda está na fila vale por cima do que o servidor disse —
  // ele ligou agora, tem que ver ligado agora. Em ordem (a última vence).
  for (const v of vinculos) {
    if (!v.despesas.includes(d.id) && !(d.clientId && v.despesas.includes(d.clientId))) continue;
    if (v.acao === "DESFAZER") {
      viagemId = null;
      viagemClientId = null;
      rotulo = null;
      vinculo = "SEM_RESPOSTA";
    } else if (v.acao === "FORA_DE_VIAGEM") {
      viagemId = null;
      viagemClientId = null;
      rotulo = null;
      vinculo = "FORA_DE_VIAGEM";
    } else {
      viagemId = v.viagemId ?? null;
      viagemClientId = v.viagemClientId ?? null;
      rotulo = v.resumo.viagemRotulo ?? null;
      vinculo = "VIAGEM";
    }
  }
  return {
    chave: `s:${d.id}`,
    origem: "servidor",
    despesaId: d.id,
    clientId: d.clientId,
    tipoId: d.tipoId,
    tipoNome: d.tipoNome,
    tipoIcone: d.tipoIcone,
    data: d.data,
    dia: diaSP(d.data),
    valorInformado: d.valorInformado,
    reembolsa: d.situacao !== "POR_SUA_CONTA",
    viagemId,
    viagemClientId,
    viagemRotulo: rotulo ?? (vinculo === "VIAGEM" ? "Viagem ainda no celular" : null),
    naoFoiEmViagem: vinculo === "FORA_DE_VIAGEM",
    semResposta: vinculo === "SEM_RESPOSTA",
    editavel: d.editavel,
    status: statusDoServidor(d),
    servidor: d,
    pendente: null,
  };
}

/**
 * Tudo que ele lançou: o que está no celular primeiro, depois o servidor, do
 * mais novo pro mais velho. Um gasto que acabou de subir e ainda está no cache
 * velho do servidor não aparece duas vezes (casa pelo clientId).
 */
export function useGastos(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const q = useMinhasDespesas(enabled);
  const pend = usePendingDespesas();
  const vinc = usePendingVinculosGasto();
  // Gasto que acabou de sair da fila ainda não está no cache do servidor:
  // revalida na hora, senão ele some da lista por um instante.
  const qtdFila = useRef(pend.length);
  useEffect(() => {
    if (enabled && pend.length < qtdFila.current) void q.refetch();
    qtdFila.current = pend.length;
  }, [pend.length, enabled, q]);
  const gastos = useMemo<GastoVisto[]>(() => {
    const locais = pend.map(doCelular);
    const ids = new Set(pend.map((p) => p.clientId));
    const remotos = (q.data ?? [])
      .filter((d) => !d.clientId || !ids.has(d.clientId))
      .map((d) => doServidor(d, vinc));
    return [...locais, ...remotos].sort((a, b) => b.data.localeCompare(a.data));
  }, [pend, vinc, q.data]);
  return { gastos, query: q };
}

export type ResumoReembolso = {
  total: number;
  aprovado: number;
  comEscritorio: number;
  semViagem: number;
};

export function resumirGastos(gastos: GastoVisto[]): ResumoReembolso {
  let aprovado = 0;
  let comEscritorio = 0;
  for (const g of gastos) {
    if (g.status.grupo === "aprovado") aprovado += g.status.soma;
    else if (g.status.grupo === "escritorio") comEscritorio += g.status.soma;
  }
  return {
    total: aprovado + comEscritorio,
    aprovado,
    comEscritorio,
    semViagem: gastosSemViagem(gastos).length,
  };
}

/** Gastos que pedem "de qual viagem foi?" (sem resposta e ainda mexíveis). */
export function gastosSemViagem(gastos: GastoVisto[]): GastoVisto[] {
  // Gasto que já entrou em acerto fechado sai daqui (não tem mais o que mudar).
  return gastos.filter(
    (g) =>
      g.semResposta &&
      (g.origem === "celular" ||
        (g.servidor && g.servidor.situacao !== "NO_ACERTO" && g.servidor.situacao !== "PAGO")),
  );
}

// ---------------------------------------------------------------------------
// Possível repetido (só com o que está no celular — enviado e guardado)
// ---------------------------------------------------------------------------

export function procurarRepetidos(
  gastos: GastoVisto[],
  alvo: { tipoId: string; valor: number; dia: string; ignorarClientId?: string | null },
): GastoVisto[] {
  return gastos.filter(
    (g) =>
      g.tipoId === alvo.tipoId &&
      g.dia === alvo.dia &&
      Math.abs(g.valorInformado - alvo.valor) < 0.005 &&
      (!alvo.ignorarClientId || g.clientId !== alvo.ignorarClientId),
  );
}

// ---------------------------------------------------------------------------
// Viagens que o celular conhece (pra "Foi nesta viagem?" e pra ligar depois)
// ---------------------------------------------------------------------------

export type ViagemConhecida = {
  chave: string;
  viagemId: string | null;
  clientId: string | null;
  rotulo: string;
  dia: string;
  /** Início (guiada) — ISO. */
  inicio: string | null;
  emAndamento: boolean;
  veiculoId: string | null;
  placa: string | null;
};

function rotuloDaViagemServidor(v: Viagem): string {
  const carga = v.localCarga?.nome;
  const desc = v.localDescarga?.nome;
  if (carga) return desc ? `${carga} → ${desc}` : carga;
  return v.cliente?.nome ?? "Viagem";
}

/**
 * As viagens que este celular conhece, sem rede: a em andamento (espelho da
 * guiada), as guardadas na fila e as do cache do histórico.
 */
export function useViagensConhecidas(): ViagemConhecida[] {
  const viagens = useViagens();
  const cat = useCatalogos();
  const pendViagens = useFilaLocal<PendingViagem>(listPendingViagens);
  const pendIniciar = useFilaLocal<PendingViagemIniciar>(listPendingViagemIniciar);
  const [andamento, setAndamento] = useState<LifecycleLocal | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void getLifecycleLocal().then((l) => {
        if (vivo) setAndamento(l);
      });
      return () => {
        vivo = false;
      };
    }, []),
  );

  return useMemo(() => {
    const locais = new Map((cat.data?.locais ?? []).map((l) => [l.id, l.nome]));
    const placas = new Map((cat.data?.veiculos ?? []).map((v) => [v.id, v.placa]));
    const out: ViagemConhecida[] = [];
    const vistos = new Set<string>();
    const add = (v: ViagemConhecida) => {
      const k = v.clientId ?? v.viagemId ?? v.chave;
      if (vistos.has(k)) return;
      if (v.viagemId) vistos.add(v.viagemId);
      if (v.clientId) vistos.add(v.clientId);
      vistos.add(k);
      out.push(v);
    };

    if (andamento) {
      add({
        chave: `a:${andamento.clientId}`,
        viagemId: null,
        clientId: andamento.clientId,
        rotulo: andamento.localCargaNome
          ? `${andamento.localCargaNome} → …`
          : andamento.clienteNome ?? "Viagem em andamento",
        dia: diaSP(andamento.iniciadoEm),
        inicio: andamento.iniciadoEm,
        emAndamento: true,
        veiculoId: andamento.veiculoId ?? null,
        placa: placas.get(andamento.veiculoId) ?? null,
      });
    }
    for (const p of pendIniciar) {
      const pl = p.payload as Record<string, unknown>;
      const inicio = typeof pl.iniciadoEm === "string" ? pl.iniciadoEm : new Date(p.createdAt).toISOString();
      const veic = typeof pl.veiculoId === "string" ? pl.veiculoId : null;
      add({
        chave: `i:${p.clientId}`,
        viagemId: null,
        clientId: p.clientId,
        rotulo: "Viagem guardada no celular",
        dia: diaSP(inicio),
        inicio,
        emAndamento: false,
        veiculoId: veic,
        placa: veic ? (placas.get(veic) ?? null) : null,
      });
    }
    for (const p of pendViagens) {
      const pl = p.payload as Record<string, unknown>;
      const carga = locais.get(String(pl.localCargaId ?? ""));
      const desc = locais.get(String(pl.localDescargaId ?? ""));
      const dia = typeof pl.data === "string" ? pl.data.slice(0, 10) : diaSP(p.createdAt);
      const veic = typeof pl.veiculoId === "string" ? pl.veiculoId : null;
      add({
        chave: `p:${p.clientId}`,
        viagemId: null,
        clientId: p.clientId,
        rotulo: carga ? (desc ? `${carga} → ${desc}` : carga) : "Viagem guardada no celular",
        dia,
        inicio: null,
        emAndamento: false,
        veiculoId: veic,
        placa: veic ? (placas.get(veic) ?? null) : null,
      });
    }
    for (const v of viagens.data ?? []) {
      add({
        chave: `s:${v.id}`,
        viagemId: v.id,
        clientId: v.clientId ?? null,
        rotulo: rotuloDaViagemServidor(v),
        dia: (v.data ?? "").slice(0, 10),
        inicio: null,
        emAndamento: v.status === "EM_ANDAMENTO",
        veiculoId: v.veiculo?.id ?? null,
        placa: v.veiculo?.placa ?? null,
      });
    }
    return out;
  }, [andamento, pendIniciar, pendViagens, viagens.data, cat.data]);
}

/**
 * A viagem candidata pro "Foi nesta viagem?" — só com o que está no celular:
 * (1) a em andamento; senão (2) a de hoje (a guiada que começou antes da hora
 * do gasto, ou a lançada hoje); senão (3) a das últimas 24 h. Nunca marca nada:
 * só sugere.
 */
export function sugerirViagem(viagens: ViagemConhecida[], instanteISO: string): ViagemConhecida | null {
  const andando = viagens.find((v) => v.emAndamento);
  if (andando) return andando;
  const dia = diaSP(instanteISO);
  const t = new Date(instanteISO).getTime();
  const deHoje = viagens.filter((v) => v.dia === dia && (!v.inicio || new Date(v.inicio).getTime() <= t));
  if (deHoje.length > 0) return deHoje[0]!;
  const ontem = diaSP(t - 24 * 60 * 60 * 1000);
  const recente = viagens.find((v) => v.dia === ontem);
  return recente ?? null;
}

/** As viagens dos últimos `dias` dias (pra "Em qual viagem foi?"). */
export function viagensRecentes(viagens: ViagemConhecida[], dias: number): ViagemConhecida[] {
  const limite = diaSP(Date.now() - dias * 24 * 60 * 60 * 1000);
  return viagens.filter((v) => v.dia >= limite);
}

// ---------------------------------------------------------------------------
// "Gasto guardado" — a faixa verde da tela de onde ele veio
// ---------------------------------------------------------------------------

export type AvisoGastoSalvo = {
  clientId: string;
  /** Pra o "Lançar outro" abrir a lista no mesmo contexto. */
  params: Record<string, string>;
  em: number;
};

let avisoSalvo: AvisoGastoSalvo | null = null;

/** Quem salva marca; a tela de onde ele veio mostra a faixa (uma vez, 4 s). */
export function marcarGastoSalvo(a: Omit<AvisoGastoSalvo, "em">): void {
  avisoSalvo = { ...a, em: Date.now() };
}

/** Pega o aviso (e consome). Aviso de mais de 10 s atrás não vale mais. */
export function pegarAvisoGastoSalvo(): AvisoGastoSalvo | null {
  const a = avisoSalvo;
  avisoSalvo = null;
  if (!a || Date.now() - a.em > 10_000) return null;
  return a;
}

// ---------------------------------------------------------------------------
// Ligar gastos a uma viagem (offline: pela fila do celular)
// ---------------------------------------------------------------------------

export type DestinoGasto =
  | { tipo: "viagem"; viagem: ViagemConhecida }
  | { tipo: "fora" }
  | { tipo: "desfazer" };

/** O que foi feito, pro "Desfazer". */
export type LigacaoFeita = {
  gastos: GastoVisto[];
  /** Operação na fila (gastos já enviados), se houve. */
  opId: string | null;
};

/**
 * Liga os gastos ao destino. Os que ainda estão no celular são editados ali
 * mesmo; os já enviados viram UM item de ligação em lote na fila.
 */
export async function ligarGastos(gs: GastoVisto[], destino: DestinoGasto): Promise<LigacaoFeita> {
  const doCel = gs.filter((g) => g.origem === "celular" && g.clientId).map((g) => g.clientId!);
  const enviados = gs.filter((g) => g.origem === "servidor" && g.despesaId);
  if (doCel.length > 0) {
    await vincularDespesasPendentes(
      doCel,
      destino.tipo === "viagem"
        ? {
            viagemId: destino.viagem.viagemId,
            viagemClientId: destino.viagem.clientId,
            rotulo: destino.viagem.rotulo,
          }
        : destino.tipo === "fora"
          ? { foraDeViagem: true }
          : null,
    );
  }
  let opId: string | null = null;
  if (enviados.length > 0) {
    opId = await enqueueVinculoGasto({
      despesas: enviados.map((g) => g.despesaId!),
      acao: destino.tipo === "viagem" ? "VIAGEM" : destino.tipo === "fora" ? "FORA_DE_VIAGEM" : "DESFAZER",
      viagemId: destino.tipo === "viagem" ? destino.viagem.viagemId : null,
      viagemClientId:
        destino.tipo === "viagem" && !destino.viagem.viagemId ? destino.viagem.clientId : null,
      resumo: {
        quantos: enviados.length,
        valor: enviados.reduce((s, g) => s + g.valorInformado, 0),
        viagemRotulo: destino.tipo === "viagem" ? destino.viagem.rotulo : null,
      },
    });
  }
  return { gastos: gs, opId };
}

/**
 * "Desfazer": volta os gastos pra "sem resposta". Se a ligação ainda não
 * subiu, só tira ela da fila (o servidor nunca soube).
 */
export async function desfazerLigacao(l: LigacaoFeita): Promise<void> {
  const doCel = l.gastos.filter((g) => g.origem === "celular" && g.clientId).map((g) => g.clientId!);
  if (doCel.length > 0) await vincularDespesasPendentes(doCel, null);
  const enviados = l.gastos.filter((g) => g.origem === "servidor" && g.despesaId);
  if (enviados.length === 0) return;
  const naFila = l.opId ? (await listPendingVinculosGasto()).find((v) => v.clientId === l.opId) : null;
  if (naFila && naFila.status !== "syncing") {
    await descartarVinculoGastoPendente(naFila.clientId);
    return;
  }
  await enqueueVinculoGasto({
    despesas: enviados.map((g) => g.despesaId!),
    acao: "DESFAZER",
    resumo: {
      quantos: enviados.length,
      valor: enviados.reduce((s, g) => s + g.valorInformado, 0),
      viagemRotulo: null,
    },
  });
}
