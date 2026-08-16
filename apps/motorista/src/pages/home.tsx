import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CloudOff,
  Fuel,
  Plus,
  Receipt,
  Trash2,
  Truck,
  WifiOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/empty-state";
import { IosInstallPrompt } from "@/components/ios-install-prompt";
import { NotificationBell } from "@/components/notification-bell";
import { SeletorEmpresa } from "@/components/seletor-empresa";
import { ViagemCardSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { UpdateBanner } from "@/components/update-banner";
import { usePending } from "@/hooks/use-pending";
import { showAlert, showConfirm } from "@/lib/alert";
import { fmtDataHoraCurta, fmtDataCurta, fmtMesLongo } from "@/lib/datetime";
import { humanizeApiError } from "@/lib/api";
import {
  useExcluirViagem,
  useMe,
  useResumoMes,
  useViagens,
  type Viagem,
} from "@/lib/queries";
import { fmtNum } from "@/lib/utils";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  // Nunca "destructive": o motorista não causou nem resolve o que falta.
  INCOMPLETA: "warning",
  AJUSTADA: "secondary",
};

const statusLabel: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  // O escritório é que tem algo a preencher — pro motorista é conferência normal.
  INCOMPLETA: "Conferindo",
  AJUSTADA: "Ajustada",
};

