import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import { drenar as drenarEventos, reportarEvento } from "./event-reporter";
import { reportarErro } from "./error-reporter";
import { drenarPosicoes } from "./posicao-sync";
import {
  deletePendingAbastecimento,
  deletePendingCompletarPeso,
  deletePendingEventoViagem,
  deletePendingFoto,
  deletePendingLocal,
  deletePendingMensagemChat,
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
  listPendingMensagensChat,
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
  upsertPendingMensagemChat,
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
  type PendingMensagemChat,
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
    errorPermanenteLocal: undefined,
  });
  notify();
  void drain();
  return { removed: false };
}

/**
 * Substitui campos do payload de um FINALIZAR guiado preso (mesmo clientId).
 * Usado quando o finalize falhou com 4xx real (ex: "toneladas acima do máximo")
 * e o motorista corrige na tela de edição. Merge no payload (preserva
 * km/descarga/material/rota/etc), reseta status/attempts/erro e re-dispara o
 * drain. Idempotente pelo mesmo clientId — o backend reenvia sobre a viagem
 * que continua EM_ANDAMENTO (o 400 aborta antes do update). Se sumiu (drain
 * entre abrir e salvar), retorna { removed: true }.
 */
export async function atualizarViagemFinalizarPendente(input: {
  clientId: string;
  patch: Record<string, unknown>;
  foto?: { uri: string; mime: string };
}): Promise<{ removed: boolean }> {
  const list = await listPendingViagemFinalizar();
  const existing = list.find((x) => x.clientId === input.clientId);
  if (!existing) return { removed: true };

  const payload = { ...existing.payload, ...input.patch };
  let fotoUri = existing.fotoUri;
  let fotoMime = existing.fotoMime;
  if (input.foto) {
    // Foto nova → re-upload: descarta a fotoKey já subida do payload antigo.
    fotoUri = input.foto.uri;
    fotoMime = input.foto.mime;
    delete payload.fotoKey;
  }

  await upsertPendingViagemFinalizar({
    ...existing,
    payload,
    fotoUri,
    fotoMime,
    status: "pending",
    attempts: 0,
    lastTriedAt: undefined,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
    errorPermanenteLocal: undefined,
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
    errorPermanenteLocal: undefined,
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
    errorPermanenteLocal: undefined,
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
    errorPermanenteLocal: undefined,
  });
  notify();
  void drain();
}

/**
 * Descartar / tentar de novo os tipos que a tela de Pendentes passou a mostrar
 * (foto avulsa, local criado offline, story). Antes eles não tinham nenhuma
 * ação de UI: um item travado desses ficava preso pra sempre, invisível.
 */
export async function descartarFotoPendente(clientId: string): Promise<void> {
  await deletePendingFoto(clientId);
  notify();
}

export async function tentarNovamenteFotoPendente(clientId: string): Promise<void> {
  const item = (await listPendingFotos()).find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingFoto(resetItem(item));
  notify();
  void drain();
}

export async function descartarLocalPendente(clientId: string): Promise<void> {
  await deletePendingLocal(clientId);
  notify();
}

export async function tentarNovamenteLocalPendente(clientId: string): Promise<void> {
  const item = (await listPendingLocais()).find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingLocal(resetItem(item));
  notify();
  void drain();
}

export async function descartarStoryPendente(clientId: string): Promise<void> {
  await deletePendingStory(clientId);
  notify();
}

