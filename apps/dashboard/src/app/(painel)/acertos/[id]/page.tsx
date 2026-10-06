"use client";

import { GastosNoAcerto } from "../../gastos-viagem/_components/cartoes";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CreditCard,
  FileDown,
  Lock,
  LockOpen,
  MessageCircle,
  Plus,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import { ITEM_ACERTO_LABEL, TIPOS_DEBITO_ACERTO, TIPOS_ITEM_MANUAL } from "@ronan/shared-types";
import type { ConferenciaDoAcerto, TipoItemAcertoTipo } from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { lerNumero } from "@/lib/numero";
import { AvisoNumero } from "@/components/aviso-numero";
import { useConfirm } from "@/components/confirm-dialog";

type Item = {
  id: string;
  tipo: TipoItemAcertoTipo;
  descricao: string;
  valor: string;
  motivo: string | null;
  automatico: boolean;
  /** "Este item saiu do acerto de DD/MM a DD/MM." — veio de outro acerto aberto. */
  puxadoDe: string | null;
  viagem: { id: string; data: string; ticket: string | null } | null;
};

type PagoNoCartao = ConferenciaDoAcerto["pagoNoCartao"][number];

type Acerto = {
  id: string;
  motorista: { id: string; nome: string; cpf: string; chavePix: string | null; chavePixAlteradaEm?: string | null };
  periodoInicio: string;
  periodoFim: string;
  status: "ABERTO" | "FECHADO" | "PAGO";
  creditos: string;
  debitos: string;
  liquido: string;
  vistoEm: string | null;
  pagoEm: string | null;
  pagoMeio: string | null;
  fechadoPor: { nome: string } | null;
  pagoPor: { nome: string } | null;
  observacao: string | null;
  itens: Item[];
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

export default function AcertoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequerTela chave="acertos.ver">
      <Conteudo id={id} />
    </RequerTela>
  );
}

