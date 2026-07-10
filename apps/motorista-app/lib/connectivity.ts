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

// Instante da última requisição REAL bem-sucedida (qualquer resposta do
// servidor). A requisição real é a fonte da verdade: o NetInfo do iOS MENTE —
// retorna offline (isConnected/isInternetReachable=false) com internet OK, o que
// pintava a tarja "sem internet" e travava o sync no iPhone (no Android é ok).
// Enquanto houver sucesso recente, ignoramos o NetInfo.
let ultimoSucessoRede = 0;
const SUCESSO_TTL_MS = 30_000;

function emit() {
  for (const l of listeners) l();
}

function temSucessoRecente(): boolean {
  return ultimoSucessoRede !== 0 && Date.now() - ultimoSucessoRede < SUCESSO_TTL_MS;
}

// online = sucesso de rede recente (a verdade) OU (sem sinal recente) o SO diz
// que há link. NÃO usamos mais isInternetReachable — é o probe do iOS que dá
// falso-offline. Só isConnected===false (sem interface) conta como offline.
function calcOnline(state: NetInfoState): boolean {
  if (temSucessoRecente()) return true;
  return state.isConnected !== false;
}

function setConnected(next: boolean) {
  if (next !== _connected) {
    _connected = next;
    for (const l of connectedListeners) l(_connected);
  }
}

function apply(state: NetInfoState) {
  const next = calcOnline(state);
  if (next !== _online) {
    _online = next;
    emit();
  }
  setConnected(temSucessoRecente() ? true : state.isConnected !== false);
}

/**
 * A camada de rede (lib/api.ts) chama isto ao RECEBER qualquer resposta do
 * servidor (mesmo 4xx/5xx) — prova irrefutável de que há internet, vence o
 * NetInfo mentiroso. Marca online na hora.
 */
export function marcarInternetOk(): void {
  ultimoSucessoRede = Date.now();
  if (!_online) {
    _online = true;
    emit();
  }
  setConnected(true);
}

/**
 * A camada de rede chama isto quando o fetch ESTOURA (rede/timeout real). Aí o
 * servidor está inalcançável de verdade → offline (a menos que tenha havido um
 * sucesso agora há pouco, o que indica falha pontual, não queda de link).
 */
export function marcarInternetFalha(): void {
  if (temSucessoRecente()) return;
  if (_online) {
    _online = false;
    emit();
  }
  setConnected(false);
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
