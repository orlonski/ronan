"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, LockOpen, Plus, Trash2, Wallet } from "lucide-react";
import { ITEM_ACERTO_LABEL, TIPOS_DEBITO_ACERTO, TIPOS_ITEM_MANUAL } from "@ronan/shared-types";
import type { TipoItemAcertoTipo } from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { lerNumero } from "@/lib/numero";
import { AvisoNumero } from "@/components/aviso-numero";

type Item = {
  id: string;
  tipo: TipoItemAcertoTipo;
  descricao: string;
  valor: string;
  motivo: string | null;
  automatico: boolean;
  viagem: { id: string; data: string; ticket: string | null } | null;
};

type Acerto = {
  id: string;
  motorista: { id: string; nome: string; cpf: string; chavePix: string | null };
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

function brl(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : v;
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

  const { data: a, isLoading } = useQuery({
    queryKey: ["acerto", id],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Acerto>(`/admin/acertos/${id}`, { token: token! }),
  });

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

  if (isLoading) return <LoadingCard />;
  if (!a) return <Card className="p-6 text-sm">Acerto não encontrado.</Card>;

  const aberto = a.status === "ABERTO";
  const creditos = a.itens.filter((i) => Number(i.valor) >= 0);
  const debitos = a.itens.filter((i) => Number(i.valor) < 0);

  return (
    <div className="space-y-6">
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
              {brl(a.creditos)} de ganhos
              {Number(a.debitos) > 0 && <> − {brl(a.debitos)} de descontos</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a.status === "ABERTO" && (
              <Permitido chave="acertos.fechar">
                <Button onClick={() => acao("fechar")} disabled={ocupado} variant="success">
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
                  <Button onClick={() => acao("pagar", { meio: "PIX" })} disabled={ocupado} variant="success">
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
            <span>PIX {a.motorista.chavePix}</span>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ListaItens
          titulo="Ganhos e reembolsos"
          itens={creditos}
          vazio="Nada apurado no período."
          acertoId={id}
          podeRemover={aberto}
          onMudou={() => queryClient.invalidateQueries({ queryKey: ["acerto", id] })}
        />
        <ListaItens
          titulo="Descontos e adiantamentos"
          itens={debitos}
          vazio="Nenhum desconto lançado."
          acertoId={id}
          podeRemover={aberto}
          onMudou={() => queryClient.invalidateQueries({ queryKey: ["acerto", id] })}
        />
      </div>

      {aberto && (
        <Permitido chave="acertos.gerar">
          <NovoItem
            acertoId={id}
            onCriou={() => queryClient.invalidateQueries({ queryKey: ["acerto", id] })}
          />
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
  onMudou,
}: {
  titulo: string;
  itens: Item[];
  vazio: string;
  acertoId: string;
  podeRemover: boolean;
  onMudou: () => void;
}) {
  const token = useAuthToken();

  async function remover(itemId: string) {
    if (!token) return;
    if (!confirm("Tirar este lançamento do acerto?")) return;
    await fetchApi(`/admin/acertos/${acertoId}/itens/${itemId}`, { token, method: "DELETE" });
    onMudou();
  }

  return (
    <Card className="p-0">
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