export async function tentarNovamenteStoryPendente(clientId: string): Promise<void> {
  const item = (await listPendingStories()).find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingStory(resetItem(item));
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
    errorPermanenteLocal: undefined,
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
 * Enfileira uma mensagem de chat. Sai do outbox quando houver sinal — o
 * motorista escreve no meio do nada e a mensagem vai sozinha depois.
 */
export async function enqueueMensagemChat(item: {
  clientId: string;
  conversaId: string;
  texto: string;
}): Promise<void> {
  await upsertPendingMensagemChat({
    clientId: item.clientId,
    conversaId: item.conversaId,
    texto: item.texto,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/** Mensagens da conversa que ainda não subiram (bolhas com relógio). */
export async function mensagensChatPendentes(
  conversaId: string,
): Promise<PendingMensagemChat[]> {
  const list = await listPendingMensagensChat();
  return list.filter((m) => m.conversaId === conversaId);
}

/** Motorista tocou em "tentar de novo" numa bolha que falhou. */
export async function tentarNovamenteMensagemChat(clientId: string): Promise<void> {
  const list = await listPendingMensagensChat();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingMensagemChat(resetItem(item));
  notify();
  void drain();
}

export async function descartarMensagemChat(clientId: string): Promise<void> {
  await deletePendingMensagemChat(clientId);
  notify();
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
    errorPermanenteLocal: undefined,
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
    errorPermanenteLocal: undefined,
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
  /** Foto avulsa, local criado offline e story aguardando sync. */
  outros: number;
  /** Itens com erro permanente (4xx) que precisam de ação do motorista. */
  comErro: number;
}> {
  const [v, p, a, li, ev, fi, cp, fo, lo, st] = await Promise.all([
    listPendingViagens(),
    listPendingPedagios(),
    listPendingAbastecimentos(),
    listPendingViagemIniciar(),
    listPendingEventosViagem(),
    listPendingViagemFinalizar(),
    listPendingCompletarPeso(),
    listPendingFotos(),
    listPendingLocais(),
    listPendingStories(),
  ]);
  // foto/local/story ficavam de fora da contagem: item travado desses não
  // aparecia em lugar nenhum, nem no badge da home nem na tela de Pendentes.
  const comErro = [v, p, a, li, ev, fi, cp, fo, lo, st].reduce(
    (acc, lista) => acc + lista.filter((i) => i.attempts >= MAX_ATTEMPTS).length,
    0,
  );
  return {
    viagens: v.length,
    pedagios: p.length,
    abastecimentos: a.length,
    lifecycle: li.length + ev.length + fi.length,
    completarPeso: cp.length,
    outros: fo.length + lo.length + st.length,
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

/**
 * Teto de fome: tempo máximo que um TIPO do outbox pode ficar sem sequer ser
 * tentado por causa do backoff de rede.
 *
 * Existe porque o backoff é global (um timestamp só, marcado por qualquer envio
 * que falha) e a ordem dos drains é fixa. Um item que falha SEMPRE por rede —
 * caso real: foto cujo arquivo o iOS apagou do diretório de cache, que falha na
 * leitura e vira "sem sinal" — remarcava o backoff em toda passada e fazia todo
 * mundo atrás dele passar fome pra sempre. Como abastecimento é o 10º de 11, o
 * motorista via as viagens (6ª) subindo normalmente e os abastecimentos parados
 * em "Pendente" sem erro nenhum: eles nunca chegavam a ser tentados.
 */
const ANTI_FOME_MS = 5 * 60 * 1000;

/** Quando cada tipo teve a última tentativa de envio (só nesta sessão). */
const ultimaTentativaPorTipo: Record<string, number> = {};

/**
 * Gate de envio de um tipo do outbox. Respeita o backoff de rede, mas nunca
 * deixa um tipo ficar mais de ANTI_FOME_MS sem uma tentativa — no pior caso
 * cada tipo gasta um envio a cada 5 min, em vez de nunca rodar.
 */
async function podeTentar(tipo: string): Promise<boolean> {
  const ok =
    (await podeEnviar()) ||
    Date.now() - (ultimaTentativaPorTipo[tipo] ?? 0) > ANTI_FOME_MS;
  if (ok) ultimaTentativaPorTipo[tipo] = Date.now();
  return ok;
}

/**
 * Manda pro backend (vira linha em /erros no painel) uma falha do outbox que o
 * escritório não teria como enxergar de outro jeito.
 *
 * Existe porque erro 4xx não é registrado em lugar nenhum do servidor: o filtro
 * global da API só grava error_logs pra 5xx, e o reporter do app pula 4xx por
 * ser "esperado". Resultado: um lançamento que morre preso fica visível SÓ
 * dentro do celular do motorista — foi exatamente por isso que abastecimento
 * travado virou um caso impossível de diagnosticar à distância.
 */
function reportarFalhaOutbox(
  tipo: string,
  clientId: string | undefined,
  msg: string,
  status?: number,
  issues?: ZodIssueSaved[],
): void {
  void reportarErro(new Error(`Outbox travado (${tipo}): ${msg}`), {
    url: `outbox/${tipo}`,
    extra: { clientId, status, issues },
  });
}

/** Idem, pra foto que sumiu do aparelho antes de conseguir subir. */
function reportarFotoPerdida(tipo: string, clientId: string, uri?: string): void {
  void reportarErro(new Error(`Foto do outbox sumiu do aparelho (${tipo})`), {
    url: `outbox/${tipo}/foto-perdida`,
    extra: { clientId, uri },
  });
}

/**
 * A foto local ainda existe no aparelho?
 *
 * O `ImageManipulator` grava em `Caches/`, e o iOS esvazia esse diretório sob
 * pressão de armazenamento — um item do outbox pode passar dias esperando sinal.
 * Quando o arquivo some, o upload falha na LEITURA e o erro chega como
 * `TypeError`, que o outbox trata como "sem sinal" e retenta pra sempre, sem
 * nunca virar erro visível. Pior: a falha remarca o backoff de rede em toda
 * passada, o que fazia o resto da fila passar fome.
 *
 * Na dúvida devolve true — é melhor tentar subir e falhar do que descartar foto
 * boa.
 */
async function fotoAindaExiste(uri: string | undefined): Promise<boolean> {
  if (!uri) return false;
  if (!uri.startsWith("file:")) return true; // content://, ph:// — deixa o upload decidir
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return true;
  }
}

/** Espera a passada em andamento terminar (teto pra não pendurar a UI). */
async function esperarDrainAtual(tetoMs = 15_000): Promise<void> {
  const limite = Date.now() + tetoMs;
  while (draining && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 300));
  }
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
    // Sync manual caindo em cima de uma passada em andamento: em vez de mentir
    // ("já estou enviando") e não fazer nada, espera a passada terminar e roda
    // uma forçada de verdade — é o que o motorista pediu ao tocar no botão.
    if (opts?.force) {
      await esperarDrainAtual();
      if (draining) {
        const { total, motivo } = await snapshotPendentes();
        return { enviados: 0, restantes: total, ultimoMotivo: motivo, emAndamento: true };
      }
    } else {
      const { total, motivo } = await snapshotPendentes();
      return { enviados: 0, restantes: total, ultimoMotivo: motivo, emAndamento: true };
    }
  }
  // Trava ANTES de qualquer await: entre o teste acima e o `draining = true`
  // havia awaits, e duas chamadas concorrentes (timer + botão) podiam entrar
  // as duas e drenar o mesmo item em paralelo.
  draining = true;
  if (opts?.force) forcandoSync = true;
  try {
    // Sem gate de backoff aqui: quem decide é o `podeTentar` de cada tipo, que
    // respeita o backoff MAS garante o teto de fome. Um gate de passada inteira
    // anularia essa garantia — e o custo de entrar na passada durante o backoff
    // é só leitura de AsyncStorage, nenhuma requisição.
    const antes = await snapshotPendentes();
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
    await drainMensagensChat();
    const depois = await snapshotPendentes();
    return {
      enviados: Math.max(0, antes.total - depois.total),
      restantes: depois.total,
      ultimoMotivo: depois.motivo,
    };
  } finally {
    draining = false;
    forcandoSync = false;
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
  for (const s of await listPendingStories()) {
    if (s.status === "syncing" && isStale(s.lastTriedAt)) {
      await upsertPendingStory({ ...s, status: "pending" });
    }
  }
  for (const m of await listPendingMensagensChat()) {
    if (m.status === "syncing" && isStale(m.lastTriedAt)) {
      await upsertPendingMensagemChat({ ...m, status: "pending" });
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
    if (!(await podeTentar("fotos"))) return;
    await processFoto(item);
  }
}

async function processFoto(item: PendingFoto): Promise<void> {
  await upsertPendingFoto({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // Aqui a foto É o conteúdo — sem arquivo não há o que enviar. Vira erro
    // REAL (visível e descartável) em vez de "aguardando sinal" pra sempre.
    if (!(await fotoAindaExiste(item.fotoUri))) {
      reportarFotoPerdida("foto", item.clientId, item.fotoUri);
      throw new FotoPerdidaError(
        "A foto não está mais no aparelho. Tire a foto de novo.",
      );
    }
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
    await upsertPendingFoto(proximoEstadoFalha(item, err, isErroPermanente(err), "foto"));
  }
  notify();
}

async function drainStories(): Promise<void> {
  const list = await listPendingStories();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("stories"))) return;
    await processStory(item);
  }
}

async function processStory(item: PendingStory): Promise<void> {
  await upsertPendingStory({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    if (!(await fotoAindaExiste(item.fotoUri))) {
      reportarFotoPerdida("story", item.clientId, item.fotoUri);
      throw new FotoPerdidaError("A foto não está mais no aparelho. Poste de novo.");
    }
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
    await upsertPendingStory(proximoEstadoFalha(item, err, isErroPermanente(err), "story"));
  }
  notify();
}

/**
 * Mensagens de chat aguardando sinal. Ficam fora de `snapshotPendentes` e da
 * tela de Pendentes de propósito: quem mostra que a mensagem não saiu é a
 * própria bolha na conversa (relógio / "não enviou"), como no WhatsApp —
 * misturar conversa com lançamento de viagem só confundiria.
 */
async function drainMensagensChat(): Promise<void> {
  const list = await listPendingMensagensChat();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("mensagens-chat"))) return;
    await processMensagemChat(item);
  }
}

