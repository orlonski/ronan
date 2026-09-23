import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * O nome do cliente que paga embaixo da obra — só quando é diferente.
 * "CASTILHO / Castilho" repetido não ajuda o motorista; as duas obras da
 * Dromos precisam dizer de quem são.
 */
export function pagadorSeDiferente(obra: string, pagador: string | null | undefined): string | undefined {
  if (!pagador) return undefined;
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return norm(pagador) === norm(obra) ? undefined : pagador;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