export default function HomePage() {
  const navigate = useNavigate();
  const me = useMe();
  const viagens = useViagens();
  const resumo = useResumoMes();
  const pending = usePending();
  const excluir = useExcluirViagem();

  async function confirmarExcluir(v: Viagem) {
    const ok = await showConfirm({
      title: "Excluir esta viagem?",
      message: `Apagar viagem ticket ${v.ticket}? Isso só pode ser feito enquanto a operadora não conferiu.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await excluir.mutateAsync(v.id);
    } catch (err) {
      void showAlert({
        title: "Não foi possível excluir",
        message: humanizeApiError(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="bg-background">
      {/* Header brand */}
      <div className="bg-brand">
        <div className="flex items-start justify-between gap-3 px-5 pb-6 pt-safe">
          <div className="flex-1 pt-3">
            {/* No lugar do rótulo "Motorista" (que ele já sabe que é) vai a
                empresa pra qual está rodando — é o que muda o significado de
                tudo que vem abaixo. Some quando ele só tem uma. */}
            <SeletorEmpresa />
            {me.isLoading && (
              <p className="mt-1 text-sm text-white/70">Carregando...</p>
            )}
            {me.data && (
              <>
                <p className="mt-0.5 text-2xl font-bold text-white">{me.data.nome}</p>
                {me.data.veiculoDefault && (
                  <p className="mt-0.5 text-base font-medium text-white/80 tabular">
                    Placa {me.data.veiculoDefault.placa}
                  </p>
                )}
              </>
            )}
            {me.error && (
              <p className="mt-1 text-sm text-white/80">Perfil indisponível offline</p>
            )}
          </div>
          <div className="pt-3">
            <NotificationBell />
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-8 pt-4">
        <UpdateBanner />

        <IosInstallPrompt />

        {/* Não existe mais banner de erro aqui. Nenhum dos erros que apareciam
            neste lugar era causado pelo motorista, nem tinha como ser resolvido
            por ele — o card vermelho só dizia que o trabalho do dia deu errado.
            Hoje o servidor aceita o lançamento sempre e a pendência vai
            carimbada pro escritório. Sobra a tarja de "ainda não subiu". */}

        {pending.viagens + pending.pedagios + pending.abastecimentos > 0 && (
          <button
            type="button"
            onClick={() => navigate("/pendentes")}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-warning/30 bg-warning/15 p-4 text-left active:opacity-75"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning">
              <CloudOff size={22} color="#0f172a" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold text-foreground">
                {pending.viagens + pending.pedagios + pending.abastecimentos} aguardando
                sincronizar
              </p>
              <p className="text-sm text-muted-foreground">
                Sobem sozinhos quando o sinal voltar
              </p>
            </div>
          </button>
        )}

        {me.data?.podeLancarViagem && (
          <button
            type="button"
            onClick={() => navigate("/nova-viagem")}
            className="flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-primary p-5 text-left active:opacity-85"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
              <Truck size={32} color="white" strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <p className="text-2xl font-extrabold text-primary-foreground">Nova viagem</p>
              <p className="mt-0.5 text-base font-medium text-primary-foreground/85">
                Lançar carga, descarga e foto
              </p>
            </div>
            <Plus size={28} color="white" strokeWidth={2.5} />
          </button>
        )}

        {me.data?.podeLancarPedagio && (
          <button
            type="button"
            onClick={() => navigate("/novo-pedagio")}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 text-left active:opacity-75"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Receipt size={26} color="#13316b" strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold text-foreground">Pedágio</p>
              <p className="text-sm text-muted-foreground">Registrar passagem em praça</p>
            </div>
          </button>
        )}

        {me.data?.podeLancarAbastecimento && (
          <button
            type="button"
            onClick={() => navigate("/novo-abastecimento")}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 text-left active:opacity-75"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <Fuel size={26} color="#13316b" strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold text-foreground">Abastecimento</p>
              <p className="text-sm text-muted-foreground">Registrar combustível e odômetro</p>
            </div>
          </button>
        )}

        {me.data &&
          !me.data.podeLancarViagem &&
          !me.data.podeLancarPedagio &&
          !me.data.podeLancarAbastecimento && (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card p-6 text-center">
              <p className="text-base font-semibold text-foreground">
                Nenhuma funcionalidade liberada agora
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Fale com o escritório pra liberar lançamentos no app.
              </p>
            </div>
          )}

        {/* Resumo mês */}
        {resumo.data && resumo.data.totalViagens > 0 && (
          <div className="mt-3 rounded-2xl border-2 border-border bg-card p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Resumo de {fmtMesLongo(resumo.data.mes)}
            </p>
            <div className="mt-3 flex gap-6">
              <ResumoStat label="viagens" value={String(resumo.data.totalViagens)} />
              <ResumoStat label="t" value={fmtNum(resumo.data.totalToneladas, 1)} />
              <ResumoStat label="km" value={fmtNum(resumo.data.totalKm, 0)} />
            </div>
            {resumo.data.pedagios.count > 0 && (
              <div className="mt-3 flex gap-6 border-t-2 border-border pt-3">
                <ResumoStat label="pedágios" value={String(resumo.data.pedagios.count)} />
                <ResumoStat label="total" value={`R$ ${fmtNum(resumo.data.pedagios.totalValor, 2)}`} />
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Suas viagens recentes
        </p>

        {viagens.isLoading && (
          <div className="space-y-3">
            <ViagemCardSkeleton />
            <ViagemCardSkeleton />
            <ViagemCardSkeleton />
          </div>
        )}

        {!viagens.isLoading && viagens.error && (
          <EmptyState
            icon={WifiOff}
            title="Sem viagens disponíveis"
            description="Sem internet e sem viagens em cache."
            iconColor="#dc2626"
          />
        )}

        {!viagens.isLoading && !viagens.error && (viagens.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={Truck}
            title="Nenhuma viagem ainda"
            description='Toque em "Nova viagem" pra começar.'
          />
        )}

        <div className="space-y-3">
          {(viagens.data ?? []).map((v) => (
            <ViagemCard key={v.id} v={v} onExcluir={() => confirmarExcluir(v)} />
          ))}
        </div>

        {(viagens.data?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => navigate("/historico")}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
          >
            <span className="text-base font-bold text-foreground">Ver tudo</span>
            <ArrowRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function ViagemCard({ v, onExcluir }: { v: Viagem; onExcluir: () => void }) {
  const navigate = useNavigate();
  const variant = statusVariant[v.status] ?? "outline";
  const label = statusLabel[v.status] ?? v.status;
  const podeExcluir = v.status === "ENVIADA";

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-border bg-card">
      <button
        type="button"
        onClick={() => navigate(`/viagens/${v.id}`)}
        className="block w-full p-4 text-left active:opacity-75"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="truncate text-lg font-bold text-foreground">{v.cliente.nome}</p>
            <p className="mt-0.5 text-base font-medium text-muted-foreground tabular">
              {fmtDataCurta(v.data)} · {v.veiculo.placa}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground/80 tabular">
              Cadastrada {fmtDataHoraCurta(v.sincronizadoEm)}
            </p>
          </div>
          <Badge variant={variant}>{label}</Badge>
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <ArrowUp size={16} className="text-success" />
            <span className="flex-1 truncate text-base font-medium text-foreground">
              {v.localCarga.nome}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowDown size={16} className="text-destructive" />
            <span className="flex-1 truncate text-base font-medium text-foreground">
              {v.localDescarga.nome}
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-5 border-t-2 border-border pt-3">
          <Stat
            label="t"
            value={fmtNum(v.toneladasEfetiva, 3)}
            subValue={v.toneladasAjustada ? `(${fmtNum(v.toneladasInformada, 3)})` : undefined}
          />
          <Stat
            label="km"
            value={fmtNum(v.kmEfetivo, 2)}
            subValue={v.kmAjustada ? `(${fmtNum(v.kmInformado, 2)})` : undefined}
          />
          <Stat label="ticket" value={v.ticket} />
        </div>
      </button>
      {podeExcluir && (
        <button
          type="button"
          onClick={onExcluir}
          className="flex w-full items-center justify-center gap-2 border-t-2 border-border bg-muted py-2 text-sm font-bold text-destructive active:opacity-75"
        >
          <Trash2 size={16} /> Excluir
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, subValue }: { label: string; value: string; subValue?: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground tabular">{value}</p>
      {subValue && <p className="text-[10px] text-muted-foreground">{subValue}</p>}
    </div>
  );
}

function ResumoStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-extrabold text-foreground tabular">{value}</p>
    </div>
  );
}
