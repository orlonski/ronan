/**
 * Sistema de alertas/confirmações custom (substitui Alert.alert do RN).
 *
 * API imperativa: `showAlert({...})` / `showConfirm({...})` retornam Promise.
 * Backend é um emitter singleton que o <AlertHost /> (montado em _layout.tsx)
 * consome pra renderizar o Modal estilizado. Chamadas feitas antes do host
 * subscribar entram na fila e são processadas na primeira atualização.
 */

export type AlertVariant = "default" | "warning" | "destructive";

export type AlertButton = {
  /** Texto do botão. */
  label: string;
  /** Valor resolvido pelo Promise. Se omitido, usa o label. */
  value?: string;
  /** Estilo visual. `cancel` é cinza/outline, `destructive` vermelho. */
  style?: "default" | "cancel" | "destructive";
};

export type AlertOptions = {
  title: string;
  message?: string;
  /** Estilo do ícone/borda. */
  variant?: AlertVariant;
  /** Botões em ordem. Default: `[{ label: "OK" }]`. */
  buttons?: AlertButton[];
  /** Se true, tocar fora fecha (resolve null). Default true. */
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

/**
 * Atalho pra confirmações sim/não. Resolve `true` se motorista confirmou,
 * `false` se cancelou ou descartou.
 */
export function showConfirm(opts: {
  title: string;
  message?: string;
  variant?: AlertVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Se true, botão de confirmar fica vermelho. */
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
