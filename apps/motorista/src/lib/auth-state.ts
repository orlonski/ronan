type Listener = () => void;
const listeners = new Set<Listener>();

let _state: boolean | null = null;

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
