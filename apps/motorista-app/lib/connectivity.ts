// Estado global de conectividade (online/offline). Segue o mesmo padrão de
// module-state do projeto (auth-state/tutorial-state): um singleton de módulo
// com listeners; o <ConnectivityBanner /> escuta e mostra a tarja quando offline.
//
// Reaproveita o @react-native-community/netinfo — mesmo pacote que a sync usa
// pra decidir quando drenar o outbox. É só sinalização: o cadastro é local-first
// e funciona offline de qualquer jeito.

import { useEffect, useState } from "react";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

type Listener = () => void;
const listeners = new Set<Listener>();
// Listeners do estado BRUTO de conexão (isConnected), usados pelo onlineManager
// do TanStack Query. Distinto do banner: aqui é só "tem link ou não" (offline
// total), sem o probe de internet alcançável — o QueryClient usa isso pra pausar
// queries/retries quando o SO já sabe que está sem rede.
const connectedListeners = new Set<(connected: boolean) => void>();

// Otimista: começa online pra não piscar a tarja no boot antes do primeiro fetch.
let _online = true;
let _connected = true;
let started = false;

function emit() {
  for (const l of listeners) l();
}

// offline = sem conexão OU conectado mas sem internet alcançável.
// isInternetReachable pode vir null enquanto o NetInfo ainda checa — nesse caso
// NÃO considera offline, pra evitar piscada em transições.
function calcOnline(state: NetInfoState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function apply(state: NetInfoState) {
  const next = calcOnline(state);
  if (next !== _online) {
    _online = next;
    emit();
  }
  const nextConnected = state.isConnected !== false;
  if (nextConnected !== _connected) {
    _connected = nextConnected;
    for (const l of connectedListeners) l(_connected);
  }
}

// Um único listener do NetInfo, iniciado na primeira inscrição. Vive pela vida
// toda do app (não precisa de unsubscribe).
function ensureStarted() {
  if (started) return;
  started = true;
  void NetInfo.fetch().then(apply);
  NetInfo.addEventListener(apply);
}

export function getOnline(): boolean {
  return _online;
}

/** Estado bruto de conexão (isConnected). Pro onlineManager do TanStack Query. */
export function getConnected(): boolean {
  return _connected;
}

/**
 * Assina o estado bruto de conexão (offline total). Emite a cada mudança de
 * isConnected. Usado pelo onlineManager do TanStack pra pausar queries/retries
 * quando não há link — evita disparos inúteis e espera de timeout no offline.
 */
export function subscribeConnected(fn: (connected: boolean) => void): () => void {
  ensureStarted();
  connectedListeners.add(fn);
  return () => {
    connectedListeners.delete(fn);
  };
}

export function subscribeConnectivity(fn: Listener): () => void {
  ensureStarted();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Hook reativo: true quando há internet, false quando offline. */
export function useConnectivity(): boolean {
  const [online, setOnline] = useState(getOnline);
  useEffect(() => subscribeConnectivity(() => setOnline(getOnline())), []);
  return online;
}
