"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  History,
  LogOut,
  Minus,
  PhoneOff,
  type LucideIcon,
} from "lucide-react";
import type { CalendarioConferencia, DiaDoCalendarioConferencia } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/client-api";
import { cn } from "@/lib/utils";

const TZ = "America/Sao_Paulo";

/** "YYYY-MM" do mês atual em São Paulo (o servidor roda em UTC; o navegador pode estar em qualquer fuso). */
function mesAtualSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function somarMes(mes: string, n: number): string {
  const [a = 0, m = 1] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nomeDoMes(mes: string): string {
  const [a = 0, m = 1] = mes.split("-").map(Number);
  const t = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(a, m - 1, 1)),
  );
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const SEMANA_LONGA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const SEMANA_CURTA = ["D", "S", "T", "Q", "Q", "S", "S"];

function diaLongo(ymd: string): string {
  const [a = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const s = SEMANA_LONGA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? "";
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function dataHora(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  return {
    data: new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d),
    hora: new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d),
  };
}

type Tom = "verde" | "azul" | "amarelo" | "cinza" | "vermelho";
type Situacao = { chave: string; tom: Tom; Icone: LucideIcon; curto: string; longo: string };

const TOM: Record<Tom, string> = {
  verde: "border-emerald-200 bg-emerald-50 text-emerald-800",
  azul: "border-blue-200 bg-blue-50 text-blue-800",
  amarelo: "border-amber-300 bg-amber-50 text-amber-900",
  cinza: "border-slate-200 bg-slate-100 text-slate-700",
  vermelho: "border-red-200 bg-red-50 text-red-800",
};

const SEM_CANAL: Record<string, string> = {
  SEM_TELEFONE: "sem telefone cadastrado",
  NAO_ACEITA_WHATSAPP: "desligou as mensagens no WhatsApp",
  PAROU: "pediu pra parar de receber a pergunta",
  INALCANCAVEL: "o WhatsApp parece não entregar",
};

const LANCOU: Situacao = { chave: "lancou", tom: "verde", Icone: Check, curto: "Lançou", longo: "Lançou viagem" };
const RETRO: Situacao = {
  chave: "retro",
  tom: "azul",
  Icone: History,
  curto: "Depois",
  longo: "Lançou depois da pergunta",
};

/** A cor e o ícone do dia. Prioridade: lançou depois > o que respondeu > lançou. */
function situacaoDoDia(d: DiaDoCalendarioConferencia): Situacao | null {
  const p = d.pergunta;
  if (p?.retroativo) return RETRO;
  if (p && !d.lancou) {
    if (p.semCanal) return { chave: "semcanal", tom: "cinza", Icone: PhoneOff, curto: "Sem canal", longo: "Sem canal pra perguntar" };
    switch (p.estado) {
      case "RESPONDIDA":
        switch (p.resposta) {
          case "NAO_TIVE":
            return { chave: "naotive", tom: "cinza", Icone: Minus, curto: "Não tive", longo: "Respondeu: não teve viagem" };
          case "TIVE_NAO_LANCEI":
            return { chave: "tive", tom: "amarelo", Icone: AlertTriangle, curto: "Não lançou", longo: "Respondeu: teve e não lançou" };
          case "SAI_DA_EMPRESA":
            return { chave: "saiu", tom: "vermelho", Icone: LogOut, curto: "Saiu", longo: "Respondeu: saiu da empresa" };
          case "PARAR":
            return { chave: "parar", tom: "cinza", Icone: BellOff, curto: "Parou", longo: "Pediu pra parar as perguntas" };
          default:
            return { chave: "ambigua", tom: "amarelo", Icone: HelpCircle, curto: "Confuso", longo: "Resposta que o sistema não entendeu" };
        }
      case "ENVIADA":
        return { chave: "esperando", tom: "amarelo", Icone: Clock, curto: "Espera", longo: "Perguntado, esperando resposta" };
      case "EXPIRADA":
        return { chave: "semresposta", tom: "amarelo", Icone: HelpCircle, curto: "Sem resp.", longo: "Perguntado, sem resposta" };
      case "PENDENTE":
        return { chave: "fila", tom: "cinza", Icone: Clock, curto: "Na fila", longo: "Pergunta na fila de envio" };
      case "FALHOU":
        return { chave: "falhou", tom: "cinza", Icone: AlertTriangle, curto: "Não saiu", longo: "A pergunta não saiu" };
    }
  }
  if (d.lancou) return LANCOU;
  return null;
}

