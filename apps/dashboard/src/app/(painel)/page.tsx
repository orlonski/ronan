"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  Bug,
  Building2,
  CalendarClock,
  ClipboardList,
  Clock,
  Droplet,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Hourglass,
  Package,
  Send,
  Truck,
  User as UserIcon,
  Users,
  Weight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { LoadingCard } from "@/components/loading";
import { TendenciaChart } from "@/components/tendencia-chart";
import { AnalisesChart } from "@/components/analises-chart";
import { StatCard } from "@/components/stat-card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { fmtBRL, fmtNum } from "@/lib/fechamento-helpers";

type Snapshot = {
  hoje: {
    viagens: number;
    toneladas: string;
    motoristasAtivos: number;
    veiculosEmUso: number;
  };
  mes: {
    viagens: number;
    toneladas: string;
    combustivelValor: string;
    pedagioValor: string;
  };
  pendencias: {
    fechamentosRevisao: number;
    enviosAbertos: number;
    viagensDivergentes: number;
    errosPendentes: number;
    aguardandoPeso: number;
    diariasAbertas: number;
  };
  conferencia: {
    total: number;
    conferidas: number;
    pendentes: number;
    ritmoDia: number;
    etaDias: number | null;
    tempoMedioDias: number | null;
  };
  tendenciaViagens: Array<{ dia: string; total: number; porStatus: Record<string, number> }>;
  analisesPorDia: Array<{ dia: string; humano: number; automatico: number }>;
  rankings: {
    motoristas: Array<{ id: string; nome: string; toneladas: string }>;
    clientes: Array<{ id: string; nome: string; viagens: number }>;
    materiais: Array<{ id: string; nome: string; toneladas: string }>;
  };
  ultimaAtividade: {
    ultimaViagemEm: string | null;
    ultimoAbastecimentoEm: string | null;
    ultimoFechamentoEm: string | null;
  };
};

export default function PainelHome() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: () => fetchApi<Snapshot>("/admin/dashboard", { token }),
  });

  const dataHoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const primeiroNome = session?.user?.name?.split(" ")[0] ?? "";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}
        </h1>
        <p className="text-sm capitalize text-muted-foreground">{dataHoje}</p>
      </header>

      {isLoading && <LoadingCard label="Carregando dashboard..." />}

      {data && (
        <>
          <BlocoHoje d={data} />
          <BlocoTendencia d={data} />
          <BlocoConferencia d={data} />
          <BlocoMes d={data} />
          <BlocoPendencias d={data} />
          <BlocoRankings d={data} />
          <UltimaAtividade d={data} />
        </>
      )}
    </div>
  );
}

function BlocoHoje({ d }: { d: Snapshot }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Hoje
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          icon={Truck}
          label="Viagens"
          value={d.hoje.viagens}
          info="Quantas viagens os motoristas registraram hoje."
          tone="info"
          size="lg"
        />
        <StatCard
          icon={Weight}
          label="Toneladas"
          value={fmtNum(d.hoje.toneladas, 1)}
          info="O peso total carregado nas viagens de hoje, somado em toneladas."
          tone="info"
          size="lg"
        />
        <StatCard
          icon={Users}
          label="Motoristas ativos"
          value={d.hoje.motoristasAtivos}
          subtitle="logaram hoje"
          info="Quantos motoristas diferentes abriram o app e entraram hoje."
          tone="success"
          size="lg"
        />
        <StatCard
          icon={Truck}
          label="Veículos em uso"
          value={d.hoje.veiculosEmUso}
          info="Quantos caminhões diferentes rodaram em viagens hoje."
          tone="success"
          size="lg"
        />
      </div>
    </section>
  );
}

function BlocoTendencia({ d }: { d: Snapshot }) {
  const totais = d.tendenciaViagens.map((x) => x.total);
  const total14d = totais.reduce((a, b) => a + b, 0);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Tendência
      </h2>
      <Card className="p-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              Viagens — últimos 14 dias
              <InfoHint text="Cada barra é um dia dos últimos 14 dias: mais alta = mais viagens naquele dia. As cores dentro da barra mostram o status das viagens daquele dia (veja a legenda abaixo). A barra destacada é o dia de pico e a linha pontilhada é a média diária. O número grande é o total das duas semanas." />
            </p>
            <p className="text-3xl font-bold tracking-tight tabular-nums">{total14d}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{primeiroDia(d.tendenciaViagens)}</p>
            <p>até hoje</p>
          </div>
        </div>
        <TendenciaChart data={d.tendenciaViagens} />
      </Card>
    </section>
  );
}

