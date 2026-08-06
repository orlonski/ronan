import type { Request } from "express";

/** IP de origem, respeitando proxy (Easypanel/Traefik na frente). */
export function ipDaRequisicao(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const bruto = Array.isArray(fwd) ? fwd[0] : fwd;
  if (bruto) return bruto.split(",")[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? "desconhecido";
}
