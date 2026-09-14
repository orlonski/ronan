"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Send, Trash2, Truck } from "lucide-react";
import { STATUS_PLANEJADA_LABEL, type StatusViagemPlanejadaTipo } from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { useConfirm } from "@/components/confirm-dialog";

type Planejada = {
  id: string;
  dataPrevista: string;
  janelaInicio: string | null;
  janelaFim: string | null;
  sequencia: number;
  status: StatusViagemPlanejadaTipo;
  observacao: string | null;
  recusaMotivo: string | null;
  publicadoEm: string | null;
  motorista: { id: string; nome: string; telefone: string | null } | null;
  veiculo: { id: string; placa: string; capacidadeToneladas: string | null } | null;
  viagem: { id: string; ticket: string | null; toneladas: string | null } | null;
  pedido: {
    id: string;
    numero: number;
    empresa: { nome: string };
    cliente: { nome: string } | null;
    material: { nome: string } | null;
    localCarga: { nome: string } | null;
    localDescarga: { nome: string } | null;
  } | null;
};

type MotoristaLinha = {
  id: string;
  nome: string;
  programadas: number;
  livre: boolean;
  veiculoDefault: { id: string; placa: string; capacidadeToneladas: string | null } | null;
};

type Quadro = { data: string; planejadas: Planejada[]; motoristas: MotoristaLinha[] };

type PedidoAberto = {
  id: string;
  numero: number;
  empresa: { nome: string };
  material: { nome: string } | null;
  localDescarga: { nome: string } | null;
  saldo: { restante: string; situacao: string } | null;
};

const CORES: Record<StatusViagemPlanejadaTipo, string> = {
  PLANEJADA: "bg-slate-100 text-slate-700",
  PUBLICADA: "bg-blue-100 text-blue-700",
  ACEITA: "bg-emerald-100 text-emerald-700",
  RECUSADA: "bg-red-100 text-red-700",
  EM_EXECUCAO: "bg-amber-100 text-amber-800",
  CUMPRIDA: "bg-emerald-100 text-emerald-700",
  FURADA: "bg-red-100 text-red-700",
  CANCELADA: "bg-slate-100 text-slate-500",
};

function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diaExtenso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