async function processMensagemChat(item: PendingMensagemChat): Promise<void> {
  await upsertPendingMensagemChat({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // Idempotente por clientId no backend: reenvio depois de timeout devolve a
    // mensagem que já entrou, em vez de duplicar a bolha.
    await api.post(
      `/m/chat/conversas/${item.conversaId}/mensagens`,
      { clientId: item.clientId, texto: item.texto },
      { outbox: true },
    );
    await deletePendingMensagemChat(item.clientId);
  } catch (err) {
    await upsertPendingMensagemChat(
      proximoEstadoFalha(item, err, isErroPermanente(err), "mensagem-chat"),
    );
  }
  notify();
}

async function drainCompletarPeso(): Promise<void> {
  const list = await listPendingCompletarPeso();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("completar-peso"))) return;
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
    await upsertPendingCompletarPeso(
      proximoEstadoFalha(item, err, isErroPermanente(err), "completar-peso"),
    );
  }
  notify();
}

export async function drainLocais(): Promise<void> {
  const list = await listPendingLocais();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("locais"))) return;
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
    await upsertPendingLocal(proximoEstadoFalha(item, err, isErroPermanente(err), "local"));
  }
  notify();
}

// ---- Lifecycle drains (cancelar primeiro; depois iniciar → eventos → finalizar) ----