/** As situações da legenda: uma amostra de cada, na ordem de leitura. */
const LEGENDA: Situacao[] = [
  LANCOU,
  RETRO,
  { chave: "esperando", tom: "amarelo", Icone: Clock, curto: "", longo: "Esperando ou sem resposta" },
  { chave: "naotive", tom: "cinza", Icone: Minus, curto: "", longo: "Não teve viagem" },
  { chave: "saiu", tom: "vermelho", Icone: LogOut, curto: "", longo: "Saiu da empresa" },
  { chave: "semcanal", tom: "cinza", Icone: PhoneOff, curto: "", longo: "Sem canal" },
];

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function resumo(t: CalendarioConferencia["totais"]): string {
  const partes: string[] = [];
  if (t.perguntados > 0) partes.push(plural(t.perguntados, "pergunta", "perguntas"));
  if (t.respondidos > 0) partes.push(plural(t.respondidos, "resposta", "respostas"));
  if (t.retroativos > 0) partes.push(`${t.retroativos} lançou depois`);
  if (t.semResposta > 0) partes.push(`${t.semResposta} sem resposta`);
  if (t.semCanal > 0) partes.push(`${t.semCanal} sem canal`);
  return partes.join(" · ");
}

/** O que aconteceu no dia, em frases de quem opera. */
function detalhe(d: DiaDoCalendarioConferencia): string[] {
  const linhas: string[] = [];
  const p = d.pergunta;
  if (p) {
    if (p.enviadaEm) {
      const e = dataHora(p.enviadaEm);
      linhas.push(`Perguntamos em ${e.data} às ${e.hora}.`);
    } else if (p.semCanal) {
      linhas.push(`Não deu pra perguntar: ${SEM_CANAL[p.semCanal] ?? "sem canal de WhatsApp"}.`);
    } else if (p.estado === "PENDENTE") {
      linhas.push("A pergunta está na fila de envio.");
    } else if (p.estado === "FALHOU") {
      linhas.push("A pergunta não saiu.");
    }
    if (p.estado === "RESPONDIDA") {
      const r = p.respondidaEm ? dataHora(p.respondidaEm) : null;
      const rot: Record<string, string> = {
        NAO_TIVE: "Não tive",
        TIVE_NAO_LANCEI: "Tive, não lancei",
        SAI_DA_EMPRESA: "Saí da empresa",
        PARAR: "Parar perguntas",
        AMBIGUA: "resposta que o sistema não entendeu",
      };
      linhas.push(`Respondeu: ${(p.resposta && rot[p.resposta]) ?? "—"}${r ? ` às ${r.hora}` : ""}.`);
    } else if (p.estado === "ENVIADA") {
      linhas.push("Esperando resposta.");
    } else if (p.estado === "EXPIRADA") {
      linhas.push("Não respondeu.");
    }
    if (p.retroativo && p.lancouDepoisEm) {
      const l = dataHora(p.lancouDepoisEm);
      linhas.push(
        `Depois lançou ${plural(p.viagensDepois, "viagem", "viagens")} em ${l.data} às ${l.hora} (retroativo).`,
      );
    }
  }
  if (d.lancou && !d.pergunta?.retroativo) {
    linhas.push(
      d.pergunta
        ? `Neste dia há ${plural(d.viagens, "viagem lançada", "viagens lançadas")}, todas de antes da pergunta.`
        : `Lançou ${plural(d.viagens, "viagem", "viagens")} neste dia.`,
    );
  } else if (d.lancou && d.viagens > (d.pergunta?.viagensDepois ?? 0)) {
    const antes = d.viagens - (d.pergunta?.viagensDepois ?? 0);
    linhas.push(`${plural(antes, "viagem já estava lançada", "viagens já estavam lançadas")} antes da pergunta.`);
  }
  return linhas;
}

