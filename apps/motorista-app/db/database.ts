// Storage simples key-value via AsyncStorage.
// Volume real é baixo (cache de catálogos + outbox de poucas viagens),
// AsyncStorage é mais robusto e estável que SQLite no Expo Go.
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "ronan.";

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}cache.${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: T; t: number };
    return parsed.v;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${PREFIX}cache.${key}`,
      JSON.stringify({ v: value, t: Date.now() }),
    );
  } catch {
    /* sem espaco / corrupted — ignora silenciosamente */
  }
}

/** Quando o cache dessa chave foi gravado (Date.now do último cachePut). null =
 *  nunca baixado. Usado pra mostrar "dados atualizados há X" no app. */
export async function cacheGetAt(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}cache.${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: unknown; t: number };
    return typeof parsed.t === "number" ? parsed.t : null;
  } catch {
    return null;
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${PREFIX}cache.${key}`);
  } catch {
    /* nope */
  }
}

// Outbox helpers: lista única de pending por tipo, persistida como JSON.
// Volume baixo (motorista lança poucas viagens por dia), tudo na memória.

export type ZodIssueSaved = {
  path: string;
  code: string;
  message: string;
};

export type PendingViagem = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

export type PendingPedagio = {
  clientId: string;
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

export type PendingAbastecimento = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Foto a anexar em viagem JÁ sincronizada. Motorista esqueceu de anexar
 * no lançamento; abre a tela de detalhe da viagem e adiciona depois.
 * viagemId é o id real do servidor (viagem precisa existir lá). */
export type PendingFoto = {
  /** UUID gerado client-side pra identificar essa pending. */
  clientId: string;
  viagemId: string;
  fotoUri: string;
  fotoMime: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Story (foto do trecho) aguardando envio. 2-step no processStory: sobe a foto
 * pro MinIO (/m/uploads/story) e cria o story (POST /m/stories). Idempotente
 * por clientId no backend. Fica no outbox pra postar mesmo em zona sem sinal. */
export type PendingStory = {
  /** UUID client-side — vira o clientId do story (idempotência). */
  clientId: string;
  fotoUri: string;
  fotoMime: string;
  legenda?: string;
  lat?: number;
  lng?: number;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Completar peso + ticket de uma viagem JÁ sincronizada que está em
 * AGUARDANDO_PESO (romaneio saiu no fim do dia). viagemId é o id real do
 * servidor (POST /m/viagens/:id/completar-peso). Idempotente no backend. */
export type PendingCompletarPeso = {
  /** UUID client-side pra identificar essa pending. */
  clientId: string;
  viagemId: string;
  payload: { toneladas: number; ticket?: string };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Local de descarga criado offline. clientId vira id real no servidor
 * (POST /m/locais/rapido aceita id pra idempotência). */
export type PendingLocal = {
  clientId: string;
  payload: {
    nome: string;
    lat: number;
    lng: number;
    precisao?: number;
    fonte?: "PRECISA" | "BALANCED" | "CACHE";
    tipo: "CARGA" | "DESCARGA" | "AMBOS";
    clienteIds?: string[];
  };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle guiado: abertura da viagem (POST /m/viagem/iniciar). */
export type PendingViagemIniciar = {
  clientId: string; // clientId da viagem (idempotência)
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle: um evento (carga/descarga/parada...) numa viagem em andamento. */
export type PendingEventoViagem = {
  clientId: string; // id do evento (idempotência)
  viagemClientId: string; // clientId da viagem-mãe (gate de ordem no drain)
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle: cancelamento/descarte de uma viagem em andamento. */
export type PendingViagemCancelar = {
  clientId: string; // clientId da viagem-mãe
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/** Lifecycle: finalização da viagem (POST /m/viagem/:clientId/finalizar). */
export type PendingViagemFinalizar = {
  clientId: string; // clientId da viagem-mãe
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  /** Falha que o PRÓPRIO app sabe que é definitiva (ex: a foto sumiu do
   * aparelho). Sem isso o rescue de boot, que só olha errorStatus, trataria
   * como transitória e ressuscitaria o item pra sempre. */
  errorPermanenteLocal?: boolean;
};

/**
 * Mensagem de chat aguardando envio. Fica no outbox pra o motorista escrever
 * em zona sem sinal e a mensagem sair sozinha depois — igual WhatsApp.
 *
 * Diferente dos outros pendentes, ESTE tipo não entra na tela de Pendentes nem
 * na contagem de "X com erro": o lugar natural de ver que a mensagem não saiu
 * é a própria bolha na conversa (relógio / "não enviou, toque pra tentar").
 * Jogar isso na tela de lançamentos misturaria conversa com viagem.
 */
export type PendingMensagemChat = {
  /** UUID client-side — vira o clientId da mensagem (idempotência). */
  clientId: string;
  conversaId: string;
  texto: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  errorPermanenteLocal?: boolean;
};

const VIAGENS_KEY = `${PREFIX}outbox.viagens`;
const MENSAGENS_CHAT_KEY = `${PREFIX}outbox.mensagens-chat`;
const PEDAGIOS_KEY = `${PREFIX}outbox.pedagios`;
const ABASTECIMENTOS_KEY = `${PREFIX}outbox.abastecimentos`;
const LOCAIS_KEY = `${PREFIX}outbox.locais`;
const FOTOS_KEY = `${PREFIX}outbox.fotos`;
const STORIES_KEY = `${PREFIX}outbox.stories`;
const VG_INICIAR_KEY = `${PREFIX}outbox.viagem-iniciar`;
const VG_EVENTOS_KEY = `${PREFIX}outbox.viagem-eventos`;
const VG_FINALIZAR_KEY = `${PREFIX}outbox.viagem-finalizar`;
const VG_CANCELAR_KEY = `${PREFIX}outbox.viagem-cancelar`;
const COMPLETAR_PESO_KEY = `${PREFIX}outbox.viagem-completar-peso`;

async function readList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

export async function listPendingViagens(): Promise<PendingViagem[]> {
  return readList<PendingViagem>(VIAGENS_KEY);
}

export async function listPendingPedagios(): Promise<PendingPedagio[]> {
  return readList<PendingPedagio>(PEDAGIOS_KEY);
}

export async function upsertPendingViagem(item: PendingViagem): Promise<void> {
  const list = await listPendingViagens();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VIAGENS_KEY, list);
}

export async function upsertPendingPedagio(item: PendingPedagio): Promise<void> {
  const list = await listPendingPedagios();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(PEDAGIOS_KEY, list);
}

export async function deletePendingViagem(clientId: string): Promise<void> {
  const list = await listPendingViagens();
  await writeList(
    VIAGENS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function deletePendingPedagio(clientId: string): Promise<void> {
  const list = await listPendingPedagios();
  await writeList(
    PEDAGIOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingAbastecimentos(): Promise<PendingAbastecimento[]> {
  return readList<PendingAbastecimento>(ABASTECIMENTOS_KEY);
}

export async function upsertPendingAbastecimento(
  item: PendingAbastecimento,
): Promise<void> {
  const list = await listPendingAbastecimentos();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(ABASTECIMENTOS_KEY, list);
}

export async function deletePendingAbastecimento(clientId: string): Promise<void> {
  const list = await listPendingAbastecimentos();
  await writeList(
    ABASTECIMENTOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingLocais(): Promise<PendingLocal[]> {
  return readList<PendingLocal>(LOCAIS_KEY);
}

export async function upsertPendingLocal(item: PendingLocal): Promise<void> {
  const list = await listPendingLocais();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(LOCAIS_KEY, list);
}

export async function deletePendingLocal(clientId: string): Promise<void> {
  const list = await listPendingLocais();
  await writeList(
    LOCAIS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

// ---- Lifecycle: iniciar / eventos / finalizar ----

export async function listPendingViagemIniciar(): Promise<PendingViagemIniciar[]> {
  return readList<PendingViagemIniciar>(VG_INICIAR_KEY);
}
export async function upsertPendingViagemIniciar(item: PendingViagemIniciar): Promise<void> {
  const list = await listPendingViagemIniciar();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VG_INICIAR_KEY, list);
}
export async function deletePendingViagemIniciar(clientId: string): Promise<void> {
  const list = await listPendingViagemIniciar();
  await writeList(VG_INICIAR_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingEventosViagem(): Promise<PendingEventoViagem[]> {
  return readList<PendingEventoViagem>(VG_EVENTOS_KEY);
}
export async function upsertPendingEventoViagem(item: PendingEventoViagem): Promise<void> {
  const list = await listPendingEventosViagem();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.push(item); // ordem de ocorrência (append)
  await writeList(VG_EVENTOS_KEY, list);
}
export async function deletePendingEventoViagem(clientId: string): Promise<void> {
  const list = await listPendingEventosViagem();
  await writeList(VG_EVENTOS_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingViagemFinalizar(): Promise<PendingViagemFinalizar[]> {
  return readList<PendingViagemFinalizar>(VG_FINALIZAR_KEY);
}
export async function upsertPendingViagemFinalizar(item: PendingViagemFinalizar): Promise<void> {
  const list = await listPendingViagemFinalizar();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VG_FINALIZAR_KEY, list);
}
export async function deletePendingViagemFinalizar(clientId: string): Promise<void> {
  const list = await listPendingViagemFinalizar();
  await writeList(VG_FINALIZAR_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingViagemCancelar(): Promise<PendingViagemCancelar[]> {
  return readList<PendingViagemCancelar>(VG_CANCELAR_KEY);
}
export async function upsertPendingViagemCancelar(item: PendingViagemCancelar): Promise<void> {
  const list = await listPendingViagemCancelar();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VG_CANCELAR_KEY, list);
}
export async function deletePendingViagemCancelar(clientId: string): Promise<void> {
  const list = await listPendingViagemCancelar();
  await writeList(VG_CANCELAR_KEY, list.filter((x) => x.clientId !== clientId));
}

export async function listPendingCompletarPeso(): Promise<PendingCompletarPeso[]> {
  return readList<PendingCompletarPeso>(COMPLETAR_PESO_KEY);
}

export async function upsertPendingCompletarPeso(item: PendingCompletarPeso): Promise<void> {
  const list = await listPendingCompletarPeso();
  const idx = list.findIndex((x) => x.viagemId === item.viagemId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(COMPLETAR_PESO_KEY, list);
}

export async function deletePendingCompletarPeso(viagemId: string): Promise<void> {
  const list = await listPendingCompletarPeso();
  await writeList(
    COMPLETAR_PESO_KEY,
    list.filter((x) => x.viagemId !== viagemId),
  );
}

export async function listPendingFotos(): Promise<PendingFoto[]> {
  return readList<PendingFoto>(FOTOS_KEY);
}

export async function upsertPendingFoto(item: PendingFoto): Promise<void> {
  const list = await listPendingFotos();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(FOTOS_KEY, list);
}

export async function deletePendingFoto(clientId: string): Promise<void> {
  const list = await listPendingFotos();
  await writeList(
    FOTOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingStories(): Promise<PendingStory[]> {
  return readList<PendingStory>(STORIES_KEY);
}

export async function upsertPendingStory(item: PendingStory): Promise<void> {
  const list = await listPendingStories();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(STORIES_KEY, list);
}

export async function deletePendingStory(clientId: string): Promise<void> {
  const list = await listPendingStories();
  await writeList(
    STORIES_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingMensagensChat(): Promise<PendingMensagemChat[]> {
  return readList<PendingMensagemChat>(MENSAGENS_CHAT_KEY);
}

export async function upsertPendingMensagemChat(
  item: PendingMensagemChat,
): Promise<void> {
  const list = await listPendingMensagensChat();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  // Append: a ordem da fila é a ordem em que o motorista escreveu, e é assim
  // que as bolhas aparecem na conversa.
  else list.push(item);
  await writeList(MENSAGENS_CHAT_KEY, list);
}

export async function deletePendingMensagemChat(clientId: string): Promise<void> {
  const list = await listPendingMensagensChat();
  await writeList(
    MENSAGENS_CHAT_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}
