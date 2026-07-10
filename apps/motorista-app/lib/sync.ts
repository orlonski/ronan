import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { drenar as drenarEventos, reportarEvento } from "./event-reporter";
import { drenarPosicoes } from "./posicao-sync";
import {
  deletePendingAbastecimento,
  deletePendingCompletarPeso,
  deletePendingEventoViagem,
  deletePendingFoto,
  deletePendingLocal,
  deletePendingPedagio,
  deletePendingStory,
  deletePendingViagem,
  deletePendingViagemCancelar,
  deletePendingViagemFinalizar,
  deletePendingViagemIniciar,
  listPendingAbastecimentos,
  listPendingCompletarPeso,
  listPendingEventosViagem,
  listPendingFotos,
  listPendingLocais,
  listPendingPedagios,
  listPendingStories,
  listPendingViagemCancelar,
  listPendingViagemFinalizar,
  listPendingViagemIniciar,
  listPendingViagens,
  upsertPendingAbastecimento,
  upsertPendingCompletarPeso,
  upsertPendingEventoViagem,
  upsertPendingFoto,
  upsertPendingLocal,
  upsertPendingPedagio,
  upsertPendingStory,
  upsertPendingViagem,
  upsertPendingViagemCancelar,
  upsertPendingViagemFinalizar,
  upsertPendingViagemIniciar,
  type PendingAbastecimento,
  type PendingCompletarPeso,
  type PendingEventoViagem,
  type PendingFoto,
  type PendingLocal,
  type PendingPedagio,
  type PendingStory,
  type PendingViagem,
  type PendingViagemCancelar,
  type PendingViagemFinalizar,
  type PendingViagemIniciar,
  type ZodIssueSaved,
} from "@/db/database";
import { api, ApiError, getUltimaFalhaRedeAt, humanizeApiError } from "./api";
import { KeychainLockedError } from "./auth";

type ApiErrorBody = { issues?: ZodIssueSaved[] };

function extractErrorDetails(err: unknown): {
  msg: string;
  status?: number;
  issues?: ZodIssueSaved[];
} {
  const msg = humanizeApiError(err);
  if (err instanceof ApiError) {
    const body = err.body as ApiErrorBody | null;
    const issues = Array.isArray(body?.issues) ? body!.issues : undefined;
    return { msg, status: err.status, issues };
  }
  return { msg };
}

const MAX_ATTEMPTS = 8;

/**
 * Tempo após o qual um item com status="syncing" é considerado órfão.
 * Acontece quando o processo morre no meio do upload de foto / POST viagem
 * (background kill do SO, app fechado, foreground service do tracking
 * competindo). Sem rescue, o item fica eternamente travado — drain skipa
 * todos os "syncing". 5 min cobre folga generosa pro upload legítimo de
 * foto em 3G ruim (timeout configurado é 60s).
 */
const STALE_SYNCING_MS = 5 * 60 * 1000;

/**
 * Erros 4xx do servidor são "permanentes" — não vão dar certo no retry.
 * Pra evitar 8 tentativas inúteis, marca como permanente (attempts =
 * MAX_ATTEMPTS) e o motorista resolve no app (editando ou descartando).
 *
 * Critério: ApiError com status 4xx, exceto 408/429 (timeout/rate limit
 * que podem se resolver com retry).
 */
function isErroPermanente(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status >= 500) return false;
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

/**
 * Como isErroPermanente, mas 404 é TRANSIENTE no lifecycle: um evento ou
 * finalizar pode chegar antes da viagem-mãe sincronizar (ordem de rede). O
 * gate no drain já evita isso na maioria dos casos, mas o 404 é a rede de
 * segurança — retry, não erro permanente.
 */
function isErroPermanenteLifecycle(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 404) return false;
  return isErroPermanente(err);
}

let draining = false;
const listeners = new Set<() => void>();

export function onSyncChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Apaga uma viagem pendente do outbox (motorista pode descartar antes
 * de sincronizar). Dispara notify pra UI re-renderizar.
 */
export async function descartarViagemPendente(clientId: string): Promise<void> {
  await deletePendingViagem(clientId);
  notify();
}

/**
 * Substitui payload/foto de uma viagem pendente existente (mesma clientId).
 * Usado quando o motorista edita uma viagem que ficou travada com erro.
 * Reseta attempts e status pra disparar nova tentativa imediata.
 *
 * Se a viagem sumiu (drain bem-sucedido entre abrir o form e salvar),
 * retorna { removed: true } pra UI poder avisar o motorista.
 */