async function drainViagemCancelar(): Promise<void> {
  const list = await listPendingViagemCancelar();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("viagem-cancelar"))) return;
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
    if (!(await podeTentar("viagem-iniciar"))) return;
    await processViagemIniciar(item);
  }
}

/**
 * 409 do iniciar que é bloqueio por OUTRA viagem em andamento (não erro deste
 * item). O servidor só aceita 1 EM_ANDAMENTO por motorista e devolve
 * `clientIdEmAndamento` no corpo do 409. Se esse id não é o desta viagem, o
 * bloqueio é temporário — libera quando a bloqueadora fecha (ou o motorista a
 * resolve). Único 409 possível no iniciar (a idempotência por clientId já
 * cobre o reenvio da própria viagem), então na prática todo 409 aqui é bloqueio.
 */
function ehBloqueioOutraViagem(clientId: string, err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false;
  const body = err.body as { clientIdEmAndamento?: unknown } | null;
  const bloqueador =
    body && typeof body.clientIdEmAndamento === "string" ? body.clientIdEmAndamento : null;
  return bloqueador != null && bloqueador !== clientId;
}

async function processViagemIniciar(item: PendingViagemIniciar): Promise<void> {
  await upsertPendingViagemIniciar({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    // Idempotente por clientId — reenvio retorna a viagem existente.
    await api.post("/m/viagem/iniciar", item.payload, { outbox: true });
    await deletePendingViagemIniciar(item.clientId);
  } catch (err) {
    if (ehBloqueioOutraViagem(item.clientId, err)) {
      // Bloqueio temporário (outra viagem ocupa a vaga): fica "pending" SEM
      // queimar tentativa e re-tenta quando a vaga liberar. Sem isso, um
      // backlog de viagens guiadas morria todo em FALHOU 409 atrás de uma
      // viagem/casca anterior presa. Guarda a mensagem real como informativo.
      const { msg } = extractErrorDetails(err);
      await upsertPendingViagemIniciar({
        ...item,
        status: "pending",
        lastTriedAt: Date.now(),
        errorMsg: msg,
        errorStatus: undefined,
        errorIssues: undefined,
      });
      notify();
      return;
    }
    await upsertPendingViagemIniciar(
      proximoEstadoFalha(item, err, isErroPermanente(err), "viagem-iniciar"),
    );
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
    if (!(await podeTentar("eventos"))) return;
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
    await upsertPendingEventoViagem(
      proximoEstadoFalha(item, err, isErroPermanenteLifecycle(err), "evento-viagem"),
    );
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
    if (!(await podeTentar("viagem-finalizar"))) return;
    await processViagemFinalizar(item);
  }
}

async function processViagemFinalizar(item: PendingViagemFinalizar): Promise<void> {
  let atual: PendingViagemFinalizar = {
    ...item,
    status: "syncing",
    lastTriedAt: Date.now(),
  };
  await upsertPendingViagemFinalizar(atual);
  notify();
  try {
    let payload = { ...atual.payload };
    if (atual.fotoUri && !payload.fotoKey) {
      if (await fotoAindaExiste(atual.fotoUri)) {
        const fd = new FormData();
        const filename = `ticket-${atual.clientId}.${
          atual.fotoMime?.includes("png") ? "png" : "jpg"
        }`;
        fd.append("foto", {
          uri: atual.fotoUri,
          type: atual.fotoMime ?? "image/jpeg",
          name: filename,
        } as unknown as Blob);
        const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
        payload = { ...payload, fotoKey: up.storageKey };
      } else {
        reportarFotoPerdida("viagem-finalizar", atual.clientId, atual.fotoUri);
      }
      atual = { ...atual, payload, fotoUri: undefined, fotoMime: undefined };
      await upsertPendingViagemFinalizar(atual);
    }
    await api.post(`/m/viagem/${atual.clientId}/finalizar`, payload, { outbox: true });
    await deletePendingViagemFinalizar(atual.clientId);
  } catch (err) {
    await upsertPendingViagemFinalizar(
      proximoEstadoFalha(atual, err, isErroPermanenteLifecycle(err), "viagem-finalizar"),
    );
  }
  notify();
}

async function drainViagens(): Promise<void> {
  const list = await listPendingViagens();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("viagens"))) return;
    await processViagem(item);
  }
}

