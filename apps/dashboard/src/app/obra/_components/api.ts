"use client";

import type { SessaoPortalObra } from "@ronan/shared-types";

/**
 * O portal da obra fala com `encarregado/*` com o token opaco da sessão do
 * portal — nada de next-auth aqui: quem está do outro lado é o cliente da
 * transportadora, não um usuário do painel.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const CHAVE_SESSOES = "movatruck.obra.sessoes";
const CHAVE_ATIVA = "movatruck.obra.ativa";

/** Erro da API com o status, pra tela distinguir "sessão caiu" de "deu errado". */
export class ErroPortal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Mensagem humana do corpo de erro do Nest (string, {message}, ou {issues} do Zod). */
async function mensagemDe(res: Response): Promise<string> {
  const corpo = (await res.json().catch(() => null)) as
    | { message?: string | string[]; issues?: { message?: string }[] }
    | null;
  if (corpo?.issues?.[0]?.message) return corpo.issues[0].message;
  if (Array.isArray(corpo?.message)) return corpo.message[0] ?? "Algo deu errado.";
  if (typeof corpo?.message === "string") return corpo.message;
  if (res.status >= 500) return "Não conseguimos falar com o servidor agora. Tente de novo em instantes.";
  return "Algo deu errado. Tente de novo.";
}

export async function chamar<T>(
  caminho: string,
  opts: { token?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}/encarregado${caminho}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ErroPortal("Sem conexão. Confira a internet e tente de novo.", 0);
  }
  if (!res.ok) throw new ErroPortal(await mensagemDe(res), res.status);
  return (await res.json()) as T;
}

/** A foto do ticket exige a sessão no header — vira blob URL pro <img>. */
export async function baixarFoto(token: string, viagemId: string, fotoId: string): Promise<string> {
  const res = await fetch(`${API_URL}/encarregado/tickets/${viagemId}/fotos/${fotoId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ErroPortal("Foto indisponível", res.status);
  return URL.createObjectURL(await res.blob());
}

// ---- sessões guardadas no aparelho -----------------------------------------
// localStorage pode não existir (aba anônima, bloqueio): tudo em try/catch, e
// sem ele o portal funciona — só pede o código de novo.

export function lerSessoes(): SessaoPortalObra[] {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSOES);
    const lista = bruto ? (JSON.parse(bruto) as SessaoPortalObra[]) : [];
    const agora = Date.now();
    return lista.filter((s) => s?.token && new Date(s.expiraEm).getTime() > agora);
  } catch {
    return [];
  }
}

export function gravarSessoes(sessoes: SessaoPortalObra[]) {
  try {
    localStorage.setItem(CHAVE_SESSOES, JSON.stringify(sessoes));
  } catch {
    /* sem armazenamento: segue só nesta aba */
  }
}

export function lerAtiva(): string | null {
  try {
    return localStorage.getItem(CHAVE_ATIVA);
  } catch {
    return null;
  }
}

export function gravarAtiva(token: string | null) {
  try {
    if (token) localStorage.setItem(CHAVE_ATIVA, token);
    else localStorage.removeItem(CHAVE_ATIVA);
  } catch {
    /* idem */
  }
}

/** "AAAA-MM-DD" de hoje em Brasília (o celular pode estar em outro fuso). */
export function hojeBR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "qui, 02/10" */
export function diaCurto(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const semana = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return `${semana}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function numeroBR(v: string | number, casas = 0): string {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function reais(v: string | number): string {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Toneladas sem zeros inúteis: "14 t", "13,5 t". */
export function toneladas(v: string | number): string {
  return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t`;
}