function Conteudo({ id }: { id: string }) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { confirmar, ConfirmDialog } = useConfirm();

  const { data: a, isLoading } = useQuery({
    queryKey: ["acerto", id],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Acerto>(`/admin/acertos/${id}`, { token: token! }),
  });
  // O que conferir antes de fechar. Chave filha de ["acerto", id]: invalidar o
  // acerto recarrega a conferência junto.
  const { data: conf } = useQuery({
    queryKey: ["acerto", id, "conferencia"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<ConferenciaDoAcerto>(`/admin/acertos/${id}/conferencia`, { token: token! }),
  });
  const recarregar = () => queryClient.invalidateQueries({ queryKey: ["acerto", id] });

  async function acao(caminho: string, body?: Record<string, unknown>) {
    if (!token) return;
    setOcupado(true);
    setErro(null);
    try {
      await fetchApi(`/admin/acertos/${id}/${caminho}`, {
        token,
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["acerto", id] });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  /**
   * As duas transições mais irreversíveis do produto saíam em UM clique, em
   * verde, sem diálogo: o backend é explícito ("Acerto já pago não reabre.
   * Lance um ajuste no próximo acerto."), e o painel não dizia nada disso.
   * Verde é "confirmar/certo"; isto aqui é cuidado — daí o âmbar.
   */
  async function fecharAcerto() {
    if (!a) return;
    const ok = await confirmar({
      variant: "warning",
      title: `Fechar o acerto de ${a.motorista.nome}?`,
      description: `Trava o acerto em ${brl(a.liquido)} e já cria a conta a pagar com vencimento hoje. Depois de fechado, mudança só reabrindo.`,
      confirmLabel: "Fechar acerto",
      cancelLabel: "Voltar",
    });
    if (ok) await acao("fechar");
  }

  async function marcarPago() {
    if (!a) return;
    const ok = await confirmar({
      variant: "warning",
      title: `Marcar como pago o acerto de ${a.motorista.nome}?`,
      description: `Encerra o acerto em ${brl(a.liquido)}. Acerto pago NÃO reabre — se precisar corrigir, só lançando um ajuste no próximo acerto.`,
      confirmLabel: "Confirmar pagamento",
      cancelLabel: "Voltar",
    });
    if (ok) await acao("pagar", { meio: "PIX" });
  }

  /** Baixa o extrato em PDF (vem da API com o token). */
  async function baixarPdf() {
    if (!token) return;
    setErro(null);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/admin/acertos/${id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return setErro("Não consegui gerar o PDF do acerto.");
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "acerto.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Abre o WhatsApp com o link do extrato (vale 30 dias) pro parceiro. */
  async function mandarNoWhatsapp() {
    if (!token || !a) return;
    setErro(null);
    try {
      const r = await fetchApi<{ url: string; telefone: string | null }>(`/admin/acertos/${id}/link`, { token });
      const texto = `Olá, ${a.motorista.nome.split(" ")[0]}! Segue o extrato do seu acerto de ${dataBR(a.periodoInicio)} a ${dataBR(a.periodoFim)}: ${r.url}`;
      const digitos = (r.telefone ?? "").replace(/\D/g, "");
      const numero = digitos.length >= 10 && digitos.length <= 11 ? `55${digitos}` : digitos;
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (isLoading) return <LoadingCard />;
  if (!a) return <Card className="p-6 text-sm">Acerto não encontrado.</Card>;

  const aberto = a.status === "ABERTO";
  const cartaoPorItem = new Map((conf?.pagoNoCartao ?? []).map((c) => [c.itemId, c]));
  const creditos = a.itens.filter((i) => Number(i.valor) >= 0);
  const debitos = a.itens.filter((i) => Number(i.valor) < 0);

  return (
    <div className="space-y-6">
      <ConfirmDialog />
      <FormPageHeader
        title={`Acerto de ${a.motorista.nome}`}
        description={`${dataBR(a.periodoInicio)} a ${dataBR(a.periodoFim)}`}
        backHref="/acertos"
      />

      {erro && <Card className="border-l-4 border-l-red-500 p-4 text-sm">{erro}</Card>}

      {/* O número que interessa, e o estado dele */}
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">A receber</p>
            <p className="text-3xl font-bold tabular-nums">{brl(a.liquido)}</p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {composicaoDosCreditos(a.itens, a.creditos)}
              {Number(a.debitos) > 0 && <> − {brl(a.debitos)} de descontos</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void baixarPdf()} variant="outline">
              <FileDown className="h-4 w-4" /> Baixar PDF
            </Button>
            {/* Em aberto o número ainda muda: só manda pro parceiro depois de fechado. */}
            {a.status !== "ABERTO" && (
              <Button onClick={() => void mandarNoWhatsapp()} variant="outline">
                <MessageCircle className="h-4 w-4" /> Mandar no WhatsApp
              </Button>
            )}
            {a.status === "ABERTO" && (
              <Permitido chave="acertos.fechar">
                <Button onClick={() => void fecharAcerto()} disabled={ocupado} variant="warning">
                  <Lock className="h-4 w-4" /> Fechar acerto
                </Button>
              </Permitido>
            )}
            {a.status === "FECHADO" && (
              <>
                <Permitido chave="acertos.fechar">
                  <Button onClick={() => acao("reabrir")} disabled={ocupado} variant="outline">
                    <LockOpen className="h-4 w-4" /> Reabrir
                  </Button>
                </Permitido>
                <Permitido chave="acertos.pagar">
                  <Button onClick={() => void marcarPago()} disabled={ocupado} variant="warning">
                    <Wallet className="h-4 w-4" /> Marcar como pago
                  </Button>
                </Permitido>
              </>
            )}
            {a.status === "PAGO" && (
              <span className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <Check className="h-4 w-4" />
                Pago {a.pagoEm ? `em ${dataBR(a.pagoEm)}` : ""} {a.pagoMeio ? `· ${a.pagoMeio}` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span>CPF {a.motorista.cpf}</span>
          {a.motorista.chavePix ? (
            <span>
              PIX {a.motorista.chavePix}
              {/* Trocada pelo próprio motorista no app (com código no WhatsApp):
                  confira antes de pagar se a troca é recente. */}
              {a.motorista.chavePixAlteradaEm && (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">
                  chave alterada pelo motorista em {dataBR(a.motorista.chavePixAlteradaEm)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-amber-700">Sem chave PIX no cadastro</span>
          )}
          {a.fechadoPor && <span>Fechado por {a.fechadoPor.nome}</span>}
          {/* Acerto que o motorista não abriu não foi combinado com ele. */}
          {a.status !== "ABERTO" &&
            (a.vistoEm ? (
              <span className="text-emerald-700">Motorista viu o extrato</span>
            ) : (
              <span className="text-amber-700">Motorista ainda não abriu o extrato</span>
            ))}
        </div>
      </Card>

      {conf && (conf.pedagioEmDobro.length > 0 || conf.pedagiosTirados.length > 0) && (
        <PedagioEmDobro
          acertoId={id}
          aberto={aberto}
          grupos={conf.pedagioEmDobro}
          tirados={conf.pedagiosTirados}
          onMudou={recarregar}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ListaItens
          titulo="Ganhos e reembolsos"
          itens={creditos}
          vazio="Nada apurado no período."
          acertoId={id}
          podeRemover={aberto}
          cartaoPorItem={cartaoPorItem}
          onMudou={recarregar}
        />
        <ListaItens
          titulo="Descontos e adiantamentos"
          itens={debitos}
          vazio="Nenhum desconto lançado."
          acertoId={id}
          podeRemover={aberto}
          cartaoPorItem={cartaoPorItem}
          onMudou={recarregar}
        />
      </div>

      <GastosNoAcerto
        motoristaId={a.motorista.id}
        periodoInicio={a.periodoInicio}
        periodoFim={a.periodoFim}
        itens={a.itens}
        aberto={aberto}
      />
      {aberto && conf && conf.ficouDeFora.length > 0 && (
        <Permitido chave="acertos.gerar">
          <FicouDeFora acertoId={id} itens={conf.ficouDeFora} onIncluiu={recarregar} />
        </Permitido>
      )}

      {aberto && (
        <Permitido chave="acertos.gerar">
          <NovoItem acertoId={id} onCriou={recarregar} />
        </Permitido>
      )}

      {aberto && (
        <Permitido chave="acertos.gerar">
          <DescartarAcerto acertoId={id} nome={a.motorista.nome} />
        </Permitido>
      )}
    </div>
  );
}

function ListaItens({
  titulo,
  itens,
  vazio,
  acertoId,
  podeRemover,
  cartaoPorItem,
  onMudou,
}: {
  titulo: string;
  itens: Item[];
  vazio: string;
  acertoId: string;
  podeRemover: boolean;
  cartaoPorItem: Map<string, PagoNoCartao>;
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const { confirmar, ConfirmDialog } = useConfirm();

  async function remover(itemId: string) {
    if (!token) return;
    const ok = await confirmar({
      variant: "destructive",
      title: "Tirar este lançamento do acerto?",
      description: "O valor sai da conta deste período. Dá pra lançar de novo depois.",
      confirmLabel: "Remover lançamento",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    await fetchApi(`/admin/acertos/${acertoId}/itens/${itemId}`, { token, method: "DELETE" });
    onMudou();
  }

  return (
    <Card className="p-0">
      <ConfirmDialog />
      <p className="border-b px-4 py-3 text-sm font-semibold">{titulo}</p>
      {itens.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="divide-y">
          {itens.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{i.descricao}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {ITEM_ACERTO_LABEL[i.tipo]}
                  {!i.automatico && " · lançado à mão"}
                </p>
                {i.motivo && <p className="mt-1 text-xs italic text-muted-foreground">{i.motivo}</p>}
                {i.puxadoDe && (
                  <p className="mt-1 text-xs text-amber-800">{i.puxadoDe}</p>
                )}
                {cartaoPorItem.has(i.id) && <AvisoCartao c={cartaoPorItem.get(i.id)!} />}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`tabular-nums text-sm font-medium ${
                    Number(i.valor) < 0 ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  {Number(i.valor) < 0 ? "− " : ""}
                  {brl(String(Math.abs(Number(i.valor))))}
                </span>
                {/* Só o que foi digitado sai daqui. O que a regra gerou se conserta
                    corrigindo a viagem e gerando de novo. */}
                {podeRemover && !i.automatico && (
                  <Permitido chave="acertos.gerar">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover lançamento"
                      onClick={() => remover(i.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Permitido>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NovoItem({ acertoId, onCriou }: { acertoId: string; onCriou: () => void }) {
  const token = useAuthToken();
  const [form, setForm] = useState({
    tipo: "ADIANTAMENTO" as (typeof TIPOS_ITEM_MANUAL)[number],
    valor: "",
    descricao: "",
    motivo: "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const ehDebito = (TIPOS_DEBITO_ACERTO as readonly string[]).includes(form.tipo);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErro(null);
    // Lido pelo parser único: "2400.50" já foi lançado como R$ 240.050,00 aqui.
    const lido = lerNumero(form.valor);
    if (!lido.ok) return setErro("Não entendi esse valor. Use vírgula só uma vez — ex.: 2.400,50");
    const valor = lido.valor ?? 0;
    if (!(valor > 0)) return setErro("Informe um valor.");
    if (ehDebito && form.motivo.trim().length < 10) {
      return setErro("Desconto exige motivo escrito (pelo menos 10 letras).");
    }

    setSalvando(true);
    try {
      await fetchApi(`/admin/acertos/${acertoId}/itens`, {
        token,
        method: "POST",
        body: JSON.stringify({
          tipo: form.tipo,
          valor,
          descricao: form.descricao,
          motivo: form.motivo || undefined,
        }),
      });
      setForm({ tipo: form.tipo, valor: "", descricao: "", motivo: "" });
      onCriou();
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-semibold">Lançar adiantamento, desconto ou bônus</p>
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="item-tipo">O que é</Label>
            <Select
              id="item-tipo"
              value={form.tipo}
              onChange={(e) =>
                setForm({ ...form, tipo: e.target.value as (typeof TIPOS_ITEM_MANUAL)[number] })
              }
            >
              {TIPOS_ITEM_MANUAL.map((t) => (
                <option key={t} value={t}>
                  {ITEM_ACERTO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-valor">Valor (R$)</Label>
            <Input
              id="item-valor"
              inputMode="decimal"
              placeholder="ex: 300,00"
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })}
            />
            <AvisoNumero valor={form.valor} dinheiro />
            <p className="text-xs text-muted-foreground">
              {ehDebito ? "Entra descontando." : "Entra somando."} Digite sempre positivo.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-descricao">Descrição</Label>
            <Input
              id="item-descricao"
              placeholder="ex: Vale do dia 10"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
        </div>

        {ehDebito && (
          <div className="space-y-1">
            <Label htmlFor="item-motivo">Motivo do desconto</Label>
            <Input
              id="item-motivo"
              placeholder="Por que está sendo descontado"
              value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório. O motorista lê isso no extrato dele — tirar dinheiro sem explicar é
              o que vira briga no dia 30.
            </p>
          </div>
        )}

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={salvando}>
            <Plus className="h-4 w-4" /> Lançar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function dataHoraBR(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Reembolso de diesel que casa com uma passada no cartão-combustível da empresa
 * (mesma conciliação da tela do cartão). Não corta nada: quem decide é o
 * escritório — se foi mesmo o cartão, lança um desconto de combustível.
 */
function AvisoCartao({ c }: { c: PagoNoCartao }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>Pago no cartão da empresa?</strong> O extrato do cartão tem{" "}
        {brl(String(c.transacao.valor))} em {dataHoraBR(c.transacao.data)}
        {c.transacao.posto ? ` · ${c.transacao.posto}` : ""}
        {c.transacao.placa ? ` (${c.transacao.placa})` : ""}. Se foi o cartão, não há o que devolver —
        lance um desconto de combustível abaixo.
      </span>
    </p>
  );
}

/**
 * Possível pedágio em dobro: no mesmo dia, a viagem tem pedágio total e há um
 * pedágio avulso sem viagem. Pode ser o mesmo, pode não ser — a empresa decide,
 * e a decisão fica com o nome de quem tomou.
 */
function PedagioEmDobro({
  acertoId,
  aberto,
  grupos,
  tirados,
  onMudou,
}: {
  acertoId: string;
  aberto: boolean;
  grupos: ConferenciaDoAcerto["pedagioEmDobro"];
  tirados: ConferenciaDoAcerto["pedagiosTirados"];
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function chamar(chave: string, caminho: string, init: RequestInit) {
    if (!token) return;
    setOcupado(chave);
    setErro(null);
    try {
      await fetchApi(`/admin/acertos/${acertoId}/${caminho}`, { token, ...init });
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const decidir = (pedagioId: string, viagemId: string | undefined, decisao: string) =>
    chamar(pedagioId, "pedagio-dobro", {
      method: "POST",
      body: JSON.stringify({ pedagioId, viagemId, decisao }),
    });
  const desfazer = (pedagioId: string) =>
    chamar(pedagioId, `pedagio-dobro/${pedagioId}`, { method: "DELETE" });

  const pendentes = grupos.reduce((s, g) => s + g.pendentes, 0);

  return (
    <Card className={`p-0 ${pendentes > 0 ? "border-l-4 border-l-amber-500" : ""}`}>
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-semibold">
            {pendentes > 0 ? "Possível pedágio em dobro — conferir" : "Pedágio em dobro — conferido"}
          </p>
          <p className="text-xs text-muted-foreground">
            No mesmo dia o motorista lançou o pedágio na viagem e também um pedágio avulso. Pode ser o
            mesmo pedágio lançado duas vezes. Nada sai sozinho: você decide.
          </p>
        </div>
      </div>
      {erro && <p className="px-4 pt-3 text-sm text-destructive">{erro}</p>}
      <ul className="divide-y">
        {grupos.map((g) => (
          <li key={g.dia} className="space-y-3 px-4 py-3">
            <p className="text-sm font-medium">
              {dataBR(g.dia)}: viagem {brl(g.totalViagens)} · avulso {brl(g.totalAvulsos)}
            </p>
            {g.avulsos.map((av) => (
              <div key={av.pedagioId} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded bg-muted/50 p-2 text-xs">
                    <p className="font-medium text-muted-foreground">Na viagem</p>
                    {g.viagens.map((v) => (
                      <p key={v.itemId} className="tabular-nums">
                        {v.descricao} · {brl(v.valor)}
                      </p>
                    ))}
                  </div>
                  <div className="rounded bg-muted/50 p-2 text-xs">
                    <p className="font-medium text-muted-foreground">Avulso</p>
                    <p className="tabular-nums">
                      {av.descricao} · {brl(av.valor)}
                    </p>
                  </div>
                </div>
                {av.decisao ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-emerald-700">
                      São pedágios diferentes
                      {av.decisao.decididoPor ? ` — conferido por ${av.decisao.decididoPor}` : ""} em{" "}
                      {dataHoraBR(av.decisao.decididoEm)}
                    </span>
                    {aberto && (
                      <Permitido chave="acertos.gerar">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={ocupado === av.pedagioId}
                          onClick={() => void desfazer(av.pedagioId)}
                        >
                          <Undo2 className="h-4 w-4" /> Desfazer
                        </Button>
                      </Permitido>
                    )}
                  </div>
                ) : aberto ? (
                  <Permitido chave="acertos.gerar">
                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Button
                        size="sm"
                        variant="warning"
                        className="h-auto whitespace-normal py-2 text-left"
                        disabled={ocupado === av.pedagioId}
                        onClick={() =>
                          void decidir(av.pedagioId, g.viagens[0]?.viagemId, "MESMO_PEDAGIO")
                        }
                      >
                        É o mesmo pedágio (tirar o avulso deste acerto)
                      </Button>
                      <Button
                        size="sm"
                        variant="success"
                        className="h-auto whitespace-normal py-2"
                        disabled={ocupado === av.pedagioId}
                        onClick={() =>
                          void decidir(av.pedagioId, g.viagens[0]?.viagemId, "PEDAGIOS_DIFERENTES")
                        }
                      >
                        São pedágios diferentes
                      </Button>
                    </div>
                  </Permitido>
                ) : (
                  <p className="text-xs text-muted-foreground">Acerto fechado: não muda mais.</p>
                )}
              </div>
            ))}
          </li>
        ))}
        {tirados.map((t) => (
          <li
            key={t.pedagioId}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
          >
            <span>
              <span className="font-medium">{t.descricao}</span> · {brl(t.valor)} — tirado deste acerto
              (é o mesmo pedágio da viagem)
              {t.decididoPor ? `, por ${t.decididoPor}` : ""} em {dataHoraBR(t.decididoEm)}
            </span>
            {aberto && (
              <Permitido chave="acertos.gerar">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado === t.pedagioId}
                  onClick={() => void desfazer(t.pedagioId)}
                >
                  <Undo2 className="h-4 w-4" /> Desfazer (o avulso volta)
                </Button>
              </Permitido>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * "Ficou de fora de acertos anteriores": lançamento com data antes deste
 * período que nunca entrou em acerto (ex.: chegou do celular depois que o
 * acerto daquele período fechou). Nada entra sozinho — nada vem marcado.
 */
function FicouDeFora({
  acertoId,
  itens,
  onIncluiu,
}: {
  acertoId: string;
  itens: ConferenciaDoAcerto["ficouDeFora"];
  onIncluiu: () => void;
}) {
  const token = useAuthToken();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const total = itens
    .filter((i) => marcados.has(i.chave))
    .reduce((s, i) => s + Number(i.valor), 0);

  function alternar(chave: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  async function incluir() {
    if (!token || marcados.size === 0) return;
    setSalvando(true);
    setErro(null);
    try {
      await fetchApi(`/admin/acertos/${acertoId}/incluir-de-fora`, {
        token,
        method: "POST",
        body: JSON.stringify({ chaves: [...marcados] }),
      });
      setMarcados(new Set());
      onIncluiu();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">Ficou de fora de acertos anteriores</p>
        <p className="text-xs text-muted-foreground">
          Lançamentos de antes deste período que não entraram em nenhum acerto — por exemplo, o que
          chegou do celular depois que o acerto daquele período fechou. Marque o que entra neste acerto.
        </p>
      </div>
      <ul className="divide-y">
        {itens.map((i) => (
          <li key={i.chave}>
            <label className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3">
              <span className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={marcados.has(i.chave)}
                  onChange={() => alternar(i.chave)}
                />
                <span>
                  <span className="block text-sm font-medium">{i.descricao}</span>
                  <span className="block text-xs text-muted-foreground">{ITEM_ACERTO_LABEL[i.tipo]}</span>
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-sm font-medium text-emerald-700">
                {brl(i.valor)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {erro && <p className="px-4 pt-3 text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end px-4 py-3">
        <Button
          variant="success"
          disabled={salvando || marcados.size === 0}
          onClick={() => void incluir()}
        >
          <Plus className="h-4 w-4" />
          {marcados.size === 0
            ? "Marque o que incluir"
            : `Incluir ${marcados.size} no acerto (${brl(String(total))})`}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Descartar um acerto ABERTO gerado errado. Confirmação na própria tela, com
 * motivo escrito: o que ele tinha fica na auditoria, e os lançamentos ficam
 * livres pra outro acerto.
 */
function DescartarAcerto({ acertoId, nome }: { acertoId: string; nome: string }) {
  const token = useAuthToken();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function descartar() {
    if (!token) return;
    if (motivo.trim().length < 10) return setErro("Escreva o motivo (pelo menos 10 letras).");
    setSalvando(true);
    setErro(null);
    try {
      await fetchApi(`/admin/acertos/${acertoId}/descartar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/admin/acertos"] });
      router.push("/acertos");
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="flex justify-end">
        <Button variant="destructive" size="sm" onClick={() => setAberto(true)}>
          <Trash2 className="h-4 w-4" /> Descartar este acerto
        </Button>
      </div>
    );
  }

  return (
    <Card className="space-y-3 border-l-4 border-l-red-500 p-4">
      <p className="text-sm font-semibold">Descartar o acerto de {nome}?</p>
      <p className="text-sm text-muted-foreground">
        O acerto some da lista e os lançamentos dele ficam livres pra entrar em outro acerto. Os
        lançamentos feitos à mão aqui (adiantamento, desconto) se perdem. Fica registrado quem
        descartou e por quê.
      </p>
      <div className="space-y-1">
        <Label htmlFor="descartar-motivo">Por que descartar</Label>
        <Textarea
          id="descartar-motivo"
          placeholder="ex: gerado com o período errado"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setAberto(false)} disabled={salvando}>
          Voltar
        </Button>
        <Button variant="destructive" onClick={() => void descartar()} disabled={salvando}>
          <Trash2 className="h-4 w-4" /> Descartar acerto
        </Button>
      </div>
    </Card>
  );
}

/**
 * "R$ X de frete · R$ Y de reembolsos · R$ Z de bônus e ajustes" — o que compõe
 * os créditos do acerto, separado. Reembolso não é ganho: é o dinheiro dele
 * voltando (pedágio, abastecimento, gasto de viagem). Parte zerada some.
 * Sem item positivo nenhum, mostra o crédito total como veio da API.
 */
function composicaoDosCreditos(itens: Item[], creditosTotal: string): string {
  let frete = 0;
  let reembolsos = 0;
  let outros = 0;
  for (const i of itens) {
    const v = Number(i.valor);
    if (!(v > 0)) continue;
    if (i.tipo === "FRETE") frete += v;
    else if (i.tipo.startsWith("REEMBOLSO_")) reembolsos += v;
    else outros += v;
  }
  const partes = [
    frete > 0 ? `${brl(frete)} de frete` : null,
    reembolsos > 0 ? `${brl(reembolsos)} de reembolsos` : null,
    outros > 0 ? `${brl(outros)} de bônus e ajustes` : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : `${brl(creditosTotal)} de créditos`;
}
