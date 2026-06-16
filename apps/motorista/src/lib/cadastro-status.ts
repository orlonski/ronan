import type { StatusMotorista } from "@ronan/shared-types";

// Store síncrono do status de aprovação do motorista logado. O AuthGate usa
// pra decidir entre o app normal e o modo "Cadastro em análise". Persistido no
// localStorage (lido no boot) pra um motorista PENDENTE que reabre o app ainda
// ver a tela certa. Atualizado no login, confirmar-cadastro e refresh.

const KEY = "ronan.motorista.status";

type Listener = () => void;
const listeners = new Set<Listener>();

// null = sem status conhecido (trata como aprovado — cobre motoristas logados
// de antes dessa feature, todos APROVADO).
let _status: StatusMotorista | null = readInicial();

function readInicial(): StatusMotorista | null {
  try {
    return (localStorage.getItem(KEY) as StatusMotorista) ?? null;
  } catch {
    return null;
  }
}

export function getCadastroStatus(): StatusMotorista | null {
  return _status;
}

export function setCadastroStatus(v: StatusMotorista): void {
  if (_status === v) return;
  _status = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignora */
  }
  for (const l of listeners) l();
}

export function clearCadastroStatus(): void {
  _status = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
  for (const l of listeners) l();
}

export function subscribeCadastroStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
