/**
 * Sistema de alertas/confirmações custom (substitui window.confirm/alert).
 *
 * API imperativa: `showAlert({...})` / `showConfirm({...})` retornam Promise.
 * Backend é um emitter singleton que o <AlertHost /> (montado em App.tsx)
 * consome pra renderizar o modal estilizado. Chamadas feitas antes do host
 * subscribar entram na fila e são processadas na primeira atualização.
 */

export type AlertVariant = "default" | "warning" | "destructive";

export type AlertButton = {
  label: string;
  value?: string;
  style?: "default" | "cancel" | "destructive";
};

export type AlertOptions = {
  title: string;
  message?: string;
  variant?: AlertVariant;
  buttons?: AlertButton[];
  dismissible?: boolean;
};

type AlertRequest = {
  id: string;
  opts: AlertOptions;
  resolve: (value: string | null) => void;
};

let queue: AlertRequest[] = [];
let nextId = 1;
const subscribers = new Set<(q: AlertRequest[]) => void>();

function notify() {
  const snap = queue;
  subscribers.forEach((fn) => fn(snap));
}

export function subscribeAlert(fn: (q: AlertRequest[]) => void): () => void {
  subscribers.add(fn);
  fn(queue);
  return () => {
    subscribers.delete(fn);
  };
}

export function showAlert(opts: AlertOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: String(nextId++), opts, resolve }];
    notify();
  });
}

export function resolveAlert(id: string, value: string | null): void {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  notify();
  req.resolve(value);
}

export function showConfirm(opts: {
  title: string;
  message?: string;
  variant?: AlertVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return showAlert({
    title: opts.title,
    message: opts.message,
    variant: opts.variant ?? (opts.destructive ? "destructive" : "default"),
    buttons: [
      { label: opts.cancelLabel ?? "Cancelar", value: "cancel", style: "cancel" },
      {
        label: opts.confirmLabel ?? "Confirmar",
        value: "ok",
        style: opts.destructive ? "destructive" : "default",
      },
    ],
  }).then((v) => v === "ok");
}