export async function atualizarViagemPendente(input: {
  clientId: string;
  payload: Record<string, unknown>;
  foto?: { uri: string; mime: string };
}): Promise<{ removed: boolean }> {
  const list = await listPendingViagens();
  const existing = list.find((x) => x.clientId === input.clientId);
  if (!existing) return { removed: true };

  // Foto: se motorista mandou nova, usa nova; se não mandou, mantém o que tinha.
  const fotoUri = input.foto?.uri ?? existing.fotoUri;
  const fotoMime = input.foto?.mime ?? existing.fotoMime;

  await upsertPendingViagem({
    clientId: existing.clientId,
    payload: input.payload,
    fotoUri,
    fotoMime,
    status: "pending",
    attempts: 0,
    createdAt: existing.createdAt,
    lastTriedAt: undefined,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
  return { removed: false };
}

/**
 * Reseta o estado de erro de uma viagem pendente e dispara nova
 * tentativa de sync. Usa quando o motorista quer tentar de novo
 * após erro 4xx permanente (que parou os retries automáticos).
 */
export async function tentarNovamenteViagemPendente(
  clientId: string,
): Promise<void> {
  const list = await listPendingViagens();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingViagem({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

/**
 * Substitui payload/foto de um abastecimento pendente existente (mesma
 * clientId). Usado quando o motorista edita um abastecimento que ficou travado
 * com erro (ex: corrigir o odômetro que o servidor recusou). Reseta attempts e
 * status pra disparar nova tentativa imediata. Se sumiu (drain entre abrir o
 * form e salvar), retorna { removed: true }.
 */
export async function atualizarAbastecimentoPendente(input: {
  clientId: string;
  payload: Record<string, unknown>;
  foto?: { uri: string; mime: string };
}): Promise<{ removed: boolean }> {
  const list = await listPendingAbastecimentos();
  const existing = list.find((x) => x.clientId === input.clientId);
  if (!existing) return { removed: true };

  const fotoUri = input.foto?.uri ?? existing.fotoUri;
  const fotoMime = input.foto?.mime ?? existing.fotoMime;

  await upsertPendingAbastecimento({
    clientId: existing.clientId,
    payload: input.payload,
    fotoUri,
    fotoMime,
    status: "pending",
    attempts: 0,
    createdAt: existing.createdAt,
    lastTriedAt: undefined,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
  return { removed: false };
}

export async function descartarPedagioPendente(clientId: string): Promise<void> {
  await deletePendingPedagio(clientId);
  notify();
}

export async function tentarNovamentePedagioPendente(
  clientId: string,
): Promise<void> {
  const list = await listPendingPedagios();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingPedagio({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

export async function tentarNovamenteAbastecimentoPendente(
  clientId: string,
): Promise<void> {
  const list = await listPendingAbastecimentos();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingAbastecimento({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

export async function enqueueViagem(
  payload: Record<string, unknown>,
  foto?: { uri: string; mime: string },
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingViagem({
    clientId,
    payload,
    fotoUri: foto?.uri,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function enqueuePedagio(payload: Record<string, unknown>): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingPedagio({
    clientId,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function enqueueAbastecimento(
  payload: Record<string, unknown>,
  foto?: { uri: string; mime: string },
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingAbastecimento({
    clientId,
    payload,
    fotoUri: foto?.uri,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/**
 * Enfileira uma foto pra anexar em viagem JÁ sincronizada. Motorista
 * abre detalhe da viagem e adiciona foto que esqueceu. Drain faz 2-step:
 * sobe a foto via /m/uploads/ticket, depois POST /m/viagens/:id/fotos.
 */
export async function enqueueFoto(item: {
  viagemId: string;
  fotoUri: string;
  fotoMime: string;
}): Promise<void> {
  const clientId = `${item.viagemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await upsertPendingFoto({
    clientId,
    viagemId: item.viagemId,
    fotoUri: item.fotoUri,
    fotoMime: item.fotoMime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/**
 * Enfileira um story (foto do trecho, estilo Instagram). Fica no outbox pra
 * postar mesmo sem sinal — sincroniza quando a rede voltar. clientId é o UUID
 * já gerado pelo chamador (vira o clientId do story no backend).
 */
export async function enqueueStory(item: {
  clientId: string;
  fotoUri: string;
  fotoMime: string;
  legenda?: string;
  lat?: number;
  lng?: number;
}): Promise<void> {
  await upsertPendingStory({
    clientId: item.clientId,
    fotoUri: item.fotoUri,
    fotoMime: item.fotoMime,
    legenda: item.legenda,
    lat: item.lat,
    lng: item.lng,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/**
 * Enfileira o "completar peso" de uma viagem que está em AGUARDANDO_PESO
 * (romaneio saiu no fim do dia). viagemId é o id real do servidor. Idempotente
 * por viagemId: reenfileirar (ex: motorista corrigiu o ticket) substitui o
 * item e reseta attempts/erro pra tentar de novo na hora.
 */
export async function enqueueCompletarPeso(item: {
  viagemId: string;
  toneladas: number;
  ticket?: string;
}): Promise<void> {
  await upsertPendingCompletarPeso({
    clientId: `${item.viagemId}-completar`,
    viagemId: item.viagemId,
    payload: { toneladas: item.toneladas, ticket: item.ticket },
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
    lastTriedAt: undefined,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

/** Reseta o erro e tenta completar o peso de novo (após 4xx permanente). */
export async function tentarNovamenteCompletarPeso(viagemId: string): Promise<void> {
  const list = await listPendingCompletarPeso();
  const item = list.find((x) => x.viagemId === viagemId);
  if (!item) return;
  await upsertPendingCompletarPeso({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

/** Descarta a tentativa de completar peso (a viagem segue AGUARDANDO_PESO). */
export async function descartarCompletarPesoPendente(viagemId: string): Promise<void> {
  await deletePendingCompletarPeso(viagemId);
  notify();
}

/**
 * Enfileira a criação de um local novo (descarga em lugar nunca visto).
 * clientId é o UUID gerado client-side, vira o id real no servidor pra
 * idempotência. A viagem que referencia esse local usa o mesmo clientId
 * como localDescargaId — drain processa locais antes de viagens (FK).
 */
export async function enqueueLocal(item: PendingLocal): Promise<void> {
  await upsertPendingLocal(item);
  void reportarEvento("local_criado", {
    nome: item.payload.nome,
    lat: item.payload.lat,
    lng: item.payload.lng,
    tipo: item.payload.tipo,
  });
  notify();
  void drain();
}

export async function descartarAbastecimentoPendente(clientId: string): Promise<void> {
  await deletePendingAbastecimento(clientId);
  notify();
}

// ---- Lifecycle guiado: iniciar / eventos / finalizar ----

export async function enqueueViagemIniciar(
  payload: Record<string, unknown>,
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingViagemIniciar({
    clientId,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function enqueueEventoViagem(
  viagemClientId: string,
  payload: Record<string, unknown>,
  foto?: { uri: string; mime: string },
): Promise<void> {
  const clientId = payload.id as string; // id do evento = idempotência
  await upsertPendingEventoViagem({
    clientId,
    viagemClientId,
    payload,
    fotoUri: foto?.uri,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function enqueueViagemFinalizar(
  viagemClientId: string,
  payload: Record<string, unknown>,
  foto?: { uri: string; mime: string },
): Promise<void> {
  await upsertPendingViagemFinalizar({
    clientId: viagemClientId,
    payload,
    fotoUri: foto?.uri,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/**
 * Enfileira o cancelamento (descarte) de uma viagem em andamento no servidor.
 * Idempotente no backend. Sincroniza quando houver rede.
 */
export async function enqueueViagemCancelar(viagemClientId: string): Promise<void> {
  await upsertPendingViagemCancelar({
    clientId: viagemClientId,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/** Remove do outbox todos os itens (iniciar/eventos/finalizar) de uma viagem. */
export async function removerItensLifecycleDaViagem(viagemClientId: string): Promise<void> {
  await deletePendingViagemIniciar(viagemClientId);
  await deletePendingViagemFinalizar(viagemClientId);
  for (const e of await listPendingEventosViagem()) {
    if (e.viagemClientId === viagemClientId) await deletePendingEventoViagem(e.clientId);
  }
  notify();
}

/** Reseta o erro dos estágios de uma viagem guiada e dispara nova tentativa. */
export async function tentarNovamenteTripLifecycle(viagemClientId: string): Promise<void> {
  const reset = { status: "pending" as const, attempts: 0, errorMsg: undefined, errorStatus: undefined, errorIssues: undefined };
  const ini = (await listPendingViagemIniciar()).find((x) => x.clientId === viagemClientId);
  if (ini) await upsertPendingViagemIniciar({ ...ini, ...reset });
  for (const e of await listPendingEventosViagem()) {
    if (e.viagemClientId === viagemClientId) await upsertPendingEventoViagem({ ...e, ...reset });
  }
  const fin = (await listPendingViagemFinalizar()).find((x) => x.clientId === viagemClientId);
  if (fin) await upsertPendingViagemFinalizar({ ...fin, ...reset });
  notify();
  void drain();
}

export async function pendingCounts(): Promise<{
  viagens: number;
  pedagios: number;
  abastecimentos: number;
  /** Itens do lifecycle guiado aguardando sync (iniciar+eventos+finalizar). */
  lifecycle: number;
  /** "Completar peso" de viagens AGUARDANDO_PESO aguardando sync. */
  completarPeso: number;
  /** Itens com erro permanente (4xx) que precisam de ação do motorista. */
  comErro: number;
}> {
  const [v, p, a, li, ev, fi, cp] = await Promise.all([
    listPendingViagens(),
    listPendingPedagios(),
    listPendingAbastecimentos(),
    listPendingViagemIniciar(),
    listPendingEventosViagem(),
    listPendingViagemFinalizar(),
    listPendingCompletarPeso(),
  ]);
  const comErro =
    v.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    p.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    a.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    li.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    ev.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    fi.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    cp.filter((i) => i.attempts >= MAX_ATTEMPTS).length;
  return {
    viagens: v.length,
    pedagios: p.length,
    abastecimentos: a.length,
    lifecycle: li.length + ev.length + fi.length,
    completarPeso: cp.length,
    comErro,
  };
}

// Backoff de 4G ruim: quando um envio falha por rede/timeout (marcado em
// api.ts), segura os próximos envios por REDE_BACKOFF_MS. Sem isso, num link
// ruim cada item da fila penduraria até o timeout, um após o outro, roubando
// banda das telas que o motorista está esperando. O setInterval de 60s e o
// listener de reconexão reagendam quando a janela passa.
const REDE_BACKOFF_MS = 20_000;

// Sync manual ("Sincronizar agora") é intenção explícita do motorista: ignora
// o backoff de rede. Flag de módulo em vez de threadar `force` por todos os
// drainX.
let forcandoSync = false;

/**
 * Pode tentar enviar agora? **NÃO** consulta `NetInfo.isConnected`: no iOS ele
 * MENTE — retorna "offline" mesmo com internet OK (visto no device do dono), e
 * isso travava o sync inteiro (o motorista tinha internet e nada subia). A
 * verdade é a própria requisição: se a rede estiver ruim de verdade, o POST
 * falha e o item fica transitório (retenta). Aqui só respeitamos o backoff
 * pós-falha, pra não marretar num link ruim — e o sync forçado pula até isso.
 */
async function podeEnviar(): Promise<boolean> {
  if (!forcandoSync && Date.now() - getUltimaFalhaRedeAt() < REDE_BACKOFF_MS)
    return false;
  return true;
}

export type DrainResumo = {
  enviados: number;
  restantes: number;
  /** Motivo da última falha ainda pendente — pra UI mostrar o porquê. */
  ultimoMotivo?: string;
  /** true se já havia um sync em andamento (não iniciou outro). */
  emAndamento?: boolean;
};

/** Total de itens no outbox (todos os tipos) + o motivo da última falha salva. */
async function snapshotPendentes(): Promise<{ total: number; motivo?: string }> {
  const listas = await Promise.all([
    listPendingViagens(),
    listPendingPedagios(),
    listPendingAbastecimentos(),
    listPendingLocais(),
    listPendingFotos(),
    listPendingStories(),
    listPendingCompletarPeso(),
    listPendingViagemIniciar(),
    listPendingEventosViagem(),
    listPendingViagemFinalizar(),
    listPendingViagemCancelar(),
  ]);
  const todos = listas.flat();
  const motivo = todos.map((i) => i.errorMsg).find(Boolean) ?? undefined;
  return { total: todos.length, motivo };
}

export async function drain(opts?: { force?: boolean }): Promise<DrainResumo> {
  if (draining) {
    const { total, motivo } = await snapshotPendentes();
    return { enviados: 0, restantes: total, ultimoMotivo: motivo, emAndamento: true };
  }
  if (opts?.force) forcandoSync = true;
  try {
    if (!(await podeEnviar())) {
      const { total, motivo } = await snapshotPendentes();
      return { enviados: 0, restantes: total, ultimoMotivo: motivo };
    }
    const antes = await snapshotPendentes();
    draining = true;
    try {
    // Destrava itens com status="syncing" órfão de drain anterior morto
    // no meio do envio. Backend é idempotente (clientId @unique), retry
    // seguro — retorna existente em vez de duplicar.
    await rescueStaleItems();
    // Locais ANTES de viagens: viagens podem ter localDescargaId apontando
    // pra um local pendente. Se a viagem chegar primeiro, FK violation.
    await drainLocais();
    // Cancelamentos primeiro (descarte de viagem em andamento).
    await drainViagemCancelar();
    // Lifecycle guiado, em ordem: iniciar (cria a viagem) → eventos → finalizar.
    // Gates internos garantem que evento/finalizar só vão depois da viagem-mãe.
    await drainViagemIniciar();
    await drainEventosViagem();
    await drainViagemFinalizar();
    await drainViagens();
    // Fotos DEPOIS de viagens: foto pode estar referenciando viagem que
    // acabou de ser sincronizada (raro mas possível).
    await drainFotos();
    // Completar peso: age sobre viagem JÁ sincronizada (AGUARDANDO_PESO).
    await drainCompletarPeso();
    await drainPedagios();
    await drainAbastecimentos();
    await drainStories();
    } finally {
      draining = false;
      notify();
    }
    const depois = await snapshotPendentes();
    return {
      enviados: Math.max(0, antes.total - depois.total),
      restantes: depois.total,
      ultimoMotivo: depois.motivo,
    };
  } finally {
    forcandoSync = false;
  }
}

async function rescueStaleItems(): Promise<void> {
  const limite = Date.now() - STALE_SYNCING_MS;
  const isStale = (lastTriedAt?: number) =>
    !lastTriedAt || lastTriedAt < limite;

  for (const v of await listPendingViagens()) {
    if (v.status === "syncing" && isStale(v.lastTriedAt)) {
      await upsertPendingViagem({ ...v, status: "pending" });
    }
  }
  for (const l of await listPendingLocais()) {
    if (l.status === "syncing" && isStale(l.lastTriedAt)) {
      await upsertPendingLocal({ ...l, status: "pending" });
    }
  }
  for (const p of await listPendingPedagios()) {
    if (p.status === "syncing" && isStale(p.lastTriedAt)) {
      await upsertPendingPedagio({ ...p, status: "pending" });
    }
  }
  for (const a of await listPendingAbastecimentos()) {
    if (a.status === "syncing" && isStale(a.lastTriedAt)) {
      await upsertPendingAbastecimento({ ...a, status: "pending" });
    }
  }
  for (const f of await listPendingFotos()) {
    if (f.status === "syncing" && isStale(f.lastTriedAt)) {
      await upsertPendingFoto({ ...f, status: "pending" });
    }
  }
  for (const s of await listPendingStories()) {
    if (s.status === "syncing" && isStale(s.lastTriedAt)) {
      await upsertPendingStory({ ...s, status: "pending" });
    }
  }
  for (const cp of await listPendingCompletarPeso()) {
    if (cp.status === "syncing" && isStale(cp.lastTriedAt)) {
      await upsertPendingCompletarPeso({ ...cp, status: "pending" });
    }
  }
  for (const i of await listPendingViagemIniciar()) {
    if (i.status === "syncing" && isStale(i.lastTriedAt)) {
      await upsertPendingViagemIniciar({ ...i, status: "pending" });
    }
  }
  for (const e of await listPendingEventosViagem()) {
    if (e.status === "syncing" && isStale(e.lastTriedAt)) {
      await upsertPendingEventoViagem({ ...e, status: "pending" });
    }
  }
  for (const f of await listPendingViagemFinalizar()) {
    if (f.status === "syncing" && isStale(f.lastTriedAt)) {
      await upsertPendingViagemFinalizar({ ...f, status: "pending" });
    }
  }
  for (const c of await listPendingViagemCancelar()) {
    if (c.status === "syncing" && isStale(c.lastTriedAt)) {
      await upsertPendingViagemCancelar({ ...c, status: "pending" });
    }
  }
}

async function drainFotos(): Promise<void> {
  const list = await listPendingFotos();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processFoto(item);
  }
}

async function processFoto(item: PendingFoto): Promise<void> {
  await upsertPendingFoto({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // 2-step: sobe a foto pro MinIO pegando storageKey, depois associa à viagem.
    const fd = new FormData();
    const filename = `ticket-${item.clientId}.${
      item.fotoMime.includes("png") ? "png" : "jpg"
    }`;
    fd.append("foto", {
      uri: item.fotoUri,
      type: item.fotoMime,
      name: filename,
    } as unknown as Blob);
    const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
    await api.post(`/m/viagens/${item.viagemId}/fotos`, { fotoKey: up.storageKey }, { outbox: true });
    await deletePendingFoto(item.clientId);
  } catch (err) {
    await upsertPendingFoto(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

async function drainStories(): Promise<void> {
  const list = await listPendingStories();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processStory(item);
  }
}

async function processStory(item: PendingStory): Promise<void> {
  await upsertPendingStory({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // 2-step: sobe a foto pro MinIO pegando storageKey, depois cria o story.
    const fd = new FormData();
    const filename = `story-${item.clientId}.${
      item.fotoMime.includes("png") ? "png" : "jpg"
    }`;
    fd.append("foto", {
      uri: item.fotoUri,
      type: item.fotoMime,
      name: filename,
    } as unknown as Blob);
    const up = await api.postForm<{ storageKey: string }>("/m/uploads/story", fd);
    await api.post(
      "/m/stories",
      {
        clientId: item.clientId,
        fotoKey: up.storageKey,
        legenda: item.legenda,
        lat: item.lat,
        lng: item.lng,
      },
      { outbox: true },
    );
    await deletePendingStory(item.clientId);
  } catch (err) {
    await upsertPendingStory(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

async function drainCompletarPeso(): Promise<void> {
  const list = await listPendingCompletarPeso();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processCompletarPeso(item);
  }
}

async function processCompletarPeso(item: PendingCompletarPeso): Promise<void> {
  await upsertPendingCompletarPeso({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // Idempotente no backend: se já foi completada (ENVIADA), devolve a existente.
    await api.post(`/m/viagens/${item.viagemId}/completar-peso`, item.payload, { outbox: true });
    await deletePendingCompletarPeso(item.viagemId);
  } catch (err) {
    await upsertPendingCompletarPeso(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

export async function drainLocais(): Promise<void> {
  const list = await listPendingLocais();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processLocal(item);
  }
}

async function processLocal(item: PendingLocal): Promise<void> {
  await upsertPendingLocal({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // Idempotência: backend usa o clientId como id; reenvio retorna o existente.
    await api.post("/m/locais/rapido", { id: item.clientId, ...item.payload }, { outbox: true });
    await deletePendingLocal(item.clientId);
  } catch (err) {
    await upsertPendingLocal(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

// ---- Lifecycle drains (cancelar primeiro; depois iniciar → eventos → finalizar) ----

async function drainViagemCancelar(): Promise<void> {
  const list = await listPendingViagemCancelar();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processViagemCancelar(item);
  }
}

async function processViagemCancelar(item: PendingViagemCancelar): Promise<void> {
  await upsertPendingViagemCancelar({ ...item, status: "syncing", lastTriedAt: Date.now() });
  try {
    await api.post(`/m/viagem/${item.clientId}/cancelar`, {}, { outbox: true });
    await deletePendingViagemCancelar(item.clientId);
  } catch (err) {
    // 4xx (ex: não é sua / já não existe): nada mais a fazer, remove.
    // 5xx/rede: tenta de novo depois.
    if (isErroPermanente(err)) {
      await deletePendingViagemCancelar(item.clientId);
    } else {
      const { msg, status } = extractErrorDetails(err);
      await upsertPendingViagemCancelar({
        ...item,
        status: "error",
        errorMsg: msg,
        errorStatus: status,
        attempts: item.attempts + 1,
      });
    }
  }
  notify();
}

async function drainViagemIniciar(): Promise<void> {
  const list = await listPendingViagemIniciar();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processViagemIniciar(item);
  }
}

async function processViagemIniciar(item: PendingViagemIniciar): Promise<void> {
  await upsertPendingViagemIniciar({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // Idempotente por clientId — reenvio retorna a viagem existente.
    await api.post("/m/viagem/iniciar", item.payload, { outbox: true });
    await deletePendingViagemIniciar(item.clientId);
  } catch (err) {
    await upsertPendingViagemIniciar(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

async function drainEventosViagem(): Promise<void> {
  const list = await listPendingEventosViagem();
  // Gate: só envia evento cuja viagem-mãe já saiu da fila de iniciar.
  const iniciarPendentes = new Set(
    (await listPendingViagemIniciar()).map((i) => i.clientId),
  );
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (iniciarPendentes.has(item.viagemClientId)) continue; // aguarda viagem-mãe
    if (!(await podeEnviar())) return;
    await processEventoViagem(item);
  }
}

async function processEventoViagem(item: PendingEventoViagem): Promise<void> {
  await upsertPendingEventoViagem({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoUri && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `evento-${item.clientId}.${
        item.fotoMime?.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: item.fotoUri,
        type: item.fotoMime ?? "image/jpeg",
        name: filename,
      } as unknown as Blob);
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      await upsertPendingEventoViagem({
        ...item,
        payload,
        fotoUri: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post(`/m/viagem/${item.viagemClientId}/eventos`, payload, { outbox: true });
    await deletePendingEventoViagem(item.clientId);
  } catch (err) {
    // 404 = viagem-mãe ainda não sincronizou (ordem) → transiente, retry.
    await upsertPendingEventoViagem(proximoEstadoFalha(item, err, isErroPermanenteLifecycle(err)));
  }
  notify();
}

async function drainViagemFinalizar(): Promise<void> {
  const list = await listPendingViagemFinalizar();
  // Gate: só finaliza depois que a viagem-mãe E todos os eventos dela saíram.
  const iniciarPendentes = new Set(
    (await listPendingViagemIniciar()).map((i) => i.clientId),
  );
  const eventosPorViagem = new Map<string, number>();
  for (const e of await listPendingEventosViagem()) {
    eventosPorViagem.set(e.viagemClientId, (eventosPorViagem.get(e.viagemClientId) ?? 0) + 1);
  }
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (iniciarPendentes.has(item.clientId)) continue; // aguarda iniciar
    if ((eventosPorViagem.get(item.clientId) ?? 0) > 0) continue; // aguarda eventos
    if (!(await podeEnviar())) return;
    await processViagemFinalizar(item);
  }
}

async function processViagemFinalizar(item: PendingViagemFinalizar): Promise<void> {
  await upsertPendingViagemFinalizar({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoUri && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `ticket-${item.clientId}.${
        item.fotoMime?.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: item.fotoUri,
        type: item.fotoMime ?? "image/jpeg",
        name: filename,
      } as unknown as Blob);
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      await upsertPendingViagemFinalizar({
        ...item,
        payload,
        fotoUri: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post(`/m/viagem/${item.clientId}/finalizar`, payload, { outbox: true });
    await deletePendingViagemFinalizar(item.clientId);
  } catch (err) {
    await upsertPendingViagemFinalizar(proximoEstadoFalha(item, err, isErroPermanenteLifecycle(err)));
  }
  notify();
}

async function drainViagens(): Promise<void> {
  const list = await listPendingViagens();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processViagem(item);
  }
}

async function processViagem(item: PendingViagem): Promise<void> {
  await upsertPendingViagem({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoUri && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `ticket-${item.clientId}.${
        item.fotoMime?.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: item.fotoUri,
        type: item.fotoMime ?? "image/jpeg",
        name: filename,
      } as unknown as Blob);
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      // Marca foto como já subida pra não tentar de novo se viagem falhar depois
      await upsertPendingViagem({
        ...item,
        payload,
        fotoUri: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post("/m/viagens", payload, { outbox: true });
    await deletePendingViagem(item.clientId);
  } catch (err) {
    await upsertPendingViagem(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

async function drainPedagios(): Promise<void> {
  const list = await listPendingPedagios();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processPedagio(item);
  }
}

async function processPedagio(item: PendingPedagio): Promise<void> {
  await upsertPendingPedagio({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    await api.post("/m/pedagios", item.payload, { outbox: true });
    await deletePendingPedagio(item.clientId);
  } catch (err) {
    await upsertPendingPedagio(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

async function drainAbastecimentos(): Promise<void> {
  const list = await listPendingAbastecimentos();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeEnviar())) return;
    await processAbastecimento(item);
  }
}

async function processAbastecimento(item: PendingAbastecimento): Promise<void> {
  await upsertPendingAbastecimento({
    ...item,
    status: "syncing",
    lastTriedAt: Date.now(),
  });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoUri && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `abast-${item.clientId}.${
        item.fotoMime?.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: item.fotoUri,
        type: item.fotoMime ?? "image/jpeg",
        name: filename,
      } as unknown as Blob);
      const up = await api.postForm<{ storageKey: string }>(
        "/m/uploads/abastecimento",
        fd,
      );
      payload = { ...payload, fotoKey: up.storageKey };
      // Marca foto como já subida pra não tentar de novo se abast falhar depois
      await upsertPendingAbastecimento({
        ...item,
        payload,
        fotoUri: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post("/m/abastecimentos", payload, { outbox: true });
    await deletePendingAbastecimento(item.clientId);
  } catch (err) {
    await upsertPendingAbastecimento(proximoEstadoFalha(item, err, isErroPermanente(err)));
  }
  notify();
}

let autoSyncStarted = false;

type ComErro = {
  status: "pending" | "syncing" | "error";
  attempts: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

/**
 * Erro transitório de envio: NÃO deve matar o lançamento em FALHOU nem consumir
 * tentativa — o item espera a condição passar e retenta sozinho. Cobre:
 *  - sem sinal / timeout (TypeError de traduzirErroFetch) — realidade de 4G ruim
 *    de caminhoneiro; um lançamento nunca deve morrer por falta de sinal;
 *  - servidor 5xx / 408 / 429 — problema momentâneo do backend;
 *  - Keychain travado (device bloqueado) — ver lib/auth.ts.
 * Só 4xx real (dado inválido, precisa editar) e erros desconhecidos consomem
 * tentativa até MAX_ATTEMPTS.
 */
function isErroTransitorio(err: unknown): boolean {
  if (err instanceof KeychainLockedError) return true;
  if (err instanceof TypeError) return true; // rede/timeout
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return false;
}

/**
 * Estado do item depois de uma falha de envio. Transitório → volta pra "pending"
 * (aguardando sinal), sem tocar em attempts, pra retentar quando der. Permanente
 * (4xx) → "error" no teto de tentativas. Desconhecido → "error" incrementando.
 */
function proximoEstadoFalha<T extends ComErro>(
  item: T,
  err: unknown,
  permanente: boolean,
): T {
  if (isErroTransitorio(err)) {
    // Preserva a causa (informativo, NÃO vira FALHOU vermelho): o item fica
    // "pending" e a tela mostra "Última tentativa: <motivo>" pra dar
    // visibilidade em vez de sumir em silêncio. Sem tocar em attempts.
    const { msg } = extractErrorDetails(err);
    return {
      ...item,
      status: "pending",
      lastTriedAt: Date.now(),
      errorMsg: msg,
      errorStatus: undefined,
      errorIssues: undefined,
    };
  }
  const { msg, status, issues } = extractErrorDetails(err);
  return {
    ...item,
    status: "error",
    errorMsg: msg,
    errorStatus: status,
    errorIssues: issues,
    attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
  };
}

function resetItem<T extends ComErro>(item: T): T {
  return {
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  };
}

/** Uma falha salva como "error" que na verdade era transitória (rede/keychain/
 * 5xx) — não um 4xx de dado inválido. Esses não deviam ter morrido em FALHOU. */
function falhaSalvaEhTransitoria(item: ComErro): boolean {
  const s = item.errorStatus;
  if (s === undefined) return true; // sem status HTTP: rede/keychain/desconhecido
  if (s === 408 || s === 429) return true;
  return s >= 500; // 4xx real fica pro motorista editar
}

/**
 * Destrava no boot lançamentos que morreram em FALHOU por causa transitória:
 * Keychain travado (device bloqueado) OU rede ruim que queimou as 8 tentativas.
 * Reseta pra "pending" e ressincroniza sozinho, sem o motorista tocar "Tentar de
 * novo". Erros 4xx reais (dado inválido) ficam como estão, pra editar.
 */
export async function recuperarItensPresos(): Promise<void> {
  let mexeu = false;
  const varrer = async <T extends ComErro & { clientId: string }>(
    lista: T[],
    upsert: (item: T) => Promise<void>,
  ) => {
    for (const item of lista) {
      if (item.status === "error" && falhaSalvaEhTransitoria(item)) {
        await upsert(resetItem(item));
        mexeu = true;
      }
    }
  };

  await varrer(await listPendingViagens(), upsertPendingViagem);
  await varrer(await listPendingPedagios(), upsertPendingPedagio);
  await varrer(await listPendingAbastecimentos(), upsertPendingAbastecimento);
  await varrer(await listPendingLocais(), upsertPendingLocal);
  await varrer(await listPendingFotos(), upsertPendingFoto);
  await varrer(await listPendingStories(), upsertPendingStory);
  await varrer(await listPendingCompletarPeso(), upsertPendingCompletarPeso);
  await varrer(await listPendingViagemIniciar(), upsertPendingViagemIniciar);
  await varrer(await listPendingEventosViagem(), upsertPendingEventoViagem);
  await varrer(await listPendingViagemFinalizar(), upsertPendingViagemFinalizar);
  await varrer(await listPendingViagemCancelar(), upsertPendingViagemCancelar);

  if (mexeu) {
    notify();
    void drain();
  }
}

// Dispara os três drains (outbox + eventos + posições). Sem gate de Keychain: se
// a leitura do token falhar por device travado, o tratamento por-item já cuida
// (KeychainLockedError = transitório, não queima tentativa). Um gate aqui virava
// ponto único de falha total do sync no iOS.
function drenarTudo(): void {
  void drain();
  void drenarEventos();
  void drenarPosicoes();
}

export function startAutoSync(): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  NetInfo.addEventListener((state) => {
    if (state.isConnected) void drenarTudo();
  });

  AppState.addEventListener("change", (s) => {
    if (s === "active") void drenarTudo();
  });

  setInterval(() => {
    void drenarTudo();
  }, 60_000);

  // Boot: dispara depois de 2s pra dar tempo de tudo inicializar.
  setTimeout(() => {
    void drenarTudo();
  }, 2_000);
}
