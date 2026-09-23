"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { AbasDaTela } from "@/components/abas-da-tela";

type Alerta = {
  id: string;
  tipo:
    | "ATRASO"
    | "PARADA_LONGA"
    | "SEM_SINAL"
    | "NAO_INICIOU"
    | "OCORRENCIA_ABERTA"
    | "VIAGEM_ESQUECIDA";
  severidade: "ALTA" | "MEDIA" | "BAIXA";
  titulo: string;
  detalhe: string | null;
  detectadoEm: string;
  viagemId: string | null;
  motorista: { id: string; nome: string; telefone: string | null } | null;
  viagem: {
    id: string;
    localCarga: { nome: string } | null;
    localDescarga: { nome: string } | null;
    cliente: { nome: string } | null;
  } | null;
};

type Ocorrencia = {
  id: string;
  tipo: string;
  severidade: string | null;
  viagemId: string;
  motorista: { id: string; nome: string } | null;
  cliente: string | null;
  local: string | null;
  iniciouEm: string | null;
  observacao: string | null;
  geraCobranca: boolean;
  estadia: { horas: number; horasCobradas: number; valor: string } | null;
};

type TipoOcorrencia = {
  id: string;
  nome: string;
  severidade: string | null;
  temDuracao: boolean;
};

type Payload = {
  alertas: Alerta[];
  ocorrencias: Ocorrencia[];
  tiposOcorrencia: TipoOcorrencia[];
  viagensEmCurso: { id: string; rotulo: string }[];
};

const TIPO_LABEL: Record<Alerta["tipo"], string> = {
  ATRASO: "Atraso",
  // "Parado" descreve o motorista; "sem novidade" descreve o que o sistema de
  // fato sabe — que é a verdade, e não acusa ninguém.
  PARADA_LONGA: "Sem novidade",
  SEM_SINAL: "Sem sinal",
  NAO_INICIOU: "Não iniciou",
  OCORRENCIA_ABERTA: "Ocorrência",
  VIAGEM_ESQUECIDA: "Ficou aberta",
};

const SEVERIDADE: Record<Alerta["severidade"], string> = {
  ALTA: "border-l-red-500",
  MEDIA: "border-l-amber-500",
  BAIXA: "border-l-slate-300",
};

function brl(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : v;
}

