/**
 * Lifecycle guiado de viagem (Iniciar → eventos → Finalizar).
 *
 * - Espelho LOCAL (AsyncStorage) da viagem em andamento: fonte de verdade
 *   offline; o app renderiza a máquina de estados a partir dele + do catálogo.
 * - Máquina de estados: funções puras que, dado o catálogo e os eventos já
 *   registrados, dizem qual é o PRÓXIMO passo (botão primário) e os extras.
 * - Ações de alto nível: montam o payload e enfileiram no outbox (sync.ts).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TipoEventoViagem } from "@ronan/shared-types";
import {
  enqueueEventoViagem,
  enqueueViagemFinalizar,
  enqueueViagemIniciar,
  enqueueLocal,
} from "./sync";

export type LocalSnapshotLifecycle = { nome: string; lat: number; lng: number };

/** Evento já registrado localmente (espelho pra UI offline). */
export type EventoLocal = {
  id: string;
  tipoSlug: string;
  nome: string;
  ocorridoEm: string; // ISO
  localNome?: string;
};

/** Viagem em andamento no espelho local. */
export type LifecycleLocal = {
  clientId: string;
  veiculoId: string;
  iniciadoEm: string; // ISO
  localCargaId?: string;
  localCargaNome?: string;
  eventos: EventoLocal[];
};

const KEY = "ronan.viagem-lifecycle";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Espelho local ----

export async function getLifecycleLocal(): Promise<LifecycleLocal | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LifecycleLocal) : null;
  } catch {
    return null;
  }
}

async function setLifecycleLocal(v: LifecycleLocal): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(v));
}

