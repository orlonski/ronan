/**
 * Reporta erros do app pro backend (POST /errors/motorista).
 * Sem lib nativa — apenas fetch + ErrorBoundary + global handler.
 *
 * Resiliente: se a rede falhar, salva localmente e tenta de novo
 * na próxima inicialização do app.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "./api";
import { loadTokens } from "./auth";

const STORAGE_KEY = "ronan.errors-pendentes";
const MAX_PENDENTES = 50;

type ErroPendente = {
  message: string;
  stack?: string;
  versao?: string;
  url?: string;
  userAgent?: string;
  extra?: unknown;
  capturadoEm: string;
};

let inFlight = false;

export async function reportarErro(
  err: unknown,
  contexto?: { url?: string; extra?: unknown },
): Promise<void> {
  try {
    const erro: ErroPendente = {
      message: extrairMensagem(err),
      stack: extrairStack(err),
      versao: getVersao(),
      url: contexto?.url,
      userAgent: getUserAgent(),
      extra: contexto?.extra,
      capturadoEm: new Date().toISOString(),
    };

    // Adiciona à fila local primeiro
    await adicionarPendente(erro);

    // Tenta enviar
    void enviarPendentes();
  } catch {
    /* Não pode jogar do error reporter — silencioso */
  }
}

/** Tenta enviar todos os erros pendentes ao backend. */
export async function enviarPendentes(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const tokens = await loadTokens();
    if (!tokens?.accessToken) return; // só envia se logado

    const pendentes = await getPendentes();
    if (pendentes.length === 0) return;

    const enviados: number[] = [];
    for (let i = 0; i < pendentes.length; i++) {
      try {
        await api.post("/errors/motorista", pendentes[i]);
        enviados.push(i);
      } catch {
        // Para o loop — provavelmente offline. Tenta de novo depois.
        break;
      }
    }

    if (enviados.length > 0) {
      const restantes = pendentes.filter((_, i) => !enviados.includes(i));
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(restantes));
    }
  } finally {
    inFlight = false;
  }
}

async function getPendentes(): Promise<ErroPendente[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ErroPendente[]) : [];
  } catch {
    return [];
  }
}

async function adicionarPendente(erro: ErroPendente): Promise<void> {
  const cur = await getPendentes();
  cur.push(erro);
  // Mantém só os MAX_PENDENTES mais recentes (evita encher AsyncStorage)
  const trimmed = cur.slice(-MAX_PENDENTES);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

function extrairMensagem(err: unknown): string {
  if (err instanceof Error) return err.message ?? "Error";
  if (typeof err === "string") return err.slice(0, 500);
  try {
    return JSON.stringify(err).slice(0, 500);
  } catch {
    return "Unknown error";
  }
}

function extrairStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack.slice(0, 20_000);
  return undefined;
}

function getVersao(): string {
  const ver = Constants.expoConfig?.version ?? "?";
  const update = Constants.expoConfig?.runtimeVersion ?? "?";
  return `${ver}+${update}`;
}

function getUserAgent(): string {
  const platform = Platform.OS;
  const version = Platform.Version;
  return `Ronan/${getVersao()} ${platform}/${version}`;
}

/**
 * Instala handlers globais. Chama uma vez no _layout.tsx.
 */
export function instalarHandlersGlobais(): void {
  if (typeof ErrorUtils === "undefined") return;

  const original = ErrorUtils.getGlobalHandler?.();

  ErrorUtils.setGlobalHandler?.((err: unknown, isFatal?: boolean) => {
    void reportarErro(err, { extra: { isFatal } });
    if (original) original(err as Error, isFatal);
  });
}