function desde(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, "0")}`;
}

export default function TorrePage() {
  return (
    <RequerTela chave="programacao.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["torre"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Payload>("/admin/torre", { token: token! }),
    // A torre fica aberta num monitor o dia inteiro: 60s é o intervalo em que a
    // informação continua valendo sem virar polling agressivo.
    refetchInterval: 60_000,
  });

  // Estas três não passam pelo MutationCache (são fetchApi cru), então tratam o
  // erro aqui: sem isso, "Resolver" que falha só não faz nada e o operador
  // clica de novo achando que não acertou o botão.
  async function resolver(id: string) {
    if (!token) return;
    try {
      await fetchApi(`/admin/torre/alertas/${id}/resolver`, { token, method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["torre"] });
      toast.success("Alerta resolvido.");
    } catch (e) {
      toast.error("Não consegui resolver o alerta", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function encerrar(id: string) {
    if (!token) return;
    try {
      await fetchApi(`/admin/torre/ocorrencias/${id}/encerrar`, { token, method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["torre"] });
      toast.success("Ocorrência encerrada.");
    } catch (e) {
      toast.error("Não consegui encerrar a ocorrência", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  const [abrindo, setAbrindo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [viagemId, setViagemId] = React.useState("");
  const [tipoEventoId, setTipoEventoId] = React.useState("");
  const [observacao, setObservacao] = React.useState("");

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !viagemId || !tipoEventoId) return;
    setSalvando(true);
    try {
      await fetchApi("/admin/torre/ocorrencias", {
        token,
        method: "POST",
        body: JSON.stringify({ viagemId, tipoEventoId, observacao: observacao || null }),
      });
      setAbrindo(false);
      setViagemId("");
      setTipoEventoId("");
      setObservacao("");
      await queryClient.invalidateQueries({ queryKey: ["torre"] });
      toast.success("Ocorrência registrada.");
    } catch (e) {
      toast.error("Não consegui registrar a ocorrência", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  }

  const alertas = data?.alertas ?? [];
  const ocorrencias = data?.ocorrencias ?? [];
  const tipos = data?.tiposOcorrencia ?? [];
  const emCurso = data?.viagensEmCurso ?? [];
  // "Tudo no esperado" é uma AFIRMAÇÃO sobre a operação. Só pode sair quando a
  // torre realmente falou com a API: se a busca falhou, o que a tela sabe é
  // nada — e dizer "nenhuma viagem atrasada" aí é mentir pro supervisor.
  const limpo = !isError && alertas.length === 0 && ocorrencias.length === 0;

  return (
    <div className="space-y-5">
      <AbasDaTela grupo="torre" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Torre de controle</h1>
          <p className="text-sm text-muted-foreground">
            O que está fora do esperado agora. A régua é a própria operação: o normal de
            cada trajeto sai das viagens que a frota já fez nele.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tela que se atualiza sozinha precisa dizer DE QUANDO é o que está
              na tela — senão não dá pra distinguir "está tudo calmo" de
              "parou de atualizar". */}
          {dataUpdatedAt > 0 && (
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden />
              Atualizado às{" "}
              {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {/* Quem atende "quebrei na BR-376" precisa registrar sem sair daqui. */}
          <Permitido chave="programacao.editar">
            <Button onClick={() => setAbrindo(true)} disabled={emCurso.length === 0}>
              <Plus className="h-4 w-4" /> Registrar ocorrência
            </Button>
          </Permitido>
        </div>
      </header>

      {isLoading && <LoadingCard />}

      {/* A torre é lida de relance, de longe, num monitor. Se os dados ficaram
          velhos porque a busca falhou, isso precisa aparecer ANTES do conteúdo —
          senão o supervisor confia numa foto de dez minutos atrás. */}
      {isError && !isLoading && (
        <ErroCard
          erro={error}
          onRetry={() => void refetch()}
          className={data ? "border-destructive/40" : undefined}
        />
      )}
      {isError && data && (
        <p className="text-sm text-destructive">
          O que está abaixo é a última leitura que deu certo
          {dataUpdatedAt ? `, de ${new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}.
          Pode não refletir a operação agora.
        </p>
      )}

      {/* Sem exceção nenhuma, dizer isso é a informação — e não uma tela vazia,
          que o supervisor lê como "não carregou". */}
      {!isLoading && limpo && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <ShieldCheck className="h-8 w-8 text-emerald-600" />
          <p className="font-medium">Tudo no esperado</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Nenhuma viagem atrasada, parada sem explicação ou ocorrência aberta. A tela se
            atualiza sozinha a cada minuto.
          </p>
        </Card>
      )}

      {ocorrencias.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Ocorrências abertas ({ocorrencias.length})
          </h2>
          {ocorrencias.map((o) => (
            <Card key={o.id} className="border-l-4 border-l-amber-500 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {o.tipo}
                    {o.motorista && ` · ${o.motorista.nome}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[o.local, o.cliente].filter(Boolean).join(" · ")}
                    {o.iniciouEm && ` · aberta há ${desde(o.iniciouEm)}`}
                  </p>
                  {o.observacao && (
                    <p className="mt-1 text-sm text-muted-foreground">{o.observacao}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* A estadia CORRENDO é o que faz alguém ir cobrar em vez de
                      descobrir no fechamento. */}
                  {o.estadia && o.estadia.horasCobradas > 0 && (
                    <Badge className="border-transparent bg-amber-100 text-amber-800">
                      <Timer className="mr-1 h-3 w-3" />
                      {o.estadia.horasCobradas}h · {brl(o.estadia.valor)}
                    </Badge>
                  )}
                  {/* Sem valor/hora combinado o sistema não inventa preço — mas
                      também não cala: as horas estão sendo contadas, e dizer
                      isso é o que faz alguém ir preencher o contrato. */}
                  {o.geraCobranca && !o.estadia && (
                    <Badge className="border-transparent bg-slate-100 text-slate-600">
                      <Timer className="mr-1 h-3 w-3" />
                      Sem valor/hora
                    </Badge>
                  )}
                  <Permitido chave="programacao.editar">
                    <Button size="sm" variant="success" onClick={() => void encerrar(o.id)}>
                      <Check className="h-3.5 w-3.5" /> Encerrar
                    </Button>
                  </Permitido>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      {alertas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Precisa de atenção ({alertas.length})
          </h2>
          {alertas.map((a) => (
            <Card key={a.id} className={`border-l-4 p-4 ${SEVERIDADE[a.severidade]}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CircleAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{a.titulo}</span>
                    <Badge className="border-transparent bg-slate-100 text-slate-700">
                      {TIPO_LABEL[a.tipo]}
                    </Badge>
                  </div>
                  {a.detalhe && (
                    <p className="mt-1 text-sm text-muted-foreground">{a.detalhe}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[a.viagem?.cliente?.nome, a.viagem?.localDescarga?.nome]
                      .filter(Boolean)
                      .join(" · ")}
                    {` · detectado há ${desde(a.detectadoEm)}`}
                  </p>
                </div>

                {/* As três ações que o supervisor precisa, no card — não numa
                    tela de cadastro em outro lugar. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.motorista?.telefone && (
                    <a href={`tel:${a.motorista.telefone}`}>
                      <Button size="sm" variant="outline" title="Ligar">
                        <Phone className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                  {a.motorista?.telefone && (
                    <a
                      href={`https://wa.me/55${a.motorista.telefone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" variant="outline" title="WhatsApp">
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                  {a.viagemId &&
                    // Viagem esquecida se resolve FECHANDO, e o botão de fechar
                    // mora na tela Ao vivo. Mandar pra /viagens/:id era mandar
                    // pra uma tela onde a única ação possível é apagar.
                    (a.tipo === "VIAGEM_ESQUECIDA" ? (
                      <Link href="/viagens-andamento">
                        <Button size="sm" variant="outline">
                          Fechar no Ao vivo
                        </Button>
                      </Link>
                    ) : (
                      <Link href={`/viagens/${a.viagemId}`}>
                        <Button size="sm" variant="outline">
                          Ver viagem
                        </Button>
                      </Link>
                    ))}
                  <Permitido chave="programacao.editar">
                    <Button size="sm" variant="ghost" onClick={() => void resolver(a.id)}>
                      <Check className="h-3.5 w-3.5" /> Resolvido
                    </Button>
                  </Permitido>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      <Dialog open={abrindo} onOpenChange={setAbrindo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar ocorrência</DialogTitle>
          </DialogHeader>
          <form onSubmit={registrar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="torre-viagem">Viagem</Label>
              <Select
                id="torre-viagem"
                value={viagemId}
                onChange={(e) => setViagemId(e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {emCurso.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.rotulo || v.id}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="torre-tipo">O que aconteceu</Label>
              <Select
                id="torre-tipo"
                value={tipoEventoId}
                onChange={(e) => setTipoEventoId(e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                    {t.temDuracao ? " (conta o tempo)" : ""}
                  </option>
                ))}
              </Select>
              {/* Dizer que o relógio começa AGORA evita o registro tardio que
                  zera a estadia sem ninguém perceber. */}
              {tipos.find((t) => t.id === tipoEventoId)?.temDuracao && (
                <p className="text-xs text-muted-foreground">
                  O tempo começa a contar agora e para quando você encerrar aqui na torre.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="torre-obs">Observação</Label>
              <Textarea
                id="torre-obs"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="O que o motorista relatou"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAbrindo(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="success" disabled={salvando}>
                {salvando ? "Registrando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