export async function clearLifecycleLocal(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

// ---- Máquina de estados (puras) ----

/** Tipos ativos ordenados pela sequência guiada. */
export function tiposOrdenados(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return [...catalogo]
    .filter((t) => t.ativo)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

/** Espinha = tipos obrigatórios em ordem. */
export function espinha(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return tiposOrdenados(catalogo).filter((t) => t.obrigatorio);
}

/** Extras = tipos opcionais (botões secundários, disponíveis a qualquer hora). */
export function extras(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return tiposOrdenados(catalogo).filter((t) => !t.obrigatorio);
}

/**
 * Próximo passo obrigatório ainda não registrado (botão primário grande).
 * Retorna null quando todos os marcos foram feitos → pronto pra finalizar.
 */
export function proximoPassoObrigatorio(
  catalogo: TipoEventoViagem[],
  slugsRegistrados: string[],
): TipoEventoViagem | null {
  const feitos = new Set(slugsRegistrados);
  for (const t of espinha(catalogo)) {
    if (!feitos.has(t.slug)) return t;
  }
  return null;
}

export function prontoParaFinalizar(
  catalogo: TipoEventoViagem[],
  slugsRegistrados: string[],
): boolean {
  return proximoPassoObrigatorio(catalogo, slugsRegistrados) === null;
}

// ---- Ações de alto nível (montam payload + enfileiram + atualizam espelho) ----

/** Abre a viagem: cria localmente, enfileira o POST /iniciar. Retorna clientId. */
export async function iniciarViagemGuiada(input: {
  veiculoId: string;
  coords?: { lat: number; lng: number; precisao?: number };
  localCarga?: { id: string; nome: string };
}): Promise<string> {
  const clientId = uuid();
  const iniciadoEm = nowIso();
  await enqueueViagemIniciar({
    clientId,
    veiculoId: input.veiculoId,
    iniciadoEm,
    lat: input.coords?.lat,
    lng: input.coords?.lng,
    precisao: input.coords?.precisao,
    localCargaId: input.localCarga?.id,
    criadoOfflineEm: iniciadoEm,
  });
  await setLifecycleLocal({
    clientId,
    veiculoId: input.veiculoId,
    iniciadoEm,
    localCargaId: input.localCarga?.id,
    localCargaNome: input.localCarga?.nome,
    eventos: [],
  });
  return clientId;
}

/**
 * Registra um evento (carga/descarga/parada...) na viagem em andamento.
 * Se veio de um local criado offline, o caller já deve ter enfileirado o
 * local (enqueueLocal); aqui passamos localId + snapshot pra auto-recovery.
 */
export async function registrarEventoGuiado(input: {
  tipo: TipoEventoViagem;
  coords?: { lat: number; lng: number; precisao?: number };
  local?: { id: string; nome: string; lat?: number; lng?: number; criarOffline?: boolean };
  foto?: { uri: string; mime: string };
  toneladas?: number;
  valor?: number;
  ticket?: string;
  observacao?: string;
}): Promise<void> {
  const atual = await getLifecycleLocal();
  if (!atual) throw new Error("Nenhuma viagem em andamento.");

  const id = uuid();
  const ocorridoEm = nowIso();

  // Local criado offline (lugar novo): enfileira antes pro drain criar o Local
  // antes do evento (mesma ordem locais → lifecycle no drain).
  if (input.local?.criarOffline && input.local.lat != null && input.local.lng != null) {
    await enqueueLocal({
      clientId: input.local.id,
      payload: {
        nome: input.local.nome,
        lat: input.local.lat,
        lng: input.local.lng,
        precisao: input.coords?.precisao,
        tipo: input.tipo.ehDescarga ? "DESCARGA" : input.tipo.ehCarga ? "CARGA" : "AMBOS",
      },
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
  }

  const localDados: LocalSnapshotLifecycle | undefined =
    input.local && input.local.lat != null && input.local.lng != null
      ? { nome: input.local.nome, lat: input.local.lat, lng: input.local.lng }
      : undefined;

  await enqueueEventoViagem(
    atual.clientId,
    {
      id,
      tipoSlug: input.tipo.slug,
      ocorridoEm,
      lat: input.coords?.lat,
      lng: input.coords?.lng,
      precisao: input.coords?.precisao,
      localId: input.local?.id,
      localDados,
      toneladas: input.toneladas,
      valor: input.valor,
      ticket: input.ticket,
      observacao: input.observacao,
      criadoOfflineEm: ocorridoEm,
    },
    input.foto,
  );

  // Espelho local
  const eventos = [
    ...atual.eventos,
    { id, tipoSlug: input.tipo.slug, nome: input.tipo.nome, ocorridoEm, localNome: input.local?.nome },
  ];
  const patch: LifecycleLocal = { ...atual, eventos };
  if (input.tipo.ehCarga && input.local) {
    patch.localCargaId = input.local.id;
    patch.localCargaNome = input.local.nome;
  }
  await setLifecycleLocal(patch);
}

/** Finaliza: enfileira o POST /finalizar e limpa o espelho local. */
export async function finalizarViagemGuiada(input: {
  clienteId: string;
  materialId: string;
  data: string; // ISO ou YYYY-MM-DD
  toneladas: number;
  km: number;
  kmCalculado?: number;
  ticket?: string;
  localDescargaId: string;
  localDescargaDados?: LocalSnapshotLifecycle;
  descargaLat?: number;
  descargaLng?: number;
  descargaPrecisao?: number;
  descargaDistanciaMetros?: number;
  valorPedagioTotal?: number;
  observacao?: string;
  foto?: { uri: string; mime: string };
}): Promise<void> {
  const atual = await getLifecycleLocal();
  if (!atual) throw new Error("Nenhuma viagem em andamento.");

  await enqueueViagemFinalizar(
    atual.clientId,
    {
      clienteId: input.clienteId,
      materialId: input.materialId,
      data: input.data,
      toneladas: input.toneladas,
      km: input.km,
      kmCalculado: input.kmCalculado,
      ticket: input.ticket,
      localDescargaId: input.localDescargaId,
      localDescargaDados: input.localDescargaDados,
      descargaLat: input.descargaLat,
      descargaLng: input.descargaLng,
      descargaPrecisao: input.descargaPrecisao,
      descargaDistanciaMetros: input.descargaDistanciaMetros,
      valorPedagioTotal: input.valorPedagioTotal,
      observacao: input.observacao,
    },
    input.foto,
  );
  await clearLifecycleLocal();
}
