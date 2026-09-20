"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { usePermissoes } from "@/lib/permissoes";
import { diaBr, PATH, PrecisaFundamento, useConfigPonto } from "../_lib";

type Correcao = {
  id: string;
  dia: string;
  tipo: "INCLUSAO" | "DESCONSIDERACAO" | "ANOTACAO";
  motivo: string;
  motivoCodigo: string;
  status: "PENDENTE" | "APROVADA" | "RECUSADA";
  pedidoPor: "FUNCIONARIO" | "GESTOR";
  instantePretendido: string | null;
  cienciaEm: string | null;
  cienciaPresencial: boolean;
  decisaoMotivo: string | null;
  funcionario: { id: string; nome: string; cargo: string | null };
};

const ROTULO_TIPO: Record<Correcao["tipo"], string> = {
  INCLUSAO: "Incluir batida",
  DESCONSIDERACAO: "Desconsiderar batida",
  ANOTACAO: "Anotação no dia",
};

/**
 * ACERTO DE PONTO: o que a pessoa pediu e o que o escritório lançou.
 *
 * ⚠️ A assimetria é deliberada, e é a mesma do mensal: o gestor INCLUI e
 * DESCONSIDERA, mas não apaga a batida de quem bateu — e a pessoa é sempre
 * notificada. Ajuste que ela não sabe que existe é o que mais anula controle
 * de jornada numa reclamatória.
 */
