"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  Bug,
  Building2,
  Clock,
  Droplet,
  FileSpreadsheet,
  Fuel,
  Package,
  Send,
  Truck,
  User as UserIcon,
  Users,
  Weight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { LoadingCard } from "@/components/loading";
import { Sparkline } from "@/components/sparkline";
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
  };
  tendenciaViagens: Array<{ dia: string; total: number }>;
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
    queryKey: ["dashboard", token],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: () => fetchApi<Snapshot>("/admin/dashboard", { token }),
  });

  const dataHoje = new Date().toLocaleDateString("pt-BR", {
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={Truck}
          label="Viagens"
          value={d.hoje.viagens}
          tone="info"
          size="lg"
        />
        <StatCard
          icon={Weight}
          label="Toneladas"
          value={fmtNum(d.hoje.toneladas, 1)}
          tone="info"
          size="lg"
        />
        <StatCard
          icon={Users}
          label="Motoristas ativos"
          value={d.hoje.motoristasAtivos}
          subtitle="logaram hoje"
          tone="success"
          size="lg"
        />
        <StatCard
          icon={Truck}
          label="Veículos em uso"
          value={d.hoje.veiculosEmUso}
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
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Viagens — últimos 14 dias
            </p>
            <p className="text-3xl font-bold tracking-tight tabular-nums">{total14d}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{primeiroDia(d.tendenciaViagens)}</p>
            <p>até hoje</p>
          </div>
        </div>
        <Sparkline data={totais} height={70} />
      </Card>
    </section>
  );
}

function BlocoMes({ d }: { d: Snapshot }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Este mês
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Truck} label="Viagens" value={d.mes.viagens} tone="default" />
        <StatCard
          icon={Weight}
          label="Toneladas"
          value={fmtNum(d.mes.toneladas, 1)}
          tone="default"
        />
        <StatCard
          icon={Fuel}
          label="Combustível"
          value={fmtBRL(d.mes.combustivelValor)}
          tone="default"
        />
        <StatCard
          icon={Droplet}
          label="Pedágios"
          value={fmtBRL(d.mes.pedagioValor)}
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={FileSpreadsheet}
          label="Fechamentos em revisão"
          value={d.pendencias.fechamentosRevisao}
          tone={tone(d.pendencias.fechamentosRevisao)}
          href="/fechamentos"
        />
        <StatCard
          icon={Send}
          label="Envios prontos"
          value={d.pendencias.enviosAbertos}
          tone={tone(d.pendencias.enviosAbertos)}
          href="/envios"
        />
        <StatCard
          icon={AlertTriangle}
          label="Viagens divergentes"
          value={d.pendencias.viagensDivergentes}
          tone={d.pendencias.viagensDivergentes > 0 ? "danger" : "success"}
          href="/viagens"
        />
        <StatCard
          icon={Bug}
          label="Erros pendentes"
          value={d.pendencias.errosPendentes}
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
          itens={d.rankings.motoristas.map((m) => ({
            nome: m.nome,
            valor: `${fmtNum(m.toneladas, 1)} t`,
          }))}
        />
        <RankingCard
          icon={Building2}
          titulo="Clientes"
          subtitulo="por viagens"
          itens={d.rankings.clientes.map((c) => ({
            nome: c.nome,
            valor: `${c.viagens} viagens`,
          }))}
        />
        <RankingCard
          icon={Package}
          titulo="Materiais"
          subtitulo="por toneladas"
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
  itens,
}: {
  icon: typeof UserIcon;
  titulo: string;
  subtitulo: string;
  itens: Array<{ nome: string; valor: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
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
    day: "2-digit",
    month: "2-digit",
  });
}
