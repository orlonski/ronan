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
import { hojeSP } from "@/lib/datetime-br";
import { PedidosDasObras } from "./_components/pedidos-das-obras";

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
  /** A obra disse "pode vir" pelo portal do encarregado. */
  aprovadaObraEm?: string | null;
  aprovadaObraPor?: { nome: string } | null;
  /** Veio de um pedido de caminhão feito pela obra no portal. */
  solicitacaoObraId?: string | null;
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

type AlertaDocumento = { texto: string; situacao: "VENCIDO" | "VENCE_LOGO"; dias: number };

type Quadro = {
  data: string;
  planejadas: Planejada[];
  motoristas: MotoristaLinha[];
  /** Documento vencido ou vencendo em até 15 dias, por motorista e por caminhão. */
  documentos?: { motoristas: Record<string, AlertaDocumento[]>; veiculos: Record<string, AlertaDocumento[]> };
};

type PedidoAberto = {
  id: string;
  numero: number;
  empresa: { nome: string };
  material: { nome: string } | null;
  localDescarga: { nome: string } | null;
  /** `restante` null = saldo indisponível (pedido em m³ sem densidade). */
  saldo: { restante: string | null; situacao: string } | null;
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
  const [dia, setDia] = React.useState(hojeSP);
  // `?data=AAAA-MM-DD` abre o dia direto — é por onde chega o aviso de pedido
  // da obra no sininho. Lido depois de montar (o HTML do servidor não tem a URL).
  React.useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("data");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDia(d);
  }, []);
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
          <Button variant="outline" size="icon" aria-label="Dia anterior" onClick={() => setDia(somarDias(dia, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            id="programacao-dia"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="icon" aria-label="Próximo dia" onClick={() => setDia(somarDias(dia, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm capitalize text-muted-foreground">{diaExtenso(dia)}</span>
      </Card>

      <Permitido chave="programacao.editar">
        <RepetirOutroDia dia={dia} onCopiou={recarregar} />
      </Permitido>

      <PedidosDasObras
        motoristas={quadro.data?.motoristas ?? []}
        onProgramou={(d) => {
          setDia(d);
          void queryClient.invalidateQueries({ queryKey: ["programacao", d] });
        }}
      />

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
                alertas={[
                  ...(quadro.data?.documentos?.motoristas[m.id] ?? []),
                  ...(m.veiculoDefault ? (quadro.data?.documentos?.veiculos[m.veiculoDefault.id] ?? []) : []),
                ]}
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
                      {p.saldo &&
                        (p.saldo.restante != null ? (
                          <p className="mt-0.5 tabular-nums text-muted-foreground">
                            faltam {p.saldo.restante}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-amber-700">
                            saldo indisponível: falta a densidade do material
                          </p>
                        ))}
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
  alertas = [],
}: {
  motorista: MotoristaLinha;
  planejadas: Planejada[];
  dia: string;
  pedidos: PedidoAberto[];
  onMudou: () => void;
  alertas?: AlertaDocumento[];
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
        <div className="flex flex-wrap items-center gap-2">
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
          {/* Só aviso: quem decide se o caminhão sai é o escritório. */}
          {alertas.map((a) => (
            <Badge
              key={a.texto}
              className={
                a.situacao === "VENCIDO"
                  ? "border-red-200 bg-red-100 text-red-800"
                  : "border-amber-300 bg-amber-100 text-amber-900"
              }
            >
              {a.texto}
            </Badge>
          ))}
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
        {p.aprovadaObraEm && (
          <p className="mt-0.5 text-xs font-medium text-emerald-700">
            ✓ Aprovado pela obra em{" "}
            {new Date(p.aprovadaObraEm).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {p.aprovadaObraPor ? ` · ${p.aprovadaObraPor.nome}` : ""}
          </p>
        )}
        {p.solicitacaoObraId && !p.aprovadaObraEm && (
          <p className="mt-0.5 text-xs text-muted-foreground">Pedido pela obra no portal</p>
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

/** Dia útil anterior: segunda copia a sexta; os outros dias, a véspera. */
function diaUtilAnterior(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return somarDias(iso, dow === 1 ? -3 : dow === 0 ? -2 : -1);
}

type ResultadoCopia = {
  gravado: boolean;
  copiadas: number;
  itens: {
    origemId: string;
    acao: "COPIA" | "JA_EXISTE" | "PEDIDO_ENCERRADO";
    pedido: { numero: number; cliente: string | null } | null;
    motorista: string | null;
    placa: string | null;
    janelaInicio: string | null;
  }[];
};

const ACAO_COPIA: Record<ResultadoCopia["itens"][number]["acao"], { texto: string; cor: string }> = {
  COPIA: { texto: "Entra", cor: "text-green-700" },
  JA_EXISTE: { texto: "Já está no dia", cor: "text-muted-foreground" },
  PEDIDO_ENCERRADO: { texto: "Pedido encerrado ou cumprido — fica de fora", cor: "text-amber-700" },
};

/**
 * "Repetir outro dia": o quadro de amanhã quase sempre é o de hoje. Sempre em
 * dois passos (conferir, copiar) e as cópias nascem sem publicar — o motorista
 * só fica sabendo quando alguém apertar Publicar.
 */
function RepetirOutroDia({ dia, onCopiou }: { dia: string; onCopiou: () => void }) {
  const token = useAuthToken();
  const [aberto, setAberto] = React.useState(false);
  const [de, setDe] = React.useState(() => diaUtilAnterior(dia));
  const [previa, setPrevia] = React.useState<ResultadoCopia | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDe(diaUtilAnterior(dia));
    setPrevia(null);
  }, [dia]);
  React.useEffect(() => setPrevia(null), [de]);

  async function enviar(simular: boolean) {
    if (!token) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetchApi<ResultadoCopia>("/admin/programacao/copiar", {
        token,
        method: "POST",
        body: JSON.stringify({ de, para: dia, simular }),
      });
      if (simular) setPrevia(r);
      else {
        setPrevia(null);
        setAberto(false);
        onCopiou();
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          Repetir a programação de outro dia
        </Button>
      </div>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="copiar-de">Copiar o dia</Label>
          <Input id="copiar-de" type="date" className="w-40" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <p className="pb-2 text-sm text-muted-foreground">
          para <span className="capitalize">{diaExtenso(dia)}</span>. As viagens entram sem publicar.
        </p>
      </div>
      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {previa && (
        previa.itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Não há nada programado nesse dia.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {previa.itens.map((i) => (
              <li key={i.origemId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                <span>
                  <span className="font-medium">{i.motorista ?? "Sem motorista"}</span>
                  {i.placa && <span className="text-muted-foreground"> · {i.placa}</span>}
                  {i.pedido && (
                    <span className="text-muted-foreground">
                      {" "}· pedido #{i.pedido.numero}
                      {i.pedido.cliente && ` (${i.pedido.cliente})`}
                    </span>
                  )}
                  {i.janelaInicio && <span className="text-muted-foreground"> · {i.janelaInicio}</span>}
                </span>
                <span className={ACAO_COPIA[i.acao].cor}>{ACAO_COPIA[i.acao].texto}</span>
              </li>
            ))}
          </ul>
        )
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={ocupado} onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        {previa && previa.copiadas > 0 ? (
          <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={ocupado} onClick={() => enviar(false)}>
            Copiar {previa.copiadas} viagem(ns)
          </Button>
        ) : (
          <Button size="sm" disabled={ocupado} onClick={() => enviar(true)}>
            {previa ? "Nada pra copiar — conferir de novo" : "Conferir"}
          </Button>
        )}
      </div>
    </Card>
  );
}
