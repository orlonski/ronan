// Mini "bridge" pra passar o local recem-criado da tela /local-novo
// de volta pra Nova Viagem. Evita gymnastics de URL params + tipos.
import type { Local } from "./queries";

type Pending = { side: "carga" | "descarga"; local: Local } | null;

let pending: Pending = null;

export function setPendingLocal(p: Pending): void {
  pending = p;
}

export function consumePendingLocal(): Pending {
  const p = pending;
  pending = null;
  return p;
}
