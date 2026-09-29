"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  Send,
  type LucideIcon,
} from "lucide-react";
import { JANELA_PERGUNTA_DE_TESTE_DIAS, formatTelefone } from "@ronan/shared-types";
import type {
  CalendarioConferencia,
  DadosTecnicosConferencia,
  DiaDoCalendarioConferencia,
  ResultadoPerguntaDeTeste,
  ResultadoReenvioPergunta,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
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

/** Soma dias a uma data civil (AAAA-MM-DD), sem passar por fuso. */
function somarDiasYmd(ymd: string, n: number): string {
  const [a = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * "Perguntar sobre este dia" só vale pra dia PASSADO (antes de hoje em São Paulo) e
 * dentro da janela. A API confere de novo: aqui só decide se o botão aparece.
 */
export function diaPodeSerPerguntado(dia: string, hoje: string): boolean {
  return dia < hoje && dia >= somarDiasYmd(hoje, -JANELA_PERGUNTA_DE_TESTE_DIAS);
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
  DESLIGADA_PAINEL: "a conferência está desligada pela empresa",
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
function detalhe(d: DiaDoCalendarioConferencia, hoje: string): string[] {
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
  if (!d.lancou) linhas.push(d.dia > hoje ? "Este dia ainda não chegou." : "Sem viagem lançada neste dia.");
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

const HORA_COMPLETA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const EVENTO_ROTULO: Record<string, string> = {
  ENVIO: "Envio",
  TOQUE: "Toque / resposta recebida",
  IGNORADO: "Ignorado",
  RESPOSTA_GRAVADA: "Resposta gravada",
  LEMBRETE: "Lembrete",
  EXPIRADA: "Expirou",
  REENVIO: "Reenvio pelo painel",
  TESTE: "Pergunta de teste pelo painel",
  STATUS: "Recibo da Meta",
};

const STATUS_META_ROTULO: Record<string, string> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falhou",
};

/** "Meta: entregue" / "Meta: falhou (131049) — <título>". */
export function rotuloEventoTrilha(e: { evento: string; detalhe: Record<string, unknown> }): string {
  if (e.evento !== "STATUS") return EVENTO_ROTULO[e.evento] ?? e.evento;
  const d = e.detalhe;
  const status = String(d.status ?? "");
  const nome = STATUS_META_ROTULO[status] ?? status;
  const alvo = d.alvo === "LEMBRETE" ? " (lembrete)" : "";
  if (status !== "failed") return `Meta: ${nome}${alvo}`;
  const cod = d.codigo != null ? ` (${String(d.codigo)})` : "";
  const titulo = typeof d.titulo === "string" && d.titulo ? ` — ${d.titulo}` : "";
  return `Meta: ${nome}${cod}${titulo}${alvo}`;
}

/** Um valor da trilha em uma linha só, pra caber no print. */
function valorCurto(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * "Dados técnicos" do dia: o que o dono precisa pra tirar print quando algo não
 * bate (estado da linha, wamid, e a trilha de tudo o que aconteceu com ela).
 * Recolhido por padrão; só chega pra quem tem `conferencia-diaria.decidir`.
 */
function DadosTecnicos({ t }: { t: DadosTecnicosConferencia }) {
  const campo = (rotulo: string, valor: string | null) => (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{rotulo}:</dt>
      <dd className="break-all font-mono">{valor ?? "—"}</dd>
    </div>
  );
  const quando = (iso: string | null) => (iso ? HORA_COMPLETA.format(new Date(iso)) : null);
  return (
    <details className="mt-3 rounded-md border bg-background p-2 text-xs">
      <summary className="cursor-pointer select-none font-medium">Dados técnicos</summary>
      <dl className="mt-2 space-y-0.5">
        {campo("Id da linha", t.id)}
        {campo("Estado", t.estado)}
        {campo("Opção", t.opcao)}
        {campo("wamid", t.wamid)}
        {campo("Enviada em", quando(t.enviadaEm))}
        {campo("Respondida em", quando(t.respondidaEm))}
        {campo("Texto da resposta", t.respostaTexto)}
        {campo("Erro de envio", t.erroEnvio)}
        {campo("Reenvios", String(t.reenvios))}
      </dl>
      <p className="mt-3 font-medium">Trilha ({t.trilha.length})</p>
      {t.trilha.length === 0 ? (
        <p className="text-muted-foreground">Nada registrado ainda para esta pergunta.</p>
      ) : (
        <ol className="mt-1 space-y-1.5">
          {t.trilha.map((e, i) => (
            <li key={i} className="rounded border bg-muted/30 p-1.5">
              <p>
                <span className="font-mono">{HORA_COMPLETA.format(new Date(e.em))}</span>{" "}
                <span className="font-semibold">{rotuloEventoTrilha(e)}</span>
              </p>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {Object.entries(e.detalhe)
                  .filter(([k]) => k !== "linhaId")
                  .map(([k, v]) => `${k}=${valorCurto(v)}`)
                  .join("  ")}
              </p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/**
 * "Reenviar pergunta": só no dia de hoje e só pra quem decide. A confirmação é
 * inline (nunca Modal). Depois de enviar, recarrega o calendário.
 */
function ReenviarPergunta({
  motoristaId,
  aoTerminar,
}: {
  motoristaId: string;
  aoTerminar: () => void;
}) {
  const token = useAuthToken();
  const [confirmando, setConfirmando] = useState(false);
  // O nome só é buscado quando a confirmação abre.
  const ficha = useApiQuery<{ nome: string }>(`/admin/motoristas/${motoristaId}`, {
    enabled: confirmando,
    staleTime: 60_000,
  });
  const nome = ficha.data?.nome ?? "este motorista";
  const envio = useMutation({
    mutationFn: () =>
      fetchApi<ResultadoReenvioPergunta>(`/admin/conferencia-diaria/motoristas/${motoristaId}/reenviar-pergunta`, {
        method: "POST",
        token,
      }),
    onSuccess: (r) => {
      setConfirmando(false);
      if (r.enviado) toast.success(`Pergunta reenviada para ${nome}`);
      else toast.error("A pergunta não saiu", { description: r.erro ?? "A Meta recusou o envio." });
      aoTerminar();
    },
    onError: (err: Error) => {
      setConfirmando(false);
      toast.error("Não foi possível reenviar", { description: err.message });
    },
  });

  if (!confirmando) {
    return (
      <Button className="mt-3" onClick={() => setConfirmando(true)}>
        <Send className="h-4 w-4" aria-hidden />
        Reenviar pergunta
      </Button>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900" role="alert">
      <p className="font-medium">Vai mandar de novo a pergunta por WhatsApp para {nome}.</p>
      <p className="mt-1 text-sm">
        A resposta de hoje volta a ficar esperando; o que ele já respondeu continua guardado nos dados técnicos.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="success" disabled={envio.isPending} onClick={() => envio.mutate()}>
          {envio.isPending ? "Enviando…" : "Reenviar agora"}
        </Button>
        <Button variant="outline" disabled={envio.isPending} onClick={() => setConfirmando(false)}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

type FichaParaTeste = {
  nome: string;
  telefone: string | null;
  aceitaWhatsapp?: boolean;
  receberConferenciaDiaria?: boolean;
  conferenciaDesligadaOrigem?: "MOTORISTA" | "PAINEL" | null;
  whatsappInalcancavelEm?: string | null;
};

/** Por que a pergunta não tem como chegar neste motorista; `null` = tem canal. */
export function motivoSemCanal(f: FichaParaTeste): string | null {
  if (!f.telefone) return "Este motorista está sem telefone cadastrado.";
  if (f.aceitaWhatsapp === false) return "Este motorista desligou as mensagens no WhatsApp.";
  if (f.receberConferenciaDiaria === false) {
    return f.conferenciaDesligadaOrigem === "PAINEL"
      ? "A conferência está desligada para este motorista pela empresa."
      : "Este motorista pediu pra parar de receber a pergunta.";
  }
  if (f.whatsappInalcancavelEm) return "O WhatsApp deste motorista parece não entregar (número suspeito).";
  return null;
}

/**
 * "Enviar pergunta de teste": sempre visível na ficha pra quem decide. Manda a
 * pergunta a ESTE motorista agora, sem depender do job nem da regra. Confirmação
 * inline (nunca Modal), com o nome e o telefone completo. Sem canal, mostra o
 * motivo em vez de deixar falhar depois.
 */
function EnviarPerguntaDeTeste({
  motoristaId,
  aoEnviar,
  dia,
}: {
  motoristaId: string;
  aoEnviar: (r: ResultadoPerguntaDeTeste) => void;
  /** AAAA-MM-DD: "Perguntar sobre este dia". Sem ele, é o teste do topo (último dia útil). */
  dia?: string;
}) {
  const token = useAuthToken();
  const [confirmando, setConfirmando] = useState(false);
  const ficha = useApiQuery<FichaParaTeste>(`/admin/motoristas/${motoristaId}`, { staleTime: 30_000 });
  const f = ficha.data;
  const motivo = f ? motivoSemCanal(f) : null;
  const envio = useMutation({
    mutationFn: () =>
      fetchApi<ResultadoPerguntaDeTeste>(`/admin/conferencia-diaria/motoristas/${motoristaId}/pergunta-de-teste`, {
        method: "POST",
        token,
        ...(dia ? { body: JSON.stringify({ dia }) } : {}),
      }),
    onSuccess: (r) => {
      setConfirmando(false);
      if (r.enviado) {
        toast.success(`Pergunta de teste enviada para ${f?.nome ?? "o motorista"}`, {
          description: `WhatsApp ${r.telefoneMascarado}`,
        });
      } else {
        toast.error("A pergunta de teste não saiu", { description: r.erro ?? "A Meta recusou o envio." });
      }
      aoEnviar(r);
    },
    onError: (err: Error) => {
      setConfirmando(false);
      toast.error("Não foi possível enviar a pergunta de teste", { description: err.message });
    },
  });

  if (confirmando && f?.telefone) {
    return (
      <div
        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
        role="alert"
        data-testid={dia ? "pergunta-dia-confirmacao" : "pergunta-teste-confirmacao"}
      >
        <p className="font-medium">
          Vai mandar de verdade, por WhatsApp, para {f.nome} no número {formatTelefone(f.telefone)}
          {dia ? `, perguntando sobre ${diaLongo(dia)}` : ""}.
        </p>
        <p className="mt-1 text-sm">Use só com motorista de teste seu ou com quem já combinou.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="success" disabled={envio.isPending} onClick={() => envio.mutate()}>
            {envio.isPending ? "Enviando…" : "Enviar agora"}
          </Button>
          <Button variant="outline" disabled={envio.isPending} onClick={() => setConfirmando(false)}>
            Voltar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        data-testid={dia ? "pergunta-dia-botao" : "pergunta-teste-botao"}
        disabled={!f || !!motivo}
        onClick={() => setConfirmando(true)}
      >
        <Send className="h-4 w-4" aria-hidden />
        {dia ? "Perguntar sobre este dia" : "Enviar pergunta de teste"}
      </Button>
      {motivo && (
        <p className="text-sm text-amber-800" data-testid={dia ? "pergunta-dia-motivo" : "pergunta-teste-motivo"}>
          {motivo} Não dá pra mandar a pergunta.
        </p>
      )}
    </div>
  );
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
  const { temPermissao, temModulo } = usePermissoes();
  const podeDecidir = temPermissao("conferencia-diaria.decidir");
  const podeTestar = podeDecidir && temModulo("conferencia-diaria.decidir");
  const qc = useQueryClient();
  // Dia a abrir depois de trocar de mês (o efeito abaixo limpa a seleção a cada troca).
  const abrirDepois = useRef<string | null>(null);
  const q = useApiQuery<CalendarioConferencia>(
    `/admin/conferencia-diaria/motoristas/${motoristaId}/calendario?mes=${mes}`,
    { staleTime: 30_000 },
  );

  useEffect(() => {
    setAberto(abrirDepois.current);
    abrirDepois.current = null;
  }, [mes]);

  /** Depois do teste: recarrega o calendário e abre o dia sobre o qual a pergunta fala. */
  function mostrarDiaPerguntado(r: ResultadoPerguntaDeTeste) {
    void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).includes("/conferencia-diaria/motoristas/") });
    const mesDoDia = r.diaPerguntado.slice(0, 7);
    if (mesDoDia === mes) setAberto(r.diaPerguntado);
    else {
      abrirDepois.current = r.diaPerguntado;
      setMes(mesDoDia);
    }
  }

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

      {podeTestar && <EnviarPerguntaDeTeste motoristaId={motoristaId} aoEnviar={mostrarDiaPerguntado} />}

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
              const futuro = d.dia > dados.hoje;
              const rotulo = `${diaLongo(d.dia)}: ${s ? s.longo : futuro ? "dia que ainda não chegou" : "sem viagem lançada"}`;
              return (
                <button
                  key={d.dia}
                  type="button"
                  aria-label={rotulo}
                  aria-pressed={aberto === d.dia}
                  onClick={() => setAberto(aberto === d.dia ? null : d.dia)}
                  className={cn(
                    "flex min-h-14 cursor-pointer flex-col items-center justify-between rounded-md border p-1 text-xs hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:min-h-16",
                    s ? TOM[s.tom] : "border-slate-200 bg-background text-muted-foreground",
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
              {detalhe(escolhido, dados.hoje).map((l, i) => (
                <p key={i} className="mt-1 text-muted-foreground">
                  {l}
                </p>
              ))}
              {escolhido.pergunta?.historica && (
                <p
                  className="mt-2 inline-block rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                  data-testid="selo-teste-anterior"
                >
                  teste anterior
                </p>
              )}
              {podeDecidir &&
                !escolhido.pergunta?.historica &&
                escolhido.pergunta?.linhaDia === dados.hoje &&
                escolhido.pergunta.estado !== "SUPRIMIDA" && (
                  <ReenviarPergunta key={escolhido.dia} motoristaId={motoristaId} aoTerminar={() => void q.refetch()} />
                )}
              {podeTestar && diaPodeSerPerguntado(escolhido.dia, dados.hoje) && (
                <div className="mt-3">
                  <EnviarPerguntaDeTeste
                    key={escolhido.dia}
                    motoristaId={motoristaId}
                    dia={escolhido.dia}
                    aoEnviar={mostrarDiaPerguntado}
                  />
                </div>
              )}
              {escolhido.pergunta?.tecnico && <DadosTecnicos t={escolhido.pergunta.tecnico} />}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