async function processViagem(item: PendingViagem): Promise<void> {
  let atual: PendingViagem = { ...item, status: "syncing", lastTriedAt: Date.now() };
  await upsertPendingViagem(atual);
  notify();
  try {
    let payload = { ...atual.payload };
    if (atual.fotoUri && !payload.fotoKey) {
      if (await fotoAindaExiste(atual.fotoUri)) {
        const fd = new FormData();
        const filename = `ticket-${atual.clientId}.${
          atual.fotoMime?.includes("png") ? "png" : "jpg"
        }`;
        fd.append("foto", {
          uri: atual.fotoUri,
          type: atual.fotoMime ?? "image/jpeg",
          name: filename,
        } as unknown as Blob);
        const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
        payload = { ...payload, fotoKey: up.storageKey };
      } else {
        // Arquivo purgado pelo SO. Melhor a viagem subir sem a foto do que ficar
        // presa pra sempre — a foto pode ser anexada depois pela tela da viagem.
        reportarFotoPerdida("viagem", atual.clientId, atual.fotoUri);
      }
      // Persiste o resultado do passo da foto pra não repetir o upload se o
      // POST abaixo falhar (antes, o catch usava o `item` original e desfazia).
      atual = { ...atual, payload, fotoUri: undefined, fotoMime: undefined };
      await upsertPendingViagem(atual);
    }
    await api.post("/m/viagens", payload, { outbox: true });
    await deletePendingViagem(atual.clientId);
  } catch (err) {
    await upsertPendingViagem(proximoEstadoFalha(atual, err, isErroPermanente(err), "viagem"));
  }
  notify();
}

async function drainPedagios(): Promise<void> {
  const list = await listPendingPedagios();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("pedagios"))) return;
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
    await upsertPendingPedagio(proximoEstadoFalha(item, err, isErroPermanente(err), "pedagio"));
  }
  notify();
}

async function drainAbastecimentos(): Promise<void> {
  const list = await listPendingAbastecimentos();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!(await podeTentar("abastecimentos"))) return;
    await processAbastecimento(item);
  }
}

