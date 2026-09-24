"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Plus, Undo2, Wallet } from "lucide-react";
import {
  AGING_LABEL_UI,
  FAIXAS_AGING,
  STATUS_TITULO_LABEL,
  type FaixaAgingTipo,
  type StatusTituloTipo,
} from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LoadingCard } from "@/components/loading";
import { StatCard } from "@/components/stat-card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { ErroCard } from "@/components/erro-estado";
import { AvisoNumero } from "@/components/aviso-numero";
import { formatarBRL, lerNumero } from "@/lib/numero";
import { hojeSP } from "@/lib/datetime-br";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";

type Aging = {
  faixas: Record<FaixaAgingTipo, string>;
  total: string;
  vencido: string;
};

type Resumo = {
  receber: Aging;
  pagar: Aging;
  maioresDevedores: { empresaId: string; nome: string; saldo: string }[];
};

type Titulo = {
  id: string;
  vencimento: string;
  valor: string;
  valorPago: string;
  status: StatusTituloTipo;
  parcela?: number;
  descricao?: string;
  empresa?: { id: string; nome: string };
  fatura?: { id: string; numero: number } | null;
  motorista?: { nome: string } | null;
  fornecedor?: { nome: string } | null;
  veiculo?: { placa: string } | null;
  baixas?: { id: string; valor: string; data: string; meio: string }[];
  acertoId?: string | null;
  observacao?: string | null;
};

function brl(v: string | number): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : String(v);
}

