import type { Request } from "express";

/**
 * IP de origem, com UM proxy na frente (Traefik do Easypanel; sem Cloudflare —
 * os domínios apontam direto pra VPS).
 *
 * ⚠️ Pega o ÚLTIMO item do X-Forwarded-For, nunca o primeiro. O primeiro é o
 * que o CLIENTE mandou — qualquer um forja `X-Forwarded-For: 1.2.3.4` e troca
 * de "IP" a cada tentativa, furando o limite de tentativas do login e do
 * cadastro. O último é o que o proxy acrescentou (ou escreveu por cima): o
 * endereço de quem de fato conectou nele. Se um dia entrar um 2º proxy na
 * frente (Cloudflare), isto passa a devolver o IP dele e precisa contar as
 * camadas — o rate limit inteiro viraria um IP só.
 */
export function ipDaRequisicao(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const bruto = Array.isArray(fwd) ? fwd.join(",") : fwd;
  if (bruto) {
    const ips = bruto
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ips.length) return ips[ips.length - 1]!;
  }
  return req.ip ?? req.socket?.remoteAddress ?? "desconhecido";
}