async function processAbastecimento(item: PendingAbastecimento): Promise<void> {
  // `atual` acompanha o que já foi persistido: se a foto subir e o POST falhar,
  // o catch precisa salvar o item COM a fotoKey. Usar o `item` do parâmetro
  // desfazia o upsert do meio e re-uploadava a foto em toda tentativa.
  let atual: PendingAbastecimento = { ...item, status: "syncing", lastTriedAt: Date.now() };
  await upsertPendingAbastecimento(atual);
  notify();
  try {
    let payload = { ...atual.payload };
    if (atual.fotoUri && !payload.fotoKey) {
      if (await fotoAindaExiste(atual.fotoUri)) {
        const fd = new FormData();
        const filename = `abast-${atual.clientId}.${
          atual.fotoMime?.includes("png") ? "png" : "jpg"
        }`;
        fd.append("foto", {
          uri: atual.fotoUri,
          type: atual.fotoMime ?? "image/jpeg",
          name: filename,
        } as unknown as Blob);
        const up = await api.postForm<{ storageKey: string }>(
          "/m/uploads/abastecimento",
          fd,
        );
        payload = { ...payload, fotoKey: up.storageKey };
      } else {
        // Arquivo sumiu do aparelho (cache purgado pelo SO). A foto é opcional
        // no abastecimento — o lançamento vale mais que ela. Segue sem foto em
        // vez de ficar preso pra sempre "aguardando sinal".
        reportarFotoPerdida("abastecimento", atual.clientId, atual.fotoUri);
      }
      // Persiste o resultado do passo da foto (subida ou perdida) pra não
      // repetir o upload se o POST abaixo falhar.
      atual = { ...atual, payload, fotoUri: undefined, fotoMime: undefined };
      await upsertPendingAbastecimento(atual);
    }
    await api.post("/m/abastecimentos", payload, { outbox: true });
    await deletePendingAbastecimento(atual.clientId);
  } catch (err) {
    await upsertPendingAbastecimento(
      proximoEstadoFalha(atual, err, isErroPermanente(err), "abastecimento"),
    );
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
  errorPermanenteLocal?: boolean;
};

/**
 * A foto local sumiu antes de conseguir subir (cache purgado pelo SO). Não
 * adianta retentar — só o motorista pode resolver, tirando outra ou
 * descartando. Classe própria pra não se confundir com falha de rede.
 */
class FotoPerdidaError extends Error {}

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
 *
 * `tipo` só serve pra telemetria: quando o item MORRE (chega ao teto), a falha é
 * reportada pro backend, senão ela existe só dentro do celular do motorista.
 */
function proximoEstadoFalha<T extends ComErro & { clientId?: string }>(
  item: T,
  err: unknown,
  permanente: boolean,
  tipo?: string,
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
      errorPermanenteLocal: undefined,
    };
  }
  const { msg, status, issues } = extractErrorDetails(err);
  // Foto sumida é definitiva mesmo sem status HTTP: não há o que retentar.
  const fotoPerdida = err instanceof FotoPerdidaError;
  const attempts = permanente || fotoPerdida ? MAX_ATTEMPTS : item.attempts + 1;
  // Só no momento em que o item para de retentar sozinho — uma vez por item,
  // não a cada passada.
  if (tipo && attempts >= MAX_ATTEMPTS) {
    reportarFalhaOutbox(tipo, item.clientId, msg, status, issues);
  }
  return {
    ...item,
    status: "error",
    errorMsg: msg,
    errorStatus: status,
    errorIssues: issues,
    errorPermanenteLocal: fotoPerdida || undefined,
    attempts,
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
    errorPermanenteLocal: undefined,
  };
}

/** Uma falha salva como "error" que na verdade era transitória (rede/keychain/
 * 5xx) — não um 4xx de dado inválido. Esses não deviam ter morrido em FALHOU. */
function falhaSalvaEhTransitoria(item: ComErro): boolean {
  // O app já concluiu que é definitiva (ex: foto sumiu) — não ressuscita.
  if (item.errorPermanenteLocal) return false;
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
  await varrer(await listPendingMensagensChat(), upsertPendingMensagemChat);
  // viagem-iniciar: além dos transitórios, um 409 morto aqui é SEMPRE bloqueio
  // por outra viagem em andamento (única causa de 409 no iniciar) — recuperável
  // assim que a vaga liberar. Reseta pra retentar sozinho (não vira "pending
  // que morre de novo" porque processViagemIniciar agora trata o bloqueio como
  // transitório). Cobre backlogs que morreram ANTES deste fix chegar por OTA.
  for (const item of await listPendingViagemIniciar()) {
    if (item.status === "error" && (falhaSalvaEhTransitoria(item) || item.errorStatus === 409)) {
      await upsertPendingViagemIniciar(resetItem(item));
      mexeu = true;
    }
  }
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
