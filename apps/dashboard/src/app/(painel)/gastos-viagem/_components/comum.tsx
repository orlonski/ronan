"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ICONES_TIPO_DESPESA, type CamposDoTipo, type PontoAtencaoDespesa } from "@ronan/shared-types";
import { useAuthToken } from "@/lib/client-api";
import { partesSP } from "@/lib/datetime-br";
import { cn } from "@/lib/utils";

/** Um gasto como o painel recebe (admin/despesas). */
export type GastoPainel = {
  id: string;
  clientId: string;
  motorista: { id: string; nome: string };
  veiculo: { id: string; placa: string } | null;
  tipo: {
    id: string;
    slug: string;
    nome: string;
    icone: string | null;
    devolve: boolean;
    podeCobrarCliente: boolean;
    manutencao: boolean;
  };
  camposDoTipo: CamposDoTipo;
  valorInformado: string;
  valorAprovado: string | null;
  data: string;
  sincronizadoEm: string;
  status: "COM_ESCRITORIO" | "APROVADA" | "NAO_REEMBOLSADA";
  motivo: string | null;
  decididoAutomatico: boolean;
  decididoPor: { id: string; nome: string } | null;
  decididoEm: string | null;
  vinculo: "SEM_RESPOSTA" | "VIAGEM" | "FORA_DE_VIAGEM";
  viagem: { id: string; resumo: string } | null;
  viagemClientId: string | null;
  descricao: string | null;
  litros: string | null;
  odometro: number | null;
  onde: string | null;
  semComprovanteMotivo: string | null;
  chaveFiscal: string | null;
  fotos: { id: string; rotacao: number }[];
  marcas: string[];
  pontos: PontoAtencaoDespesa[];
  semAtencao: boolean;
  acerto: { id: string; status: "ABERTO" | "FECHADO" | "PAGO"; periodoInicio: string; periodoFim: string } | null;
  doMes?: { quantidade: number; total: string; naoReembolsados: number };
};

export type TipoDespesaPainel = {
  id: string;
  slug: string;
  nome: string;
  icone: string | null;
  ativo: boolean;
  ordem: number;
  devolve: boolean;
  aprovaSozinhoAte: string | null;
  devolveNoMaximo: string | null;
  manutencao: boolean;
  podeCobrarCliente: boolean;
  campos: unknown;
  camposVersao: number;
  totalGastos: number;
};

export function brl(v: string | number | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "05/10 14:32" em horário de Brasília. */
export function diaHora(iso: string): string {
  const p = partesSP(new Date(iso));
  return `${p.dia}/${p.mes} ${p.hora}:${p.min}`;
}

export function diaSP(iso: string): string {
  const p = partesSP(new Date(iso));
  return `${p.ano}-${p.mes}-${p.dia}`;
}

export function emojiDoIcone(icone: string | null | undefined): string {
  return ICONES_TIPO_DESPESA.find((i) => i.chave === icone)?.emoji ?? "•••";
}

export function IconeTipo({ icone, className }: { icone: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-100 text-base dark:bg-sky-950",
        className,
      )}
    >
      {emojiDoIcone(icone)}
    </span>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Foto autenticada em blob URL (a rota exige login; o bucket nunca é público). */
export function useFotoBlob(caminho: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["foto-gasto", caminho],
    enabled: !!token && !!caminho,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_URL}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    },
  });
}

export function rotuloStatus(g: Pick<GastoPainel, "status" | "valorInformado" | "valorAprovado" | "decididoAutomatico" | "motivo">): {
  texto: string;
  cor: string;
} {
  if (g.status === "COM_ESCRITORIO") return { texto: "Com o escritório", cor: "bg-sky-100 text-sky-900" };
  if (g.status === "APROVADA") {
    const outro = g.valorAprovado != null && Number(g.valorAprovado) !== Number(g.valorInformado);
    return {
      texto: outro ? `Aprovado ${brl(g.valorAprovado)}` : g.decididoAutomatico ? "Aprovado sozinho" : "Aprovado",
      cor: outro ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900",
    };
  }
  return g.decididoAutomatico
    ? { texto: "Por conta do motorista", cor: "bg-muted text-muted-foreground" }
    : { texto: "Não reembolsado", cor: "bg-amber-100 text-amber-900" };
}

/** Texto de cada ponto de atenção (10-telas §10.1). */
export function textoDoPonto(p: PontoAtencaoDespesa): string {
  switch (p.tipo) {
    case "SEM_COMPROVANTE":
      return p.motivo ? `Sem comprovante. Ele escreveu: "${p.motivo}".` : "Sem comprovante.";
    case "FOTO_NAO_CHEGOU":
      return "A foto ainda está no celular do motorista.";
    case "ACIMA_DO_MAXIMO":
      return `Acima do máximo do tipo (${brl(p.maximo)}).`;
    case "POSSIVEL_REPETIDO":
      return `Parecido com ${p.resumo ?? "outro gasto"}.${p.confirmouQueEOutro ? " Ele confirmou no celular que é outro." : ""}`;
    case "CAMPO_EXIGIDO_AUSENTE":
      return "Faltou um campo que o tipo pede (o celular dele pode estar desatualizado).";
    case "TIPO_INATIVO":
      return "Lançado num tipo de gasto que já foi desativado.";
    case "SEM_VIAGEM":
      return p.sugestao
        ? `Sem viagem. Parece da viagem ${p.sugestao.resumo} (${p.sugestao.janela}).`
        : "Sem viagem.";
  }
}