export default function ProgramacaoPage() {
  return (
    <RequerTela chave="programacao.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [dia, setDia] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  const quadro = useQuery({
    queryKey: ["programacao", dia],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Quadro>(`/admin/programacao?data=${dia}`, { token: token! }),
  });

  const pedidos = useQuery({
    queryKey: ["pedidos-abertos"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<{ data: PedidoAberto[] }>("/admin/pedidos?abertos=true&pageSize=50", {
        token: token!,
      }),
  });

  const recarregar = () => queryClient.invalidateQueries({ queryKey: ["programacao", dia] });

  async function publicar() {
    if (!token) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetchApi<{ publicadas: number; motoristas: number }>(
        "/admin/programacao/publicar",
        { token, method: "POST", body: JSON.stringify({ data: dia }) },
      );
      setErro(
        `${r.publicadas} viagem(ns) enviadas para ${r.motoristas} motorista(s). Eles já veem no app.`,
      );
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const naoPublicadas = (quadro.data?.planejadas ?? []).filter(
    (p) => p.status === "PLANEJADA" && p.motorista,
  ).length;

  // Agrupa por motorista: é como o supervisor pensa o dia ("o que o Zé faz hoje").
  const porMotorista = React.useMemo(() => {
    const mapa = new Map<string, Planejada[]>();
    for (const p of quadro.data?.planejadas ?? []) {
      const chave = p.motorista?.id ?? "__sem_dono__";
      mapa.set(chave, [...(mapa.get(chave) ?? []), p]);
    }
    return mapa;
  }, [quadro.data]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Programação do dia</h1>
          <p className="text-sm text-muted-foreground">
            Monte o dia aqui e publique — o motorista recebe no app e responde se dá ou não.
          </p>
        </div>
        <Permitido chave="programacao.publicar">
          <Button onClick={publicar} disabled={ocupado || naoPublicadas === 0}>
            <Send className="h-4 w-4" />
            {naoPublicadas > 0 ? `Publicar ${naoPublicadas} viagem(ns)` : "Tudo publicado"}
          </Button>
        </Permitido>
      </header>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDia(somarDias(dia, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            id="programacao-dia"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="icon" onClick={() => setDia(somarDias(dia, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm capitalize text-muted-foreground">{diaExtenso(dia)}</span>
      </Card>

      {erro && <Card className="border-l-4 border-l-blue-500 p-3 text-sm">{erro}</Card>}
      {quadro.isLoading && <LoadingCard />}

      {quadro.data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {quadro.data.motoristas.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Nenhum motorista aprovado e ativo pra programar.
              </Card>
            )}

            {quadro.data.motoristas.map((m) => (
              <LinhaMotorista
                key={m.id}
                motorista={m}
                planejadas={porMotorista.get(m.id) ?? []}
                dia={dia}
                pedidos={pedidos.data?.data ?? []}
                onMudou={recarregar}
              />
            ))}

            {(porMotorista.get("__sem_dono__")?.length ?? 0) > 0 && (
              <Card className="space-y-2 p-4">
                <p className="text-sm font-semibold text-amber-700">Sem motorista definido</p>
                {porMotorista.get("__sem_dono__")!.map((p) => (
                  <CardPlanejada key={p.id} p={p} onMudou={recarregar} />
                ))}
              </Card>
            )}
          </div>

          <aside className="space-y-3">
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Pedidos em aberto</p>
              {(pedidos.data?.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum pedido aberto. Programar sem pedido também funciona — o pedido serve
                  pra acompanhar o saldo combinado.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(pedidos.data?.data ?? []).slice(0, 12).map((p) => (
                    <li key={p.id} className="rounded-md border p-2 text-xs">
                      <p className="font-medium">
                        #{p.numero} {p.empresa.nome}
                      </p>
                      <p className="text-muted-foreground">
                        {[p.material?.nome, p.localDescarga?.nome].filter(Boolean).join(" · ")}
                      </p>
                      {p.saldo && (
                        <p className="mt-0.5 tabular-nums text-muted-foreground">
                          faltam {p.saldo.restante}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

function LinhaMotorista({
  motorista,
  planejadas,
  dia,
  pedidos,
  onMudou,
}: {
  motorista: MotoristaLinha;
  planejadas: Planejada[];
  dia: string;
  pedidos: PedidoAberto[];
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const [abrindo, setAbrindo] = React.useState(false);
  const [pedidoId, setPedidoId] = React.useState("");
  const [repetir, setRepetir] = React.useState("1");
  const [salvando, setSalvando] = React.useState(false);

  async function programar() {
    if (!token) return;
    setSalvando(true);
    try {
      await fetchApi("/admin/programacao", {
        token,
        method: "POST",
        body: JSON.stringify({
          motoristaId: motorista.id,
          veiculoId: motorista.veiculoDefault?.id ?? null,
          pedidoId: pedidoId || null,
          dataPrevista: dia,
          repetir: Number(repetir) || 1,
        }),
      });
      setAbrindo(false);
      setPedidoId("");
      setRepetir("1");
      onMudou();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{motorista.nome}</span>
          {motorista.veiculoDefault && (
            <Badge className="border-transparent bg-slate-100 text-slate-700">
              <Truck className="mr-1 h-3 w-3" />
              {motorista.veiculoDefault.placa}
              {motorista.veiculoDefault.capacidadeToneladas && (
                <span className="ml-1 tabular-nums">
                  {Number(motorista.veiculoDefault.capacidadeToneladas)}t
                </span>
              )}
            </Badge>
          )}
          {planejadas.length === 0 && (
            <span className="text-xs text-muted-foreground">sem nada programado</span>
          )}
        </div>
        <Permitido chave="programacao.editar">
          <Button variant="outline" size="sm" onClick={() => setAbrindo((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Programar
          </Button>
        </Permitido>
      </div>

      {abrindo && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label htmlFor={`ped-${motorista.id}`}>Pedido</Label>
            <Select
              id={`ped-${motorista.id}`}
              value={pedidoId}
              onChange={(e) => setPedidoId(e.target.value)}
            >
              <option value="">Sem pedido (viagem avulsa)</option>
              {pedidos.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.numero} {p.empresa.nome}
                  {p.material ? ` · ${p.material.nome}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-24 space-y-1">
            <Label htmlFor={`rep-${motorista.id}`}>Quantas</Label>
            <Input
              id={`rep-${motorista.id}`}
              inputMode="numeric"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
            />
          </div>
          <Button onClick={programar} disabled={salvando} size="sm">
            Adicionar
          </Button>
        </div>
      )}

      {planejadas.length > 0 && (
        <div className="space-y-1.5">
          {planejadas.map((p) => (
            <CardPlanejada key={p.id} p={p} onMudou={onMudou} />
          ))}
        </div>
      )}
    </Card>
  );
}

function CardPlanejada({ p, onMudou }: { p: Planejada; onMudou: () => void }) {
  const token = useAuthToken();
  const { confirmar, ConfirmDialog } = useConfirm();

  async function remover() {
    if (!token) return;
    const ok = await confirmar({
      variant: "destructive",
      title: p.publicadoEm ? "Cancelar essa viagem programada?" : "Tirar essa viagem do quadro?",
      description: p.publicadoEm
        ? "Ela já foi publicada, então o motorista já viu no app. Ele deixa de vê-la."
        : "Ainda não foi publicada, então ninguém foi avisado.",
      confirmLabel: p.publicadoEm ? "Cancelar viagem" : "Tirar do quadro",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    await fetchApi(`/admin/programacao/${p.id}`, { token, method: "DELETE" });
    onMudou();
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
      <ConfirmDialog />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {p.pedido
              ? `#${p.pedido.numero} ${p.pedido.empresa.nome}`
              : "Viagem avulsa"}
          </span>
          <Badge className={`border-transparent ${CORES[p.status]}`}>
            {STATUS_PLANEJADA_LABEL[p.status]}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {[
            p.pedido?.material?.nome,
            p.pedido?.localCarga?.nome && `de ${p.pedido.localCarga.nome}`,
            p.pedido?.localDescarga?.nome && `para ${p.pedido.localDescarga.nome}`,
            p.janelaInicio && `${p.janelaInicio}${p.janelaFim ? `–${p.janelaFim}` : ""}`,
          ]
            .filter(Boolean)
            .join(" · ") || "sem detalhes"}
        </p>
        {/* Recusa é a informação mais acionável do quadro: caminhão parado com
            motivo. Fica em destaque, não escondida. */}
        {p.status === "RECUSADA" && p.recusaMotivo && (
          <p className="mt-1 text-xs font-medium text-red-700">
            Recusou: {p.recusaMotivo}
          </p>
        )}
        {p.viagem && (
          <p className="mt-0.5 text-xs text-emerald-700">
            Virou viagem{p.viagem.ticket ? ` · ticket ${p.viagem.ticket}` : ""}
            {p.viagem.toneladas ? ` · ${Number(p.viagem.toneladas)}t` : ""}
          </p>
        )}
      </div>
      {/* Já cumprida não sai do quadro: é histórico do dia. */}
      {!p.viagem && (
        <Permitido chave="programacao.editar">
          <Button variant="ghost" size="icon" onClick={remover} title="Tirar do quadro">
            <Trash2 className="h-4 w-4" />
          </Button>
        </Permitido>
      )}
    </div>
  );
}
