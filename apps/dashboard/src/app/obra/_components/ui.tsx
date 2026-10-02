"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

/**
 * Peças visuais do portal da obra. Cores EXPLÍCITAS (slate/emerald/blue), não
 * os tokens do tema do painel: quem abre é o cliente, no celular dele, e o
 * tema escolhido por alguém do escritório não pode pintar a tela da obra.
 *
 * Semáforo dos botões: verde confirma, azul é rotina, contorno volta/cancela.
 */
type Tom = "verde" | "azul" | "contorno";

const TOM: Record<Tom, string> = {
  verde: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
  azul: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
  contorno: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
};

export function Botao({
  tom = "azul",
  carregando,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tom?: Tom; carregando?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || carregando}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors disabled:opacity-50 ${TOM[tom]} ${className}`}
    >
      {carregando && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Cartao({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export function Campo({
  rotulo,
  id,
  dica,
  children,
}: {
  rotulo: string;
  id: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {rotulo}
      </label>
      {children}
      {dica && <p className="text-xs text-slate-500">{dica}</p>}
    </div>
  );
}

/** 16px de fonte: abaixo disso o Safari do iPhone dá zoom ao focar o campo. */
export const CLASSE_CAMPO =
  "block w-full min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";

export function Aviso({ tom = "erro", children }: { tom?: "erro" | "ok" | "info"; children: React.ReactNode }) {
  const cls =
    tom === "erro"
      ? "border-red-200 bg-red-50 text-red-800"
      : tom === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <div role={tom === "erro" ? "alert" : "status"} className={`rounded-xl border px-3 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function Selo({ tom, children }: { tom: "verde" | "azul" | "cinza" | "ambar" | "vermelho"; children: React.ReactNode }) {
  const cls = {
    verde: "bg-emerald-100 text-emerald-800",
    azul: "bg-blue-100 text-blue-800",
    cinza: "bg-slate-100 text-slate-700",
    ambar: "bg-amber-100 text-amber-900",
    vermelho: "bg-red-100 text-red-800",
  }[tom];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {texto}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
      <p className="font-medium text-slate-700">{titulo}</p>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
    </div>
  );
}