function BlocoConferencia({ d }: { d: Snapshot }) {
  const { total, conferidas, pendentes, ritmoDia, etaDias, tempoMedioDias } = d.conferencia;
  const pct = total > 0 ? Math.round((conferidas / total) * 100) : 0;

  const etaLabel =
    pendentes === 0
      ? "tudo em dia"
      : etaDias == null
        ? "sem ritmo"
        : etaDias <= 1
          ? "~1 dia"
          : `~${etaDias} dias`;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Conferência de viagens
      </h2>
      <Card className="space-y-5 p-5">
        <div>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                Conferido
                <InfoHint text="De todas as viagens já registradas, quantas já foram conferidas por alguém da equipe (marcadas como OK ou divergente). A barra verde mostra essa fatia." />
              </p>
              <p className="text-3xl font-bold tracking-tight tabular-nums">{pct}%</p>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{conferidas}</span> de{" "}
              <span className="tabular-nums">{total}</span> viagens
            </p>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <StatCard
            icon={ClipboardList}
            label="Pendentes"
            value={pendentes}
            subtitle="aguardando conferência"
            info="Viagens que ainda ninguém conferiu. Estão na fila esperando alguém olhar e marcar como OK ou divergente. Clique pra ver a lista."
            tone={pendentes > 0 ? "warning" : "success"}
            href="/viagens?status=ENVIADA"
          />
          <StatCard
            icon={Gauge}
            label="Ritmo"
            value={`${fmtNum(ritmoDia, 1)}/dia`}
            subtitle="média dos últimos 14 dias"
            info="Em média, quantas viagens a equipe está conferindo por dia, olhando as últimas 2 semanas."
            tone="info"
          />
          <StatCard
            icon={CalendarClock}
            label="Previsão p/ zerar"
            value={etaLabel}
            subtitle="nesse ritmo"
            info="Mantendo o ritmo atual, quanto tempo falta pra conferir todas as viagens que estão pendentes."
            tone={pendentes > 0 && etaDias != null ? "info" : "success"}
          />
          <StatCard
            icon={Hourglass}
            label="Tempo médio"
            value={fmtDuracaoDias(tempoMedioDias)}
            subtitle="da entrada à conferência"
            info="Quanto tempo, em média, uma viagem fica esperando desde que é registrada até alguém conferir."
            tone="default"
          />
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            Análises por dia — usuário x agente automático
            <InfoHint text="Quantas viagens foram conferidas por dia, separando o que foi decisão de alguém da equipe do que o sistema resolveu sozinho (IA aprovando automaticamente ou material que dispensa conferência). Ajuda a enxergar quanto do volume já anda sem gente no meio." />
          </p>
          <AnalisesChart data={d.analisesPorDia} />
        </div>
      </Card>
    </section>
  );
}

function fmtDuracaoDias(dias: number | null): string {
  if (dias == null) return "—";
  if (dias < 1) {
    const h = Math.max(1, Math.round(dias * 24));
    return `${h}h`;
  }
  return `${fmtNum(dias, 1)} dias`;
}

function BlocoMes({ d }: { d: Snapshot }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Este mês
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          icon={Truck}
          label="Viagens"
          value={d.mes.viagens}
          info="Total de viagens registradas desde o dia 1º deste mês até agora."
          tone="default"
        />
        <StatCard
          icon={Weight}
          label="Toneladas"
          value={fmtNum(d.mes.toneladas, 1)}
          info="Peso total carregado em todas as viagens deste mês, somado em toneladas."
          tone="default"
        />
        <StatCard
          icon={Fuel}
          label="Combustível"
          value={fmtBRL(d.mes.combustivelValor)}
          info="Quanto foi gasto em abastecimentos registrados neste mês."
          tone="default"
        />
        <StatCard
          icon={Droplet}
          label="Pedágios"
          value={fmtBRL(d.mes.pedagioValor)}
          info="Quanto foi gasto em pedágios nas viagens deste mês."
          tone="default"
        />
      </div>
    </section>
  );
}