export default function CorrecoesPage() {
  return (
    <RequerTela chave="correcoes-ponto.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [status, setStatus] = useState<"PENDENTE" | "APROVADA" | "RECUSADA" | "">("PENDENTE");
  const [lancar, setLancar] = useState(false);
  const config = useConfigPonto();

  const lista = useQuery({
    queryKey: [PATH, "correcoes", status],
    enabled: !!token,
    queryFn: () =>
      fetchApi<Correcao[]>(`${PATH}/correcoes${status ? `?status=${status}` : ""}`, { token }),
  });

  const agir = useMutation({
    mutationFn: ({ id, acao, motivo }: { id: string; acao: string; motivo?: string }) =>
      fetchApi(`${PATH}/correcoes/${id}/${acao}`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo }),
      }),
    onSuccess: () => {
      toast.success("Pronto.");
      void qc.invalidateQueries({ queryKey: [PATH, "correcoes"] });
    },
    onError: (e: Error) => toast.error("Não consegui", { description: e.message }),
  });

  if (config.data && !config.data.fundamento) return <PrecisaFundamento />;

  const itens = lista.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <PenLine className="h-6 w-6 text-muted-foreground" />
            Acerto de ponto
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            O que o funcionário pediu e o que o escritório lançou. A batida original nunca é
            apagada — a correção é sempre linha nova, com autor e motivo.
          </p>
        </div>
        {temPermissao("correcoes-ponto.lancar") && (
          <Button onClick={() => setLancar(true)}>
            <Plus className="mr-1 h-4 w-4" /> Lançar correção
          </Button>
        )}
      </div>

      <div className="w-56">
        <Label htmlFor="cor-status">Mostrar</Label>
        <Select
          id="cor-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="PENDENTE">Esperando decisão</option>
          <option value="APROVADA">Aprovadas</option>
          <option value="RECUSADA">Recusadas</option>
          <option value="">Todas</option>
        </Select>
      </div>

      {itens.length === 0 ? (
        <EstadoVazio titulo="Nada aqui" descricao="Nenhuma correção nesse filtro." />
      ) : (
        <Card className="divide-y p-0">
          {itens.map((c) => (
            <div key={c.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/ponto/espelho/${c.funcionario.id}`}
                  className="font-medium hover:underline"
                >
                  {c.funcionario.nome}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {diaBr(c.dia)} · {ROTULO_TIPO[c.tipo]}
                  {c.instantePretendido
                    ? ` · ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(c.instantePretendido))}`
                    : ""}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  {c.pedidoPor === "GESTOR" ? "lançada pelo escritório" : "pedida por ele"}
                </span>
                {c.status === "APROVADA" && !c.cienciaEm && (
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                    ciência pendente
                  </span>
                )}
                {c.cienciaEm && (
                  <span className="text-xs text-muted-foreground">
                    {c.cienciaPresencial ? "ciência colhida presencialmente" : "ciência no app"}
                  </span>
                )}
              </div>
              <p className="text-sm">{c.motivo}</p>
              {c.decisaoMotivo && (
                <p className="text-sm text-muted-foreground">Decisão: {c.decisaoMotivo}</p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {c.status === "PENDENTE" && temPermissao("correcoes-ponto.decidir") && (
                  <>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={agir.isPending}
                      onClick={() => agir.mutate({ id: c.id, acao: "aprovar" })}
                    >
                      Aprovar
                    </Button>
                    <RecusarBotao onRecusar={(motivo) => agir.mutate({ id: c.id, acao: "recusar", motivo })} />
                  </>
                )}
                {c.status === "APROVADA" &&
                  !c.cienciaEm &&
                  temPermissao("correcoes-ponto.decidir") && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={agir.isPending}
                      onClick={() => agir.mutate({ id: c.id, acao: "ciencia-presencial" })}
                    >
                      Ciência colhida no papel
                    </Button>
                  )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {lancar && <DialogLancar onFechar={() => setLancar(false)} />}
    </div>
  );
}

function RecusarBotao({ onRecusar }: { onRecusar: (motivo: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  if (!aberto) {
    return (
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        Recusar
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input
        className="max-w-md flex-1"
        placeholder="Por que não foi aceita?"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
      />
      <Button size="sm" variant="outline" onClick={() => setAberto(false)}>
        Voltar
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={motivo.trim().length < 3}
        onClick={() => onRecusar(motivo)}
      >
        Recusar
      </Button>
    </div>
  );
}

function DialogLancar({ onFechar }: { onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    funcionarioId: "",
    dia: hojeSP(),
    tipo: "INCLUSAO" as Correcao["tipo"],
    hora: "08:00",
    motivoCodigo: "ESQUECEU",
    motivo: "",
  });

  const funcionarios = useQuery({
    queryKey: [PATH, "funcionarios", false],
    enabled: !!token,
    queryFn: () => fetchApi<{ id: string; nome: string }[]>(`${PATH}/funcionarios?inativos=false`, { token }),
  });

  const criar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/correcoes`, {
        token,
        method: "POST",
        body: JSON.stringify({
          funcionarioId: form.funcionarioId,
          dia: form.dia,
          tipo: form.tipo,
          instantePretendido:
            form.tipo === "INCLUSAO" ? new Date(`${form.dia}T${form.hora}:00-03:00`).toISOString() : undefined,
          motivoCodigo: form.motivoCodigo,
          motivo: form.motivo.trim(),
        }),
      }),
    onSuccess: () => {
      toast.success("Correção lançada.", {
        description: "Ele vai ver no app e precisa dar ciência.",
      });
      void qc.invalidateQueries({ queryKey: [PATH, "correcoes"] });
      onFechar();
    },
    onError: (e: Error) => toast.error("Não consegui lançar", { description: e.message }),
  });

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lançar correção</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="lc-func">Funcionário</Label>
            <Select
              id="lc-func"
              value={form.funcionarioId}
              onChange={(e) => setForm({ ...form, funcionarioId: e.target.value })}
            >
              <option value="">Escolha…</option>
              {(funcionarios.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="lc-dia">Dia</Label>
              <Input
                id="lc-dia"
                type="date"
                value={form.dia}
                onChange={(e) => setForm({ ...form, dia: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="lc-tipo">O que fazer</Label>
              <Select
                id="lc-tipo"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as Correcao["tipo"] })}
              >
                <option value="INCLUSAO">Incluir uma batida que faltou</option>
                <option value="ANOTACAO">Só anotar o que houve no dia</option>
              </Select>
            </div>
          </div>
          {form.tipo === "INCLUSAO" && (
            <div className="w-40">
              <Label htmlFor="lc-hora">Que horas</Label>
              <Input
                id="lc-hora"
                type="time"
                value={form.hora}
                onChange={(e) => setForm({ ...form, hora: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label htmlFor="lc-motivo">Motivo</Label>
            <Input
              id="lc-motivo"
              placeholder="O que aconteceu, com suas palavras"
              value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Obrigatório. Mexer no registro de jornada de alguém sem justificativa escrita é a
              mesma regra da alteração de km: não pode.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={!form.funcionarioId || form.motivo.trim().length < 3 || criar.isPending}
            onClick={() => criar.mutate()}
          >
            {criar.isPending ? "Lançando…" : "Lançar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