function dataBR(v: string): string {
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// "Hoje" em UTC marcaria como ATRASADA, depois das 21h de São Paulo, uma conta
// que só vence amanhã.
function atrasado(venc: string): boolean {
  return venc.slice(0, 10) < hojeSP();
}

export default function FinanceiroPage() {
  return (
    <RequerTela chave="financeiro.ver">
      <Conteudo />
    </RequerTela>
  );
}

type Aba = "resumo" | "receber" | "pagar";

function Conteudo() {
  const token = useAuthToken();
  const [aba, setAba] = React.useState<Aba>("resumo");

  const resumo = useQuery({
    queryKey: ["financeiro-resumo"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Resumo>("/admin/financeiro/resumo", { token: token! }),
  });

  return (
    <div className="space-y-5">
      <header>
        {/* O mesmo nome do item de menu que trouxe a pessoa até aqui. Clicar
            em "Contas a pagar e receber" e cair numa tela chamada
            "Financeiro" é pequeno e é desorientação do mesmo jeito. */}
        <h1 className="text-2xl font-semibold tracking-tight">Contas a pagar e receber</h1>
        <p className="text-sm text-muted-foreground">
          Quem está devendo, há quanto tempo, e o que você tem a pagar.
        </p>
      </header>

      <div className="flex gap-1 border-b">
        {(
          [
            ["resumo", "Resumo"],
            ["receber", "A receber"],
            ["pagar", "A pagar"],
          ] as const
        ).map(([chave, label]) => (
          <button
            key={chave}
            type="button"
            onClick={() => setAba(chave)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              aba === chave
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {aba === "resumo" && (
        <>
          {resumo.isLoading && <LoadingCard />}
          {!resumo.isLoading && resumo.isError && (
            <ErroCard erro={resumo.error} onRetry={() => void resumo.refetch()} />
          )}
          {resumo.data && <BlocoResumo r={resumo.data} />}
        </>
      )}
      {aba === "receber" && <ListaTitulos tipo="receber" />}
      {aba === "pagar" && <ListaTitulos tipo="pagar" />}
    </div>
  );
}

function BlocoResumo({ r }: { r: Resumo }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ArrowDownCircle}
          label="A receber"
          value={brl(r.receber.total)}
          info="Saldo em aberto de todos os títulos não pagos."
          tone="default"
        />
        <StatCard
          icon={AlertTriangle}
          label="Vencido a receber"
          value={brl(r.receber.vencido)}
          info="O que já passou do vencimento e não entrou."
          tone={Number(r.receber.vencido) > 0 ? "warning" : "default"}
        />
        <StatCard
          icon={ArrowUpCircle}
          label="A pagar"
          value={brl(r.pagar.total)}
          info="Contas em aberto: motorista, agregado, posto, oficina."
          tone="default"
        />
        <StatCard
          icon={AlertTriangle}
          label="Vencido a pagar"
          value={brl(r.pagar.vencido)}
          info="O que já venceu e ainda não saiu."
          tone={Number(r.pagar.vencido) > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">A receber por idade</p>
          <Aging aging={r.receber} />
        </Card>
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Quem mais deve</p>
          {r.maioresDevedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém em aberto.</p>
          ) : (
            <ul className="space-y-2">
              {r.maioresDevedores.map((d) => (
                <li key={d.empresaId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm">{d.nome}</span>
                  <span className="shrink-0 font-medium tabular-nums">{brl(d.saldo)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** As faixas que todo financeiro usa — é por elas que ele compara com o contador. */
function Aging({ aging }: { aging: Aging }) {
  const total = Number(aging.total) || 1;
  return (
    <ul className="space-y-2">
      {FAIXAS_AGING.map((f) => {
        const v = Number(aging.faixas[f]);
        const pct = Math.round((v / total) * 100);
        const vencida = f !== "A_VENCER" && f !== "VENCE_HOJE";
        return (
          <li key={f} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={vencida && v > 0 ? "text-amber-800" : ""}>{AGING_LABEL_UI[f]}</span>
              <span className="tabular-nums font-medium">{brl(aging.faixas[f])}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${vencida ? "bg-amber-500" : "bg-blue-500"}`}
                style={{ width: `${v > 0 ? Math.max(2, pct) : 0}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ListaTitulos({ tipo }: { tipo: "receber" | "pagar" }) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [soVencidos, setSoVencidos] = React.useState(false);
  const [baixando, setBaixando] = React.useState<string | null>(null);
  const [valorBaixa, setValorBaixa] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [cancelando, setCancelando] = React.useState<string | null>(null);
  const [motivoCancelar, setMotivoCancelar] = React.useState("");
  const { confirmar, ConfirmDialog } = useConfirm();

  const lista = useQuery({
    queryKey: ["titulos", tipo, soVencidos],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<{ data: Titulo[] }>(
        `/admin/financeiro/${tipo}?pageSize=100${soVencidos ? "&vencidos=true" : ""}`,
        { token: token! },
      ),
  });

  async function estornar(baixaId: string, valor: string) {
    if (!token) return;
    const ok = await confirmar({
      variant: "destructive",
      title: "Estornar esta baixa?",
      description: `Tira ${brl(valor)} do caixa e o título volta a ficar em aberto pelo valor que faltava.`,
      confirmLabel: "Estornar baixa",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      await fetchApi(`/admin/financeiro/baixas/${baixaId}`, { token, method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["titulos"] });
      await queryClient.invalidateQueries({ queryKey: ["financeiro-resumo"] });
      toast.success("Baixa estornada.");
    } catch (e) {
      toast.error("Não consegui estornar", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  // Conta lançada errado ou que não vai ser paga: fica como cancelada, com o
  // motivo, e sai dos totais. Só sem pagamento lançado e fora de acerto.
  async function cancelarConta(id: string) {
    if (!token) return;
    if (motivoCancelar.trim().length < 3) return setErro("Diga por que a conta foi cancelada.");
    setErro(null);
    try {
      await fetchApi(`/admin/financeiro/pagar/${id}/cancelar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo: motivoCancelar.trim() }),
      });
      setCancelando(null);
      setMotivoCancelar("");
      toast.success("Conta cancelada.");
      await queryClient.invalidateQueries({ queryKey: ["titulos"] });
      await queryClient.invalidateQueries({ queryKey: ["financeiro-resumo"] });
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function darBaixa(id: string) {
    if (!token) return;
    const lido = lerNumero(valorBaixa);
    if (!lido.ok) return setErro("Não entendi esse valor. Use vírgula só uma vez — ex.: 2.400,50");
    const valor = lido.valor ?? 0;
    if (!(valor > 0)) return setErro("Informe o valor recebido.");
    setErro(null);
    // Dinheiro entrando no caixa merece uma pergunta: o valor vai no texto
    // porque é justamente ele que saía errado quando digitado com ponto.
    const ok = await confirmar({
      variant: "warning",
      title: tipo === "receber" ? `Confirmar recebimento de ${formatarBRL(valor)}?` : `Confirmar pagamento de ${formatarBRL(valor)}?`,
      description: "Entra no caixa de hoje. Dá pra estornar depois, pelo botão na própria linha.",
      confirmLabel: tipo === "receber" ? "Confirmar recebimento" : "Confirmar pagamento",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    try {
      await fetchApi(`/admin/financeiro/${tipo}/${id}/baixa`, {
        token,
        method: "POST",
        body: JSON.stringify({ valor, meio: "PIX" }),
      });
      setBaixando(null);
      setValorBaixa("");
      await queryClient.invalidateQueries({ queryKey: ["titulos"] });
      await queryClient.invalidateQueries({ queryKey: ["financeiro-resumo"] });
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const titulos = lista.data?.data ?? [];

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <div className="flex items-center gap-2">
        <Button
          variant={soVencidos ? "default" : "outline"}
          size="sm"
          onClick={() => setSoVencidos((v) => !v)}
        >
          {soVencidos ? "Mostrando só vencidos" : "Ver só vencidos"}
        </Button>
        {tipo === "pagar" && (
          <Permitido chave="financeiro.faturar">
            <Link href="/financeiro/nova-conta">
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5" /> Lançar conta
              </Button>
            </Link>
          </Permitido>
        )}
      </div>

      {erro && <Card className="border-l-4 border-l-red-500 p-3 text-sm">{erro}</Card>}
      {lista.isLoading && <LoadingCard />}

      {!lista.isLoading && lista.isError && (
        <ErroCard erro={lista.error} onRetry={() => void lista.refetch()} />
      )}

      {!lista.isLoading && !lista.isError && titulos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {soVencidos ? "Nada vencido." : "Nenhum título em aberto."}
        </Card>
      )}

      {titulos.map((t) => {
        const saldo = Number(t.valor) - Number(t.valorPago);
        const venceu = atrasado(t.vencimento) && t.status !== "PAGO" && t.status !== "CANCELADO";
        const podeCancelar =
          tipo === "pagar" && t.status === "ABERTO" && (t.baixas ?? []).length === 0 && !t.acertoId;
        return (
          <Card key={t.id} className={`p-4 ${venceu ? "border-l-4 border-l-amber-500" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {tipo === "receber"
                    ? t.empresa?.nome
                    : (t.descricao ?? t.fornecedor?.nome ?? t.motorista?.nome)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  vence {dataBR(t.vencimento)}
                  {t.fatura && ` · fatura ${t.fatura.numero}`}
                  {t.parcela && t.parcela > 1 && ` · parcela ${t.parcela}`}
                  {t.veiculo && ` · ${t.veiculo.placa}`}
                </p>
                {t.status === "CANCELADO" && t.observacao && (
                  <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{t.observacao}</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{brl(saldo)}</p>
                {Number(t.valorPago) > 0 && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    de {brl(t.valor)} · pago {brl(t.valorPago)}
                  </p>
                )}
                <Badge
                  className={`mt-1 border-transparent ${
                    t.status === "PAGO"
                      ? "bg-emerald-100 text-emerald-700"
                      : venceu
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {venceu && t.status !== "PAGO" ? "Vencido" : STATUS_TITULO_LABEL[t.status]}
                </Badge>
              </div>
            </div>

            {t.status !== "PAGO" && t.status !== "CANCELADO" && (
              <Permitido chave="financeiro.baixar">
                {baixando === t.id ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                    <div className="space-y-1">
                      <Label htmlFor={`baixa-${t.id}`}>Valor</Label>
                      <Input
                        id={`baixa-${t.id}`}
                        inputMode="decimal"
                        className="w-36"
                        placeholder={saldo.toFixed(2)}
                        value={valorBaixa}
                        onChange={(e) => setValorBaixa(e.target.value)}
                      />
                      <AvisoNumero valor={valorBaixa} dinheiro />
                    </div>
                    <Button size="sm" variant="warning" onClick={() => void darBaixa(t.id)}>
                      {tipo === "receber" ? "Recebi" : "Paguei"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setBaixando(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setBaixando(t.id);
                        // Pré-preenche com o saldo: baixa total é o caso normal,
                        // e digitar de novo o número que já está na tela é atrito.
                        setValorBaixa(saldo.toFixed(2).replace(".", ","));
                      }}
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      {tipo === "receber" ? "Dar baixa no recebimento" : "Dar baixa no pagamento"}
                    </Button>
                    {(t.baixas ?? []).map((b) => (
                      <Button
                        key={b.id}
                        size="sm"
                        variant="ghost"
                        className="ml-2 text-muted-foreground"
                        onClick={() => void estornar(b.id, b.valor)}
                        title={`Baixa de ${brl(b.valor)} em ${dataBR(b.data)} por ${b.meio}`}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        Estornar {brl(b.valor)}
                      </Button>
                    ))}
                  </div>
                )}
              </Permitido>
            )}

            {podeCancelar && baixando !== t.id && (
              <Permitido chave="financeiro.faturar">
                {cancelando === t.id ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                    <div className="min-w-64 flex-1 space-y-1">
                      <Label htmlFor={`cancelar-${t.id}`}>Por que cancelar esta conta?</Label>
                      <Input
                        id={`cancelar-${t.id}`}
                        maxLength={300}
                        placeholder="Ex.: lançada em duplicidade; o serviço não foi feito"
                        value={motivoCancelar}
                        onChange={(e) => setMotivoCancelar(e.target.value)}
                      />
                    </div>
                    <Button size="sm" variant="warning" onClick={() => void cancelarConta(t.id)}>
                      Cancelar conta
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCancelando(null)}>
                      Voltar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => {
                        setCancelando(t.id);
                        setMotivoCancelar("");
                        setErro(null);
                      }}
                    >
                      Cancelar conta
                    </Button>
                  </div>
                )}
              </Permitido>
            )}
          </Card>
        );
      })}
    </div>
  );
}
