"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Plus } from "lucide-react";
import { toast } from "sonner";
import { ClienteCombobox, MotoristaCombobox, VeiculoCombobox } from "@/components/fk-comboboxes";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Alocacao = {
  id: string;
  ativa: boolean;
  inicio: string;
  fim: string | null;
  valorDiaria: string | null;
  cliente: { id: string; nome: string };
  motorista: { id: string; nome: string; cpf: string };
  veiculo: { id: string; placa: string };
};

type LinhaGrade = {
  alocacao: { id: string; obra: string; motorista: string; placa: string };
  dias: { data: string; origem: "APP" | "PAINEL" }[];
  total: number;
};

const PATH = "/admin/mensal";

/** "2026-09-19" → "19/09". O ano some: a grade já é de um mês só. */
function diaMes(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Primeiro e último dia do mês, em AAAA-MM-DD. */
function limitesDoMes(ym: string): { de: string; ate: string } {
  const [a, m] = ym.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return { de: `${ym}-01`, ate: `${ym}-${String(ultimo).padStart(2, "0")}` };
}

function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * O mensal: quem está em qual obra, e quem marcou presença em cada dia.
 *
 * A grade é a razão da tela existir. Hoje a medição chega do contratante no
 * dia 20 preenchida à mão, e a transportadora não tem base própria pra
 * conferir — ela pergunta no grupo de WhatsApp e espera. Com a grade, a
 * conferência é olhar duas colunas.
 *
 * ⚠️ Não é controle de jornada. Não existe horário esperado, atraso nem falta:
 * o que se mostra é em que dias o caminhão esteve na obra. O motorista é
 * parceiro autônomo, e a diferença entre as duas coisas é a diferença entre um
 * contrato de transporte e uma ação trabalhista.
 */
export default function ObrasPage() {
  return (
    <RequerTela chave="alocacoes.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const [criando, setCriando] = useState(false);
  const [mes, setMes] = useState(mesAtual());

  const alocacoes = useQuery({
    queryKey: [PATH, "alocacoes"],
    enabled: !!token,
    queryFn: () => fetchApi<Alocacao[]>(`${PATH}/alocacoes?ativas=true`, { token }),
  });

  const { de, ate } = useMemo(() => limitesDoMes(mes), [mes]);

  const grade = useQuery({
    queryKey: [PATH, "presenca", de, ate],
    enabled: !!token && temPermissao("presenca.ver"),
    queryFn: () => fetchApi<LinhaGrade[]>(`${PATH}/presenca?de=${de}&ate=${ate}`, { token }),
  });

  const diasDoMes = useMemo(() => {
    const out: string[] = [];
    const fim = new Date(`${ate}T00:00:00.000Z`).getTime();
    for (let t = new Date(`${de}T00:00:00.000Z`).getTime(); t <= fim; t += 86_400_000) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }, [de, ate]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <HardHat className="h-6 w-6 text-muted-foreground" />
            Obras e diárias
          </h1>
          <p className="text-sm text-muted-foreground">
            Quem está em qual obra, e em que dias o caminhão esteve lá. É o que você leva pra
            conferir a medição.
          </p>
        </div>
        {temPermissao("alocacoes.criar") && (
          <Button onClick={() => setCriando(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Alocar em obra
          </Button>
        )}
      </div>

      <Card className="p-4">
        <p className="font-medium">Alocações ativas</p>
        {alocacoes.data?.length === 0 ? (
          <EstadoVazio
            titulo="Ninguém alocado ainda"
            descricao="Aloque um motorista numa obra pra ele passar a marcar presença pelo app."
          />
        ) : (
          <div className="mt-3 space-y-2">
            {(alocacoes.data ?? []).map((a) => (
              <LinhaAlocacao key={a.id} a={a} />
            ))}
          </div>
        )}
      </Card>

      {temPermissao("presenca.ver") && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-medium">Dias na obra</p>
              <p className="text-sm text-muted-foreground">
                Verde = o motorista marcou pelo app. Azul = lançado aqui no painel.
              </p>
            </div>
            <div className="w-44">
              <Label>Mês</Label>
              <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            </div>
          </div>

          {grade.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum dia marcado neste mês.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 bg-background p-2 text-left">Motorista</th>
                    {diasDoMes.map((d) => (
                      <th key={d} className="p-1 text-center font-normal text-muted-foreground">
                        {d.slice(-2)}
                      </th>
                    ))}
                    <th className="p-2 text-right">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {(grade.data ?? []).map((linha) => {
                    const porDia = new Map(linha.dias.map((x) => [x.data, x.origem]));
                    return (
                      <tr key={linha.alocacao.id} className="border-b">
                        <td className="sticky left-0 bg-background p-2">
                          <span className="font-medium">{linha.alocacao.motorista}</span>
                          <span className="block text-muted-foreground">
                            {linha.alocacao.obra} · {linha.alocacao.placa}
                          </span>
                        </td>
                        {diasDoMes.map((d) => {
                          const origem = porDia.get(d);
                          return (
                            <td key={d} className="p-1 text-center">
                              <span
                                title={
                                  origem === "APP"
                                    ? `${diaMes(d)} — marcado pelo motorista`
                                    : origem === "PAINEL"
                                      ? `${diaMes(d)} — lançado no painel`
                                      : undefined
                                }
                                className={`inline-block h-4 w-4 rounded-sm ${
                                  origem === "APP"
                                    ? "bg-emerald-500"
                                    : origem === "PAINEL"
                                      ? "bg-sky-500"
                                      : "bg-muted"
                                }`}
                              />
                            </td>
                          );
                        })}
                        <td className="p-2 text-right font-semibold">{linha.total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {criando && (
        <DialogNovaAlocacao
          onFechar={() => setCriando(false)}
          onCriada={() => {
            setCriando(false);
            void alocacoes.refetch();
          }}
        />
      )}
    </div>
  );
}

function LinhaAlocacao({ a }: { a: Alocacao }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [encerrando, setEncerrando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const encerrar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/alocacoes/${a.id}/encerrar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo }),
      }),
    onSuccess: () => {
      toast.success("Alocação encerrada.", {
        description: "Os dias já registrados continuam valendo.",
      });
      setEncerrando(false);
      void qc.invalidateQueries({ queryKey: [PATH, "alocacoes"] });
    },
    onError: (e: Error) => toast.error("Não consegui encerrar", { description: e.message }),
  });

  return (
    <div className="rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {a.motorista.nome} <span className="text-muted-foreground">em</span> {a.cliente.nome}
          </p>
          <p className="text-sm text-muted-foreground">
            {a.veiculo.placa} · desde {diaMes(a.inicio)}
            {a.valorDiaria ? ` · diária R$ ${a.valorDiaria}` : ""}
          </p>
        </div>
        {temPermissao("alocacoes.encerrar") && !encerrando && (
          <Button variant="outline" size="sm" onClick={() => setEncerrando(true)}>
            Encerrar
          </Button>
        )}
      </div>

      {/* Confirmação inline, não modal: o motivo é obrigatório e um diálogo
          aqui só empilharia janela sobre janela. */}
      {encerrando && (
        <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm">
            Para de contar diária nesta obra. Os dias já registrados continuam valendo, e o
            motorista volta a ver a home normal no app.
          </p>
          <Input
            className="mt-2"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por que está encerrando?"
          />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEncerrando(false)}>
              Voltar
            </Button>
            <Button
              size="sm"
              disabled={motivo.trim().length < 3 || encerrar.isPending}
              onClick={() => encerrar.mutate()}
            >
              Encerrar alocação
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Alocar é o cadastro que faz a tela do motorista não perguntar nada.
 *
 * Toda pergunta que NÃO for respondida aqui vira uma pergunta no app dele — e
 * é exatamente isso que o público do mensal não atravessa.
 */
function DialogNovaAlocacao({
  onFechar,
  onCriada,
}: {
  onFechar: () => void;
  onCriada: () => void;
}) {
  const token = useAuthToken();
  const [clienteId, setClienteId] = useState<string>();
  const [motoristaId, setMotoristaId] = useState<string>();
  const [veiculoId, setVeiculoId] = useState<string>();
  const [inicio, setInicio] = useState(new Date().toISOString().slice(0, 10));
  const [valor, setValor] = useState("");

  const criar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/alocacoes`, {
        token,
        method: "POST",
        body: JSON.stringify({
          clienteId,
          motoristaId,
          veiculoId,
          inicio,
          valorDiariaCentavos: valor
            ? Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100)
            : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Alocado na obra.", {
        description: "O motorista já vê o botão de marcar presença no app.",
      });
      onCriada();
    },
    onError: (e: Error) => toast.error("Não consegui alocar", { description: e.message }),
  });

  const podeSalvar = !!clienteId && !!motoristaId && !!veiculoId && !!inicio;

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alocar em obra</DialogTitle>
          <DialogDescription>
            O motorista passa a marcar presença num toque. Ele fica em uma obra por vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Obra</Label>
            <ClienteCombobox value={clienteId} onChange={setClienteId} placeholder="Escolha a obra…" />
          </div>
          <div>
            <Label>Motorista</Label>
            <MotoristaCombobox
              value={motoristaId}
              onChange={setMotoristaId}
              placeholder="Escolha o motorista…"
            />
          </div>
          <div>
            <Label>Caminhão</Label>
            <VeiculoCombobox value={veiculoId} onChange={setVeiculoId} placeholder="Escolha a placa…" />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-44">
              <Label>Começa em</Label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="w-40">
              <Label>Diária do motorista</Label>
              <Input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="opcional"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sem valor aqui, vale a régua da modalidade dele.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={!podeSalvar || criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending ? "Alocando…" : "Alocar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
