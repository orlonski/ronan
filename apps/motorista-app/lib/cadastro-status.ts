import * as SecureStore from "expo-secure-store";
import type { StatusMotorista } from "@ronan/shared-types";

// Store síncrono do status de aprovação do motorista logado. O AuthGate usa
// pra decidir entre o app normal e o modo "Cadastro em análise". Persistido no
// SecureStore pra um motorista PENDENTE que reabre offline ainda ver a tela
// certa. Atualizado no login, no confirmar-cadastro e no refresh.

const KEY = "ronan.motorista.status";

type Listener = () => void;
const listeners = new Set<Listener>();

// undefined = ainda não carregou; null = sem status conhecido (trata como aprovado,
// cobre motoristas logados de antes dessa feature — todos APROVADO).
let _status: StatusMotorista | null | undefined = undefined;

export function getCadastroStatus(): StatusMotorista | null | undefined {
  return _status;
}

export function setCadastroStatus(v: StatusMotorista): void {
  if (_status === v) return;
  _status = v;
  void SecureStore.setItemAsync(KEY, v).catch(() => {});
  for (const l of listeners) l();
}

/** Lê do SecureStore no boot. Retorna o status carregado (ou null). */
export async function loadCadastroStatus(): Promise<StatusMotorista | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    _status = (raw as StatusMotorista) ?? null;
  } catch {
    _status = null;
  }
  for (const l of listeners) l();
  return _status;
}

export async function clearCadastroStatus(): Promise<void> {
  _status = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
  for (const l of listeners) l();
}

export function subscribeCadastroStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
