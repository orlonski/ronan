// Pequeno store sincrono pra estado de auth.
// O AuthGate mostra a tela certa baseado no estado;
// login/logout chamam setAuthState pra atualizar imediatamente.

type Listener = () => void;
const listeners = new Set<Listener>();

let _state: boolean | null = null; // null = ainda nao carregou do SecureStore

export function getAuthState(): boolean | null {
  return _state;
}

export function setAuthState(v: boolean): void {
  if (_state === v) return;
  _state = v;
  for (const l of listeners) l();
}

export function subscribeAuth(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