function BlocoPendencias({ d }: { d: Snapshot }) {
  const tone = (n: number): "success" | "warning" => (n > 0 ? "warning" : "success");
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Precisa de atenção
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
        <StatCard
          icon={FileSpreadsheet}
          label="Fechamentos em revisão"
          value={d.pendencias.fechamentosRevisao}
          info="Fechamentos esperando alguém revisar antes de mandar pro cliente. Clique pra abrir."
          tone={tone(d.pendencias.fechamentosRevisao)}
          href="/fechamentos?status=AGUARDANDO_REVISAO"
        />
        <StatCard
          icon={Send}
          label="Envios prontos"
          value={d.pendencias.enviosAbertos}
          info="Arquivos de fechamento já gerados e prontos pra enviar ao cliente."
          tone={tone(d.pendencias.enviosAbertos)}
          href="/envios?status=GERADO"
        />
        <StatCard
          icon={AlertTriangle}
          label="Viagens divergentes"
          value={d.pendencias.viagensDivergentes}
          info="Viagens que foram conferidas e tinham algum problema (foto ruim, valor faltando, etc). O motorista precisa corrigir."
          tone={d.pendencias.viagensDivergentes > 0 ? "danger" : "success"}
          href="/viagens?status=DIVERGENTE"
        />
        <StatCard
          icon={Weight}
          label="Aguardando peso"
          value={d.pendencias.aguardandoPeso}
          info="Viagens lançadas sem o peso (romaneio no fim do dia). Não entram em fechamento até o motorista ou você completar o peso e o ticket."
          tone={tone(d.pendencias.aguardandoPeso)}
          href="/viagens?status=AGUARDANDO_PESO"
        />
        {/* Só aparece quando existe diária aberta: conta que não usa diária
            nunca vê um card zerado a mais no painel. */}
        {d.pendencias.diariasAbertas > 0 && (
          <StatCard
            icon={Clock}
            label="Diárias abertas"
            value={d.pendencias.diariasAbertas}
            info="Diárias em que o motorista marcou a entrada e ainda não marcou a saída. Não entram em fechamento até alguém informar a hora de saída."
            tone={tone(d.pendencias.diariasAbertas)}
            href="/viagens?status=AGUARDANDO_SAIDA"
          />
        )}
        <StatCard
          icon={Bug}
          label="Erros pendentes"
          value={d.pendencias.errosPendentes}
          info="Erros internos do sistema que ainda não foram resolvidos. Útil pro acompanhamento técnico."
          tone={d.pendencias.errosPendentes > 0 ? "danger" : "success"}
          href="/erros"
        />
      </div>
    </section>
  );
}

function BlocoRankings({ d }: { d: Snapshot }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Top do mês
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        <RankingCard
          icon={UserIcon}
          titulo="Motoristas"
          subtitulo="por toneladas"
          info="Os 5 motoristas que mais carregaram peso (em toneladas) neste mês."
          itens={d.rankings.motoristas.map((m) => ({
            nome: m.nome,
            valor: `${fmtNum(m.toneladas, 1)} t`,
          }))}
        />
        <RankingCard
          icon={Building2}
          titulo="Clientes"
          subtitulo="por viagens"
          info="Os 5 clientes que mais receberam viagens neste mês."
          itens={d.rankings.clientes.map((c) => ({
            nome: c.nome,
            valor: `${c.viagens} viagens`,
          }))}
        />
        <RankingCard
          icon={Package}
          titulo="Materiais"
          subtitulo="por toneladas"
          info="Os 5 materiais mais transportados (por peso) neste mês."
          itens={d.rankings.materiais.map((m) => ({
            nome: m.nome,
            valor: `${fmtNum(m.toneladas, 1)} t`,
          }))}
        />
      </div>
    </section>
  );
}

function RankingCard({
  icon: Icon,
  titulo,
  subtitulo,
  info,
  itens,
}: {
  icon: typeof UserIcon;
  titulo: string;
  subtitulo: string;
  info?: string;
  itens: Array<{ nome: string; valor: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
        {info && <InfoHint text={info} className="mt-0.5" />}
      </div>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {itens.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="truncate">{it.nome}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{it.valor}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function UltimaAtividade({ d }: { d: Snapshot }) {
  const items: Array<{ label: string; iso: string | null }> = [
    { label: "última viagem", iso: d.ultimaAtividade.ultimaViagemEm },
    { label: "último abastecimento", iso: d.ultimaAtividade.ultimoAbastecimentoEm },
    { label: "último fechamento", iso: d.ultimaAtividade.ultimoFechamentoEm },
  ];
  return (
    <section>
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        {items.map((it) => (
          <span key={it.label}>
            {it.label}: <span className="text-foreground">{tempoRelativo(it.iso)}</span>
          </span>
        ))}
      </Card>
    </section>
  );
}

function primeiroDia(tendencia: Array<{ dia: string }>): string {
  const dia = tendencia[0]?.dia;
  if (!dia) return "";
  const [y, m, d] = dia.split("-");
  return `${d}/${m}`;
}

function tempoRelativo(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}
