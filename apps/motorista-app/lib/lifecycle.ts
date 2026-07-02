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
import { api } from "./api";
import {
  enqueueEventoViagem,
  enqueueViagemCancelar,
  enqueueViagemFinalizar,
  enqueueViagemIniciar,
  enqueueLocal,
  removerItensLifecycleDaViagem,
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

/**
 * Descarta a viagem em andamento: limpa a fila local (iniciar/eventos/
 * finalizar), enfileira o cancelamento no servidor (idempotente) e apaga o
 * espelho local. Resolve o caso do 409 "já tem viagem em andamento".
 */
export async function descartarViagemGuiada(clientId: string): Promise<void> {
  await removerItensLifecycleDaViagem(clientId);
  await enqueueViagemCancelar(clientId);
  const atual = await getLifecycleLocal();
  if (!atual || atual.clientId === clientId) {
    await clearLifecycleLocal();
  }
}

// Forma da resposta de GET /m/viagem/andamento (só o que usamos aqui).
type ServerAndamento = {
  viagem: {
    clientId: string;
    veiculoId: string;
    iniciadoEm: string | null;
    localCarga: { id: string; nome: string } | null;
    eventosViagem: { id: string; tipoSlug: string; ocorridoEm: string }[];
  } | null;
};

/**
 * Reconciliação: se NÃO há espelho local mas o servidor tem uma viagem em
 * andamento (órfã — ex: descartada só no celular antes), reconstrói o espelho
 * local a partir do servidor pra o motorista poder retomar/descartar. Só
 * preenche quando o espelho está vazio — nunca sobrescreve uma viagem local
 * (que pode ser offline-pendente). Best-effort: offline, ignora.
 */
export async function hidratarViagemDoServidor(): Promise<LifecycleLocal | null> {
  const atual = await getLifecycleLocal();
  if (atual) return atual;
  try {
    const resp = await api.get<ServerAndamento>("/m/viagem/andamento");
    const v = resp?.viagem;
    if (!v) return null;
    const novo: LifecycleLocal = {
      clientId: v.clientId,
      veiculoId: v.veiculoId,
      iniciadoEm: v.iniciadoEm ?? nowIso(),
      localCargaId: v.localCarga?.id,
      localCargaNome: v.localCarga?.nome,
      eventos: (v.eventosViagem ?? []).map((e) => ({
        id: e.id,
        tipoSlug: e.tipoSlug,
        nome: e.tipoSlug,
        ocorridoEm: e.ocorridoEm,
      })),
    };
    await setLifecycleLocal(novo);
    return novo;
  } catch {
    return null;
  }
}

// ---- Máquina de estados (puras) ----

/**
 * Tipos ativos ordenados pela sequência guiada.
 *
 * Carga e descarga são bookends FIXOS do app (carga = tela Iniciar; descarga =
 * tela Finalizar), não botões do meio da viagem — então os tipos ehCarga/
 * ehDescarga NUNCA entram na lista guiada, mesmo que existam no catálogo. O
 * catálogo guiado é só dos EXTRAS opcionais (parada, balança, abastecimento…).
 */
export function tiposOrdenados(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return [...catalogo]
    .filter((t) => t.ativo && !t.ehCarga && !t.ehDescarga)
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
  localCarga?: { id: string; nome: string; lat?: number; lng?: number; criarOffline?: boolean };
}): Promise<string> {
  const clientId = uuid();
  const iniciadoEm = nowIso();
  const lc = input.localCarga;

  // Local de carga novo (lugar fora do cadastro): enfileira antes pro drain
  // criar o Local antes da viagem (ordem locais → lifecycle). Raro — a carga
  // normalmente já existe no cadastro.
  if (lc?.criarOffline && lc.lat != null && lc.lng != null) {
    await enqueueLocal({
      clientId: lc.id,
      payload: { nome: lc.nome, lat: lc.lat, lng: lc.lng, precisao: input.coords?.precisao, tipo: "CARGA" },
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
  }
  const localCargaDados: LocalSnapshotLifecycle | undefined =
    lc && lc.lat != null && lc.lng != null ? { nome: lc.nome, lat: lc.lat, lng: lc.lng } : undefined;

  await enqueueViagemIniciar({
    clientId,
    veiculoId: input.veiculoId,
    iniciadoEm,
    lat: input.coords?.lat,
    lng: input.coords?.lng,
    precisao: input.coords?.precisao,
    localCargaId: lc?.id,
    localCargaDados,
    criadoOfflineEm: iniciadoEm,
  });
  await setLifecycleLocal({
    clientId,
    veiculoId: input.veiculoId,
    iniciadoEm,
    localCargaId: lc?.id,
    localCargaNome: lc?.nome,
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