/**
 * Calendário mensal da conferência de viagens na ficha do motorista: o que ele
 * respondeu à pergunta e se lançou a viagem depois. Só leitura. Cada dia é
 * marcado com cor E ícone (nunca só cor), e o detalhe abre aqui mesmo, sem modal.
 */
export function ConferenciaCalendarioMotorista({ motoristaId }: { motoristaId: string }) {
  const atual = mesAtualSP();
  const [mes, setMes] = useState(atual);
  const [aberto, setAberto] = useState<string | null>(null);
  const q = useApiQuery<CalendarioConferencia>(
    `/admin/conferencia-diaria/motoristas/${motoristaId}/calendario?mes=${mes}`,
    { staleTime: 30_000 },
  );

  useEffect(() => setAberto(null), [mes]);

  const dados = q.data;
  const offset = dados ? new Date(`${dados.dias[0]?.dia}T00:00:00Z`).getUTCDay() : 0;
  const escolhido = dados?.dias.find((d) => d.dia === aberto) ?? null;
  const vazio = !!dados && dados.totais.perguntados + dados.totais.semCanal === 0 && !dados.dias.some((d) => d.pergunta);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Conferência de viagens</h2>
          <p className="text-sm text-muted-foreground">
            {dados ? (vazio ? "Sem perguntas neste mês" : resumo(dados.totais)) : " "}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => setMes(somarMes(mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium" aria-live="polite">
            {nomeDoMes(mes)}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Próximo mês"
            disabled={mes >= atual}
            onClick={() => setMes(somarMes(mes, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setMes(atual)} disabled={mes === atual}>
            Hoje
          </Button>
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.isError && <p className="text-sm text-red-700">Não deu pra carregar o calendário. Tente de novo.</p>}

      {dados && (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground" aria-hidden>
            {SEMANA_CURTA.map((s, i) => (
              <div key={i}>{s}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => (
              <div key={`v${i}`} />
            ))}
            {dados.dias.map((d) => {
              const s = situacaoDoDia(d);
              const numero = Number(d.dia.slice(8));
              const ehHoje = d.dia === dados.hoje;
              const rotulo = `${diaLongo(d.dia)}${s ? `: ${s.longo}` : ""}`;
              return (
                <button
                  key={d.dia}
                  type="button"
                  disabled={!s}
                  aria-label={rotulo}
                  aria-pressed={aberto === d.dia}
                  onClick={() => setAberto(aberto === d.dia ? null : d.dia)}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-between rounded-md border p-1 text-xs sm:min-h-16",
                    s ? TOM[s.tom] : "border-transparent bg-muted/30 text-muted-foreground",
                    s && "cursor-pointer hover:brightness-95",
                    !s && "cursor-default",
                    aberto === d.dia && "ring-2 ring-foreground/60",
                    ehHoje && "outline outline-2 outline-offset-1 outline-primary",
                  )}
                >
                  <span className="font-semibold">{numero}</span>
                  {s && <s.Icone className="h-4 w-4" aria-hidden />}
                  {s ? (
                    <span className="hidden text-[10px] leading-tight sm:block">{s.curto}</span>
                  ) : (
                    <span className="h-4" />
                  )}
                </button>
              );
            })}
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
            {LEGENDA.map((l) => (
              <li key={l.chave} className="flex items-center gap-1.5">
                <span className={cn("flex h-5 w-5 items-center justify-center rounded border", TOM[l.tom])}>
                  <l.Icone className="h-3 w-3" aria-hidden />
                </span>
                {l.longo}
              </li>
            ))}
          </ul>

          {escolhido && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm" role="region" aria-label="Detalhe do dia">
              <p className="font-medium">
                {diaLongo(escolhido.dia)}
                {(() => {
                  const s = situacaoDoDia(escolhido);
                  return s ? ` — ${s.longo}` : "";
                })()}
              </p>
              {detalhe(escolhido).map((l, i) => (
                <p key={i} className="mt-1 text-muted-foreground">
                  {l}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
