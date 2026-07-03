import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { drenar as drenarEventos, reportarEvento } from "./event-reporter";
import { drenarPosicoes } from "./posicao-sync";
import {
  deletePendingAbastecimento,
  deletePendingEventoViagem,
  deletePendingFoto,
  deletePendingLocal,
  deletePendingPedagio,
  deletePendingViagem,
  deletePendingViagemCancelar,
  deletePendingViagemFinalizar,
  deletePendingViagemIniciar,
  listPendingAbastecimentos,
  listPendingEventosViagem,
  listPendingFotos,
  listPendingLocais,
  listPendingPedagios,
  listPendingViagemCancelar,
  listPendingViagemFinalizar,
  listPendingViagemIniciar,
  listPendingViagens,
  upsertPendingAbastecimento,
  upsertPendingEventoViagem,
  upsertPendingFoto,
  upsertPendingLocal,
  upsertPendingPedagio,
  upsertPendingViagem,
  upsertPendingViagemCancelar,
  upsertPendingViagemFinalizar,
  upsertPendingViagemIniciar,
  type PendingAbastecimento,
  type PendingEventoViagem,
  type PendingFoto,
  type PendingLocal,
  type PendingPedagio,
  type PendingViagem,
  type PendingViagemCancelar,
  type PendingViagemFinalizar,
  type PendingViagemIniciar,
  type ZodIssueSaved,
} from "@/db/database";
import { api, ApiError, getUltimaFalhaRedeAt, humanizeApiError } from "./api";

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
  /** Itens com erro permanente (4xx) que precisam de ação do motorista. */
  comErro: number;
}> {
  const [v, p, a, li, ev, fi] = await Promise.all([
    listPendingViagens(),
    listPendingPedagios(),
    listPendingAbastecimentos(),
    listPendingViagemIniciar(),
    listPendingEventosViagem(),
    listPendingViagemFinalizar(),
  ]);
  const comErro =
    v.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    p.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    a.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    li.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    ev.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    fi.filter((i) => i.attempts >= MAX_ATTEMPTS).length;
  return {
    viagens: v.length,
    pedagios: p.length,
    abastecimentos: a.length,
    lifecycle: li.length + ev.length + fi.length,
    comErro,
  };
}

// Backoff de 4G ruim: quando um envio falha por rede/timeout (marcado em
// api.ts), segura os próximos envios por REDE_BACKOFF_MS. Sem isso, num link
// ruim cada item da fila penduraria até o timeout, um após o outro, roubando
// banda das telas que o motorista está esperando. O setInterval de 60s e o
// listener de reconexão reagendam quando a janela passa.
const REDE_BACKOFF_MS = 20_000;

/** Pode enviar agora? Falso se offline OU numa janela de backoff de rede ruim. */
async function podeEnviar(): Promise<boolean> {
  const net = await NetInfo.fetch();
  if (!net.isConnected) return false;
  if (Date.now() - getUltimaFalhaRedeAt() < REDE_BACKOFF_MS) return false;
  return true;
}

export async function drain(): Promise<void> {
  if (draining) return;
  if (!(await podeEnviar())) return;
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
    await drainPedagios();
    await drainAbastecimentos();
  } finally {
    draining = false;
    notify();
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
    await api.post(`/m/viagens/${item.viagemId}/fotos`, { fotoKey: up.storageKey });
    await deletePendingFoto(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingFoto({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post("/m/locais/rapido", { id: item.clientId, ...item.payload });
    await deletePendingLocal(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingLocal({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post(`/m/viagem/${item.clientId}/cancelar`, {});
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
    await api.post("/m/viagem/iniciar", item.payload);
    await deletePendingViagemIniciar(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingViagemIniciar({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post(`/m/viagem/${item.viagemClientId}/eventos`, payload);
    await deletePendingEventoViagem(item.clientId);
  } catch (err) {
    // 404 = viagem-mãe ainda não sincronizou (ordem) → transiente, retry.
    const permanente = isErroPermanenteLifecycle(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingEventoViagem({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post(`/m/viagem/${item.clientId}/finalizar`, payload);
    await deletePendingViagemFinalizar(item.clientId);
  } catch (err) {
    const permanente = isErroPermanenteLifecycle(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingViagemFinalizar({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post("/m/viagens", payload);
    await deletePendingViagem(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingViagem({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      // Erro permanente (4xx) marca como max attempts pra parar de tentar.
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post("/m/pedagios", item.payload);
    await deletePendingPedagio(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingPedagio({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
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
    await api.post("/m/abastecimentos", payload);
    await deletePendingAbastecimento(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingAbastecimento({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
  }
  notify();
}

let autoSyncStarted = false;

export function startAutoSync(): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      void drain();
      void drenarEventos();
      void drenarPosicoes();
    }
  });

  AppState.addEventListener("change", (s) => {
    if (s === "active") {
      void drain();
      void drenarEventos();
      void drenarPosicoes();
    }
  });

  setInterval(() => {
    void drain();
    void drenarEventos();
    void drenarPosicoes();
  }, 60_000);

  // Boot: dispara depois de 2s pra dar tempo de tudo inicializar.
  setTimeout(() => {
    void drain();
    void drenarEventos();
    void drenarPosicoes();
  }, 2_000);
}
