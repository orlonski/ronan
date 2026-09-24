"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CircleDot,
  FileWarning,
  MessageSquareWarning,
  Plus,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import {
  PODE_RODAR_LABEL,
  STATUS_MANUTENCAO_LABEL,
  STATUS_MULTA,
  STATUS_MULTA_LABEL,
  TIPO_MANUTENCAO_LABEL,
  TIPOS_DOCUMENTO_VEICULO,
  TIPOS_MANUTENCAO,
  type StatusManutencaoTipo,
  type StatusMultaTipo,
  type TipoManutencaoTipo,
} from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LoadingCard } from "@/components/loading";
import { MotoristaCombobox, VeiculoCombobox } from "@/components/fk-comboboxes";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Veiculo = { id: string; placa: string };

type Alertas = {
  manutencoes: {
    planoId: string;
    descricao: string;
    situacao: "VENCIDO" | "PROXIMO";
    kmRestante: number | null;
    diasRestante: number | null;
    motivo: "KM" | "TEMPO" | null;
    veiculo: Veiculo;
  }[];
  documentos: {
    id: string;
    tipo: string;
    veiculo: Veiculo;
    validade: string | null;
    diasRestantes: number | null;
  }[];
  pneus: {
    id: string;
    numeroFogo: string;
    posicao: string | null;
    sulcoMm: number | null;
    veiculo: Veiculo | null;
    situacao: "CRITICO" | "ATENCAO";
  }[];
  multas: {
    id: string;
    infracao: string;
    veiculo: Veiculo | null;
    motorista: { id: string; nome: string } | null;
    valor: string;
    status: StatusMultaTipo;
    diasParaIndicar: number | null;
  }[];
  emOficina: { id: string; veiculo: Veiculo; descricao: string; desde: string | null }[];
  /** Avisos do motorista esperando decisão (API antiga não manda). */
  avisosMotorista?: {
    id: string;
    descricao: string;
    avisadoEm: string;
    fotos: number;
    podeRodar: "SIM" | "COM_CUIDADO" | "NAO" | null;
    veiculo: Veiculo | null;
    motorista: { id: string; nome: string };
  }[];
};

type Manutencao = {
  id: string;
  tipo: TipoManutencaoTipo;
  status: StatusManutencaoTipo;
  descricao: string;
  odometro: number | null;
  previstaEm: string | null;
  valorTotal: string | null;
  valorPecas?: string | null;
  valorMaoObra?: string | null;
  veiculo: Veiculo;
  fornecedor: { id: string; nome: string } | null;
};

function brl(v: string | number | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : String(v);
}

function dataBR(v: string | null): string {
  if (!v) return "—";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export default function FrotaPage() {
  return (
    <RequerTela chave="manutencao.ver">
      <Conteudo />
    </RequerTela>
  );
}

type Aba = "alertas" | "avisos" | "manutencoes" | "planos" | "pneus" | "multas" | "documentos";

function Conteudo() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  // O sininho do aviso do motorista chega com `?aba=avisos`.
  const abaDaUrl = useSearchParams().get("aba");
  const [aba, setAba] = React.useState<Aba>(abaDaUrl === "avisos" ? "avisos" : "alertas");
  // "Lançar feita" no alerta de preventiva abre Manutenções já com o caminhão
  // e o plano — é o plano marcado que zera a contagem.
  const [prefill, setPrefill] = React.useState<{ veiculo: Veiculo; planoId: string; descricao: string } | null>(null);
  // Cada aba fala com um recurso próprio da API (pneus, multas, documentos):
  // quem não tem a chave não vê a aba, em vez de abrir e tomar 403.
  const abas = (
    [
      ["alertas", null, "manutencao.ver"],
      ["avisos", "Avisos do motorista", "manutencao.ver"],
      ["manutencoes", "Manutenções", "manutencao.ver"],
      ["planos", "Planos de manutenção", "manutencao.ver"],
      ["pneus", "Pneus", "pneus.ver"],
      ["multas", "Multas", "multas.ver"],
      ["documentos", "Documentos", "documentos-veiculo.ver"],
    ] as const
  ).filter(([, , perm]) => temPermissao(perm));

  const alertas = useQuery({
    queryKey: ["frota-alertas"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Alertas>("/admin/manutencao/alertas", { token: token! }),
  });

  const total = alertas.data
    ? alertas.data.manutencoes.length +
      alertas.data.documentos.length +
      alertas.data.pneus.length +
      alertas.data.emOficina.length +
      (alertas.data.avisosMotorista?.length ?? 0)
    : 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Manutenção e vencimentos do caminhão</h1>
        <p className="text-sm text-muted-foreground">
          Manutenção, pneu, documento e multa — o que some do radar e vira caminhão parado.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b">
        {abas.map(([chave, rotulo]) => {
          const label = rotulo ?? (total > 0 ? `Precisa de você (${total})` : "Precisa de você");
          return (
          <button
            key={chave}
            type="button"
            onClick={() => setAba(chave as Aba)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              aba === chave
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
          );
        })}
      </div>

      {aba === "alertas" && (
        <>
          {alertas.isLoading && <LoadingCard />}
          {alertas.data && (
            <BlocoAlertas
              a={alertas.data}
              onVerAvisos={() => setAba("avisos")}
              onLancarPlano={(p) => {
                setPrefill(p);
                setAba("manutencoes");
              }}
            />
          )}
        </>
      )}
      {aba === "avisos" && <ListaAvisos />}
      {aba === "manutencoes" && (
        <ListaManutencoes prefill={prefill} onPrefillUsado={() => setPrefill(null)} />
      )}
      {aba === "planos" && <ListaPlanos />}
      {aba === "pneus" && <ListaPneus />}
      {aba === "multas" && <ListaMultas />}
      {aba === "documentos" && <ListaDocumentos />}
    </div>
  );
}

function BlocoAlertas({
  a,
  onVerAvisos,
  onLancarPlano,
}: {
  a: Alertas;
  onVerAvisos: () => void;
  onLancarPlano: (p: { veiculo: Veiculo; planoId: string; descricao: string }) => void;
}) {
  const avisos = a.avisosMotorista ?? [];
  const nada =
    avisos.length === 0 &&
    a.manutencoes.length === 0 &&
    a.documentos.length === 0 &&
    a.pneus.length === 0 &&
    a.multas.length === 0 &&
    a.emOficina.length === 0;

  if (nada) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-medium">Nada pendente na frota.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastre os planos de manutenção (ex.: troca de óleo a cada 20.000 km) e a validade
          dos documentos, nas abas acima, pra ser avisado antes de o caminhão parar.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {avisos.length > 0 && (
        <Card className="border-l-4 border-l-blue-500 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <MessageSquareWarning className="h-4 w-4" /> Motorista avisou ({avisos.length})
          </p>
          <ul className="space-y-1 text-sm">
            {avisos.slice(0, 5).map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2">
                <span className="min-w-0 truncate">
                  {v.podeRodar === "NAO" && (
                    <Badge className="mr-2 border-transparent bg-red-100 text-red-700">Parado</Badge>
                  )}
                  <span className="font-medium">{v.veiculo?.placa ?? "sem placa"}</span> ·{" "}
                  {v.descricao}
                </span>
                <span className="text-xs text-muted-foreground">{v.motorista.nome}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="mt-3" onClick={onVerAvisos}>
            Ver e decidir
          </Button>
        </Card>
      )}

      {a.emOficina.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Wrench className="h-4 w-4" /> Na oficina agora ({a.emOficina.length})
          </p>
          <ul className="space-y-1 text-sm">
            {a.emOficina.map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <span className="font-medium">{m.veiculo.placa}</span> · {m.descricao}
                </span>
                {m.desde && (
                  <span className="text-xs text-muted-foreground">
                    desde {new Date(m.desde).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.manutencoes.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Wrench className="h-4 w-4" /> Manutenção preventiva
          </p>
          <ul className="space-y-2 text-sm">
            {a.manutencoes.map((m) => (
              <li key={m.planoId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{m.veiculo.placa}</span> · {m.descricao}
                </span>
                <span className="flex items-center gap-2">
                <Badge
                  className={`border-transparent ${
                    m.situacao === "VENCIDO"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {m.situacao === "VENCIDO" ? "Vencida" : "Chegando"}
                  {m.motivo === "KM" && m.kmRestante != null
                    ? ` · ${Math.abs(m.kmRestante).toLocaleString("pt-BR")} km`
                    : m.diasRestante != null
                      ? ` · ${Math.abs(m.diasRestante)} dias`
                      : ""}
                </Badge>
                <Permitido chave="manutencao.criar">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onLancarPlano({ veiculo: m.veiculo, planoId: m.planoId, descricao: m.descricao })
                    }
                  >
                    Lançar feita
                  </Button>
                </Permitido>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.documentos.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <FileWarning className="h-4 w-4" /> Documento vencendo
          </p>
          <ul className="space-y-2 text-sm">
            {a.documentos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{d.veiculo.placa}</span> · {d.tipo}
                </span>
                <Badge
                  className={`border-transparent ${
                    (d.diasRestantes ?? 0) < 0
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {(d.diasRestantes ?? 0) < 0
                    ? `vencido há ${Math.abs(d.diasRestantes!)} dias`
                    : `vence em ${d.diasRestantes} dias`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.pneus.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CircleDot className="h-4 w-4" /> Pneu no limite
          </p>
          <ul className="space-y-2 text-sm">
            {a.pneus.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{p.veiculo?.placa ?? "estoque"}</span> · fogo{" "}
                  {p.numeroFogo}
                  {p.posicao && ` · ${p.posicao}`}
                </span>
                <Badge
                  className={`border-transparent ${
                    p.situacao === "CRITICO"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {p.sulcoMm}mm
                  {p.situacao === "CRITICO" && " · abaixo do legal"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {a.multas.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="h-4 w-4" /> Multas em aberto
          </p>
          <ul className="space-y-2 text-sm">
            {a.multas.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{m.veiculo?.placa ?? "—"}</span> · {m.infracao}
                  {m.motorista && (
                    <span className="text-muted-foreground"> · {m.motorista.nome}</span>
                  )}
                </span>
                {/* Perder o prazo de indicação faz a multa virar do PROPRIETÁRIO,
                    com pontos no CNPJ. É a informação mais acionável aqui. */}
                {m.diasParaIndicar != null && m.status === "RECEBIDA" && (
                  <Badge
                    className={`border-transparent ${
                      m.diasParaIndicar < 0
                        ? "bg-red-100 text-red-700"
                        : m.diasParaIndicar <= 7
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {m.diasParaIndicar < 0
                      ? "prazo de indicação perdido"
                      : `indicar condutor em ${m.diasParaIndicar} dias`}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Aviso = {
  id: string;
  descricao: string;
  avisadoEm: string;
  status: "ABERTO" | "VIROU_MANUTENCAO" | "DESCARTADO";
  fotos: number;
  podeRodar: "SIM" | "COM_CUIDADO" | "NAO" | null;
  lat: number | null;
  lng: number | null;
  motivoDescarte: string | null;
  decididoEm: string | null;
  manutencaoId: string | null;
  veiculo: Veiculo | null;
  motorista: { id: string; nome: string };
  decididoPor: { id: string; nome: string } | null;
};

/** Foto do aviso: vem da API com o token (o bucket não é público). */
function FotoAviso({ id, indice }: { id: string; indice: number }) {
  const token = useAuthToken();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const base = `${apiUrl}/admin/manutencao/problemas/${id}/fotos/${indice}`;
  const q = useQuery({
    queryKey: ["problema-foto", id, indice],
    enabled: Boolean(token),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${base}?mini=1`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    },
  });

  async function abrirGrande() {
    if (!token) return;
    const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  }

  if (!q.data) {
    return <div className="h-20 w-20 animate-pulse rounded-md border bg-muted" />;
  }
  return (
    <button
      type="button"
      onClick={() => void abrirGrande()}
      className="h-20 w-20 overflow-hidden rounded-md border"
      title="Ver a foto inteira"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={q.data} alt={`Foto ${indice + 1} do aviso`} className="h-full w-full object-cover" />
    </button>
  );
}

/**
 * AVISOS DO MOTORISTA: o que ele mandou pelo app ("Avisar problema no
 * caminhão"). O escritório decide: vira manutenção aberta, ou não vira — com o
 * motivo escrito, pra ninguém reabrir no escuro.
 */
function ListaAvisos() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = React.useState<Aviso["status"]>("ABERTO");

  const lista = useQuery({
    queryKey: ["problemas-veiculo", filtro],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Aviso[]>(`/admin/manutencao/problemas?status=${filtro}`, { token: token! }),
  });

  async function atualizar() {
    await queryClient.invalidateQueries({ queryKey: ["problemas-veiculo"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
    await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
  }

  const itens = lista.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        O que os motoristas mandaram pelo app, com foto. Cada aviso vira uma manutenção aberta
        ou fica registrado com o motivo de não virar.
      </p>
      <div className="max-w-xs">
        <Select
          aria-label="Quais avisos"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as Aviso["status"])}
        >
          <option value="ABERTO">Esperando decisão</option>
          <option value="VIROU_MANUTENCAO">Viraram manutenção</option>
          <option value="DESCARTADO">Não viraram manutenção</option>
        </Select>
      </div>

      {lista.isLoading && <LoadingCard />}
      {itens.length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {filtro === "ABERTO"
            ? "Nenhum aviso esperando. Quando um motorista avisar um problema pelo app, aparece aqui."
            : "Nada por aqui."}
        </Card>
      )}
      {itens.map((a) => (
        <CardAviso key={a.id} a={a} onMudou={() => void atualizar()} />
      ))}
    </div>
  );
}

function SeloPodeRodar({ v }: { v: "SIM" | "COM_CUIDADO" | "NAO" }) {
  const cls =
    v === "NAO"
      ? "bg-red-100 text-red-700"
      : v === "COM_CUIDADO"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return <Badge className={`border-transparent ${cls}`}>{PODE_RODAR_LABEL[v]}</Badge>;
}

function CardAviso({ a, onMudou }: { a: Aviso; onMudou: () => void }) {
  const token = useAuthToken();
  const [modo, setModo] = React.useState<"nada" | "abrir" | "descartar">("nada");
  const [veiculoId, setVeiculoId] = React.useState<string | undefined>(a.veiculo?.id);
  const [tipo, setTipo] = React.useState<TipoManutencaoTipo>("CORRETIVA");
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  async function abrir() {
    if (!token) return;
    if (!veiculoId) return setErro("Escolha o caminhão.");
    setErro(null);
    setEnviando(true);
    try {
      await fetchApi(`/admin/manutencao/problemas/${a.id}/abrir-manutencao`, {
        token,
        method: "POST",
        body: JSON.stringify({ veiculoId, tipo }),
      });
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function descartar() {
    if (!token) return;
    if (motivo.trim().length < 3) return setErro("Diga por que não vira manutenção.");
    setErro(null);
    setEnviando(true);
    try {
      await fetchApi(`/admin/manutencao/problemas/${a.id}/descartar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo }),
      });
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {a.veiculo?.placa ?? "Caminhão não informado"} · {a.motorista.nome}
          </p>
          <p className="text-xs text-muted-foreground">
            avisou em {new Date(a.avisadoEm).toLocaleString("pt-BR")}
          </p>
        </div>
        {a.status === "ABERTO" && a.podeRodar && <SeloPodeRodar v={a.podeRodar} />}
        {a.status === "VIROU_MANUTENCAO" && (
          <Badge className="border-transparent bg-emerald-100 text-emerald-700">Virou manutenção</Badge>
        )}
        {a.status === "DESCARTADO" && (
          <Badge className="border-transparent bg-slate-100 text-slate-700">Não virou manutenção</Badge>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm">{a.descricao}</p>
      {a.lat != null && a.lng != null && (
        <a
          href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
        >
          Ver no mapa onde o caminhão parou →
        </a>
      )}
      {a.fotos > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: a.fotos }, (_, i) => (
            <FotoAviso key={i} id={a.id} indice={i} />
          ))}
        </div>
      )}
      {a.status !== "ABERTO" && a.decididoPor && (
        <p className="text-xs text-muted-foreground">
          Decidido por {a.decididoPor.nome}
          {a.decididoEm && ` em ${new Date(a.decididoEm).toLocaleDateString("pt-BR")}`}
          {a.motivoDescarte && ` · motivo: ${a.motivoDescarte}`}
        </p>
      )}

      {a.status === "ABERTO" && modo === "nada" && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Permitido chave="manutencao.criar">
            <Button size="sm" variant="success" onClick={() => setModo("abrir")}>
              Abrir manutenção
            </Button>
          </Permitido>
          <Permitido chave="manutencao.editar">
            <Button size="sm" variant="outline" onClick={() => setModo("descartar")}>
              Não vira manutenção
            </Button>
          </Permitido>
        </div>
      )}

      {modo === "abrir" && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                triggerClassName="sm:w-full"
                value={veiculoId}
                initialOption={a.veiculo ? { value: a.veiculo.id, label: a.veiculo.placa } : undefined}
                onChange={setVeiculoId}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`aviso-tipo-${a.id}`}>Tipo</Label>
              <Select
                id={`aviso-tipo-${a.id}`}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoManutencaoTipo)}
              >
                {TIPOS_MANUTENCAO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_MANUTENCAO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setModo("nada")} disabled={enviando}>
              Voltar
            </Button>
            <Button size="sm" variant="success" onClick={() => void abrir()} disabled={enviando}>
              Abrir manutenção
            </Button>
          </div>
        </div>
      )}

      {modo === "descartar" && (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <Label htmlFor={`aviso-motivo-${a.id}`}>Por que não vira manutenção</Label>
            <Input
              id={`aviso-motivo-${a.id}`}
              placeholder="ex: Já resolvido na última revisão"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setModo("nada")} disabled={enviando}>
              Voltar
            </Button>
            <Button size="sm" variant="warning" onClick={() => void descartar()} disabled={enviando}>
              Registrar que não vira
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ListaManutencoes({
  prefill,
  onPrefillUsado,
}: {
  prefill: { veiculo: Veiculo; planoId: string; descricao: string } | null;
  onPrefillUsado: () => void;
}) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [criando, setCriando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [veiculoInicial, setVeiculoInicial] = React.useState<Veiculo | null>(null);
  const [form, setForm] = React.useState({
    veiculoId: undefined as string | undefined,
    tipo: "PREVENTIVA" as TipoManutencaoTipo,
    descricao: "",
    odometro: "",
    valorPecas: "",
    valorMaoObra: "",
    planoId: "",
    // Já foi feita (zera o plano e pode lançar a conta) ou ainda vai fazer.
    situacao: "FEITA" as "FEITA" | "VAI_FAZER",
    lancarConta: false,
  });

  // Veio do "Lançar feita" do alerta: abre o formulário já preenchido.
  React.useEffect(() => {
    if (!prefill) return;
    setVeiculoInicial(prefill.veiculo);
    setForm((f) => ({
      ...f,
      veiculoId: prefill.veiculo.id,
      tipo: "PREVENTIVA",
      descricao: prefill.descricao,
      planoId: prefill.planoId,
      situacao: "FEITA",
    }));
    setCriando(true);
    onPrefillUsado();
  }, [prefill, onPrefillUsado]);

  // Os planos do caminhão escolhido: marcar o plano é o que zera a contagem
  // dele. Sem isto o plano ficava "vencido" pra sempre depois do serviço feito.
  const planos = useQuery({
    queryKey: ["planos-manutencao"],
    enabled: Boolean(token) && criando,
    queryFn: () => fetchApi<Plano[]>("/admin/manutencao/planos", { token: token! }),
  });
  const planosDoVeiculo = (planos.data ?? []).filter((p) => p.veiculo.id === form.veiculoId);
  const planoEscolhido = planosDoVeiculo.find((p) => p.id === form.planoId);

  const lista = useQuery({
    queryKey: ["manutencoes"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<{ data: Manutencao[] }>("/admin/manutencao?pageSize=100", { token: token! }),
  });

  async function salvar() {
    if (!token) return;
    if (!form.veiculoId) return setErro("Escolha o caminhão.");
    if (form.descricao.trim().length < 3) return setErro("Diga o que foi feito.");
    if (planoEscolhido?.intervaloKm != null && !form.odometro.trim()) {
      return setErro("Informe o odômetro: é ele que reinicia a contagem por km do plano.");
    }
    setErro(null);
    try {
      await fetchApi("/admin/manutencao", {
        token,
        method: "POST",
        body: JSON.stringify({
          veiculoId: form.veiculoId,
          tipo: form.tipo,
          descricao: form.descricao,
          odometro: form.odometro ? Number(form.odometro.replace(/\D/g, "")) : null,
          valorPecas: form.valorPecas
            ? Number(form.valorPecas.replace(/\./g, "").replace(",", "."))
            : null,
          valorMaoObra: form.valorMaoObra
            ? Number(form.valorMaoObra.replace(/\./g, "").replace(",", "."))
            : null,
          planoId: planoEscolhido ? planoEscolhido.id : null,
          status: form.situacao === "FEITA" ? "CONCLUIDA" : "ABERTA",
          gerarContaPagar: form.situacao === "FEITA" && form.lancarConta,
        }),
      });
      setCriando(false);
      setForm({ ...form, descricao: "", odometro: "", valorPecas: "", valorMaoObra: "", planoId: "", lancarConta: false });
      await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
      await queryClient.invalidateQueries({ queryKey: ["planos-manutencao"] });
      await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function mudarStatus(id: string, status: StatusManutencaoTipo) {
    if (!token) return;
    await fetchApi(`/admin/manutencao/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
  }

  // "Concluir" abre um formulário curto: sem valor não há conta a lançar, e
  // o odômetro da saída é o que zera o plano por km.
  const [concluindo, setConcluindo] = React.useState<string | null>(null);
  const [fim, setFim] = React.useState({ odometro: "", valorPecas: "", valorMaoObra: "", lancarConta: true });
  const [erroFim, setErroFim] = React.useState<string | null>(null);
  function abrirConclusao(m: Manutencao) {
    setErroFim(null);
    setFim({
      odometro: m.odometro != null ? String(m.odometro) : "",
      valorPecas: m.valorPecas ? String(m.valorPecas).replace(".", ",") : "",
      valorMaoObra: m.valorMaoObra ? String(m.valorMaoObra).replace(".", ",") : "",
      lancarConta: true,
    });
    setConcluindo(m.id);
  }
  async function concluir(id: string) {
    if (!token) return;
    const pecas = fim.valorPecas ? Number(fim.valorPecas.replace(/\./g, "").replace(",", ".")) : null;
    const mao = fim.valorMaoObra ? Number(fim.valorMaoObra.replace(/\./g, "").replace(",", ".")) : null;
    if (fim.lancarConta && !(pecas || mao)) {
      return setErroFim("Informe o valor pra lançar em Contas a pagar, ou desmarque a opção.");
    }
    setErroFim(null);
    try {
      await fetchApi(`/admin/manutencao/${id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({
          status: "CONCLUIDA",
          odometro: fim.odometro ? Number(fim.odometro.replace(/\D/g, "")) : null,
          valorPecas: pecas,
          valorMaoObra: mao,
          gerarContaPagar: fim.lancarConta,
        }),
      });
      setConcluindo(null);
      await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
      await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
      await queryClient.invalidateQueries({ queryKey: ["planos-manutencao"] });
    } catch (e) {
      setErroFim((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <Permitido chave="manutencao.criar">
        <Button variant="outline" size="sm" onClick={() => setCriando((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Lançar manutenção
        </Button>
      </Permitido>

      {criando && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                triggerClassName="sm:w-full"
                value={form.veiculoId}
                initialOption={
                  veiculoInicial ? { value: veiculoInicial.id, label: veiculoInicial.placa } : undefined
                }
                onChange={(v) => setForm({ ...form, veiculoId: v, planoId: "" })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="man-tipo">Tipo</Label>
              <Select
                id="man-tipo"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoManutencaoTipo })}
              >
                {TIPOS_MANUTENCAO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_MANUTENCAO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {planosDoVeiculo.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="man-plano">É de algum plano de manutenção?</Label>
              <Select
                id="man-plano"
                value={form.planoId}
                onChange={(e) => {
                  const pl = planosDoVeiculo.find((p) => p.id === e.target.value);
                  setForm({
                    ...form,
                    planoId: e.target.value,
                    descricao: form.descricao || pl?.descricao || "",
                  });
                }}
              >
                <option value="">Não, é avulsa</option>
                {planosDoVeiculo.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.descricao}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Marcando o plano, a contagem dele recomeça a partir desta manutenção
                {planoEscolhido?.intervaloKm != null ? " (e do odômetro informado)" : ""}.
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="man-situacao">Situação</Label>
            <Select
              id="man-situacao"
              value={form.situacao}
              onChange={(e) => setForm({ ...form, situacao: e.target.value as "FEITA" | "VAI_FAZER" })}
            >
              <option value="FEITA">Já foi feita</option>
              <option value="VAI_FAZER">Ainda vai fazer (fica aberta)</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="man-desc">{form.situacao === "FEITA" ? "O que foi feito" : "O que vai ser feito"}</Label>
            <Input
              id="man-desc"
              placeholder="ex: Troca de óleo e filtros"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="man-odo">Odômetro</Label>
              <Input
                id="man-odo"
                inputMode="numeric"
                value={form.odometro}
                onChange={(e) => setForm({ ...form, odometro: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="man-pecas">Peças (R$)</Label>
              <Input
                id="man-pecas"
                inputMode="decimal"
                value={form.valorPecas}
                onChange={(e) => setForm({ ...form, valorPecas: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="man-mao">Mão de obra (R$)</Label>
              <Input
                id="man-mao"
                inputMode="decimal"
                value={form.valorMaoObra}
                onChange={(e) => setForm({ ...form, valorMaoObra: e.target.value })}
              />
            </div>
          </div>
          {form.situacao === "FEITA" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.lancarConta}
                onChange={(e) => setForm({ ...form, lancarConta: e.target.checked })}
              />
              Lançar o valor em Contas a pagar
            </label>
          )}
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void salvar()}>
              Salvar
            </Button>
          </div>
        </Card>
      )}

      {lista.isLoading && <LoadingCard />}
      {(lista.data?.data ?? []).length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhuma manutenção lançada.
        </Card>
      )}

      {(lista.data?.data ?? []).map((m) => (
        <Card key={m.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                {m.veiculo.placa} · {m.descricao}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {TIPO_MANUTENCAO_LABEL[m.tipo]}
                {m.odometro && ` · ${m.odometro.toLocaleString("pt-BR")} km`}
                {m.fornecedor && ` · ${m.fornecedor.nome}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium tabular-nums">{brl(m.valorTotal)}</span>
              <Badge
                className={`border-transparent ${
                  m.status === "EM_ANDAMENTO"
                    ? "bg-amber-100 text-amber-800"
                    : m.status === "CONCLUIDA"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {STATUS_MANUTENCAO_LABEL[m.status]}
              </Badge>
            </div>
          </div>
          {m.status !== "CONCLUIDA" && m.status !== "CANCELADA" && (
            <Permitido chave="manutencao.editar">
              <div className="mt-3 flex gap-2 border-t pt-3">
                {m.status === "ABERTA" && (
                  <Button size="sm" variant="outline" onClick={() => void mudarStatus(m.id, "EM_ANDAMENTO")}>
                    Entrou na oficina
                  </Button>
                )}
                <Button size="sm" variant="success" onClick={() => abrirConclusao(m)}>
                  Concluir
                </Button>
              </div>
              {concluindo === m.id && (
                <div className="mt-3 space-y-3 rounded-md border p-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor={`fim-odo-${m.id}`}>Odômetro na saída</Label>
                      <Input
                        id={`fim-odo-${m.id}`}
                        inputMode="numeric"
                        value={fim.odometro}
                        onChange={(e) => setFim({ ...fim, odometro: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`fim-pecas-${m.id}`}>Peças (R$)</Label>
                      <Input
                        id={`fim-pecas-${m.id}`}
                        inputMode="decimal"
                        value={fim.valorPecas}
                        onChange={(e) => setFim({ ...fim, valorPecas: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`fim-mao-${m.id}`}>Mão de obra (R$)</Label>
                      <Input
                        id={`fim-mao-${m.id}`}
                        inputMode="decimal"
                        value={fim.valorMaoObra}
                        onChange={(e) => setFim({ ...fim, valorMaoObra: e.target.value })}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fim.lancarConta}
                      onChange={(e) => setFim({ ...fim, lancarConta: e.target.checked })}
                    />
                    Lançar o valor em Contas a pagar
                  </label>
                  {erroFim && <p className="text-sm text-destructive">{erroFim}</p>}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setConcluindo(null)}>
                      Voltar
                    </Button>
                    <Button size="sm" variant="success" onClick={() => void concluir(m.id)}>
                      Concluir manutenção
                    </Button>
                  </div>
                </div>
              )}
            </Permitido>
          )}
        </Card>
      ))}
    </div>
  );
}

/** "20.000" → 20000; vazio → null. */
function inteiro(v: string): number | null {
  const d = v.replace(/\D/g, "");
  return d ? Number(d) : null;
}

/** "1.234,56" → 1234.56; vazio → null. */
function decimal(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type Plano = {
  id: string;
  descricao: string;
  intervaloKm: number | null;
  intervaloDias: number | null;
  ultimoOdometro: number | null;
  ultimaEm: string | null;
  veiculo: Veiculo;
};

/**
 * PLANOS DE MANUTENÇÃO: "troca de óleo a cada 20.000 km ou 6 meses". São eles
 * que acendem o "Manutenção preventiva" em Precisa de você — e até 23/09/2026
 * não tinham tela: a API gravava, o aviso pedia pra cadastrar, e não havia onde.
 */
function ListaPlanos() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  // null = fechado; "" = novo; id = editando.
  const [editando, setEditando] = React.useState<string | null>(null);
  const criando = editando !== null;
  const [erro, setErro] = React.useState<string | null>(null);
  const vazio = {
    veiculoId: undefined as string | undefined,
    descricao: "",
    intervaloKm: "",
    intervaloDias: "",
    ultimoOdometro: "",
    ultimaEm: "",
  };
  const [form, setForm] = React.useState(vazio);

  const lista = useQuery({
    queryKey: ["planos-manutencao"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Plano[]>("/admin/manutencao/planos", { token: token! }),
  });

  async function atualizar() {
    await queryClient.invalidateQueries({ queryKey: ["planos-manutencao"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
  }

  async function salvar() {
    if (!token) return;
    if (!form.veiculoId) return setErro("Escolha o caminhão.");
    if (form.descricao.trim().length < 3) return setErro("Diga qual é a manutenção.");
    const km = inteiro(form.intervaloKm);
    const dias = inteiro(form.intervaloDias);
    if (km == null && dias == null) return setErro("Diga a cada quantos km ou a cada quantos dias.");
    setErro(null);
    try {
      await fetchApi(editando ? `/admin/manutencao/planos/${editando}` : "/admin/manutencao/planos", {
        token,
        method: editando ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(editando ? {} : { veiculoId: form.veiculoId }),
          descricao: form.descricao,
          intervaloKm: km,
          intervaloDias: dias,
          ultimoOdometro: inteiro(form.ultimoOdometro),
          ultimaEm: form.ultimaEm || null,
        }),
      });
      setEditando(null);
      setForm({ ...vazio, veiculoId: form.veiculoId });
      await atualizar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function remover(p: Plano) {
    if (!token) return;
    const ok = await confirmar({
      title: `Excluir o plano "${p.descricao}" do ${p.veiculo.placa}?`,
      description: "O aviso de manutenção deste caminhão para de aparecer. As manutenções já lançadas continuam.",
      confirmLabel: "Excluir plano",
      variant: "destructive",
    });
    if (!ok) return;
    await fetchApi(`/admin/manutencao/planos/${p.id}`, { token, method: "DELETE" });
    await atualizar();
  }

  const itens = lista.data ?? [];

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <p className="text-sm text-muted-foreground">
        A manutenção que se repete — a cada tantos km ou a cada tantos dias. O sistema avisa em
        Precisa de você quando estiver chegando. O km atual vem do odômetro anotado nos
        abastecimentos.
      </p>
      <Permitido chave="manutencao.criar">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setErro(null);
            setForm(vazio);
            setEditando(editando === "" ? null : "");
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Novo plano
        </Button>
      </Permitido>

      {criando && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              {editando ? (
                <p className="flex h-9 items-center text-sm font-medium">
                  {itens.find((p) => p.id === editando)?.veiculo.placa}
                </p>
              ) : (
                <VeiculoCombobox
                  triggerClassName="sm:w-full"
                  value={form.veiculoId}
                  onChange={(v) => setForm({ ...form, veiculoId: v })}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="plano-desc">Manutenção</Label>
              <Input
                id="plano-desc"
                placeholder="ex: Troca de óleo e filtros"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="plano-km">A cada quantos km</Label>
              <Input
                id="plano-km"
                inputMode="numeric"
                placeholder="ex: 20000"
                value={form.intervaloKm}
                onChange={(e) => setForm({ ...form, intervaloKm: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="plano-dias">Ou a cada quantos dias</Label>
              <Input
                id="plano-dias"
                inputMode="numeric"
                placeholder="ex: 180"
                value={form.intervaloDias}
                onChange={(e) => setForm({ ...form, intervaloDias: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Pode preencher os dois: vale o que chegar primeiro. O aviso por km usa o odômetro
            anotado nos abastecimentos deste caminhão — sem odômetro anotado, só o aviso por dias
            funciona.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="plano-ultodo">Última vez feita — odômetro</Label>
              <Input
                id="plano-ultodo"
                inputMode="numeric"
                value={form.ultimoOdometro}
                onChange={(e) => setForm({ ...form, ultimoOdometro: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="plano-ultdata">Última vez feita — data</Label>
              <Input
                id="plano-ultdata"
                type="date"
                value={form.ultimaEm}
                onChange={(e) => setForm({ ...form, ultimaEm: e.target.value })}
              />
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button size="sm" variant="success" onClick={() => void salvar()}>
              Salvar plano
            </Button>
          </div>
        </Card>
      )}

      {lista.isLoading && <LoadingCard />}
      {itens.length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum plano cadastrado. Sem plano, o sistema não tem como avisar que a revisão está
          chegando.
        </Card>
      )}
      {itens.map((p) => (
        <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium">
              {p.veiculo.placa} · {p.descricao}
            </p>
            <p className="text-xs text-muted-foreground">
              a cada{" "}
              {[
                p.intervaloKm != null && `${p.intervaloKm.toLocaleString("pt-BR")} km`,
                p.intervaloDias != null && `${p.intervaloDias} dias`,
              ]
                .filter(Boolean)
                .join(" ou ")}
              {(p.ultimoOdometro != null || p.ultimaEm) &&
                ` · última: ${[
                  p.ultimoOdometro != null && `${p.ultimoOdometro.toLocaleString("pt-BR")} km`,
                  p.ultimaEm && dataBR(p.ultimaEm),
                ]
                  .filter(Boolean)
                  .join(", ")}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Permitido chave="manutencao.editar">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setErro(null);
                  setForm({
                    veiculoId: p.veiculo.id,
                    descricao: p.descricao,
                    intervaloKm: p.intervaloKm != null ? String(p.intervaloKm) : "",
                    intervaloDias: p.intervaloDias != null ? String(p.intervaloDias) : "",
                    ultimoOdometro: p.ultimoOdometro != null ? String(p.ultimoOdometro) : "",
                    ultimaEm: p.ultimaEm ? p.ultimaEm.slice(0, 10) : "",
                  });
                  setEditando(p.id);
                }}
              >
                Editar
              </Button>
            </Permitido>
            <Permitido chave="manutencao.excluir">
              <Button size="sm" variant="outline" onClick={() => void remover(p)}>
                Excluir
              </Button>
            </Permitido>
          </div>
        </Card>
      ))}
    </div>
  );
}

type Pneu = {
  id: string;
  numeroFogo: string;
  marca: string | null;
  medida: string | null;
  posicao: string | null;
  sulcoMm: string | number | null;
  medidoEm: string | null;
  valorCompra: string | number | null;
  veiculo: Veiculo | null;
};

/** Mesmo corte dos alertas (`situacaoPneu` na API): até 1,6 mm é o limite legal; até 3 mm, atenção. */
function situacaoSulco(mm: number | null): "CRITICO" | "ATENCAO" | null {
  if (mm == null) return null;
  if (mm <= 1.6) return "CRITICO";
  if (mm <= 3) return "ATENCAO";
  return null;
}

function ListaPneus() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  // null = fechado; "" = novo; id = editando.
  const [editando, setEditando] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const vazio = {
    numeroFogo: "",
    marca: "",
    medida: "",
    veiculoId: undefined as string | undefined,
    posicao: "",
    sulcoMm: "",
    valorCompra: "",
  };
  const [form, setForm] = React.useState(vazio);

  const lista = useQuery({
    queryKey: ["pneus"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<{ data: Pneu[] }>("/admin/pneus?pageSize=200", { token: token! }),
  });

  function abrir(p?: Pneu) {
    setErro(null);
    if (!p) {
      setForm(vazio);
      setEditando("");
      return;
    }
    setForm({
      numeroFogo: p.numeroFogo,
      marca: p.marca ?? "",
      medida: p.medida ?? "",
      veiculoId: p.veiculo?.id,
      posicao: p.posicao ?? "",
      sulcoMm: p.sulcoMm != null ? String(p.sulcoMm).replace(".", ",") : "",
      valorCompra: p.valorCompra != null ? String(p.valorCompra).replace(".", ",") : "",
    });
    setEditando(p.id);
  }

  async function atualizar() {
    await queryClient.invalidateQueries({ queryKey: ["pneus"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
  }

  async function salvar() {
    if (!token || editando === null) return;
    if (!form.numeroFogo.trim()) return setErro("Informe o número de fogo do pneu.");
    setErro(null);
    try {
      await fetchApi(editando ? `/admin/pneus/${editando}` : "/admin/pneus", {
        token,
        method: editando ? "PATCH" : "POST",
        body: JSON.stringify({
          numeroFogo: form.numeroFogo,
          marca: form.marca || null,
          medida: form.medida || null,
          veiculoId: form.veiculoId ?? null,
          posicao: form.posicao || null,
          sulcoMm: decimal(form.sulcoMm),
          valorCompra: decimal(form.valorCompra),
        }),
      });
      setEditando(null);
      await atualizar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function tirarDeUso(p: Pneu) {
    if (!token) return;
    const ok = await confirmar({
      title: `Tirar o pneu ${p.numeroFogo} de uso?`,
      description: "Ele sai da lista e do caminhão. O histórico dele continua guardado.",
      confirmLabel: "Tirar de uso",
      variant: "destructive",
    });
    if (!ok) return;
    await fetchApi(`/admin/pneus/${p.id}`, { token, method: "DELETE" });
    await atualizar();
  }

  const itens = lista.data?.data ?? [];

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <Permitido chave="pneus.criar">
        <Button variant="outline" size="sm" onClick={() => abrir()}>
          <Plus className="h-3.5 w-3.5" /> Cadastrar pneu
        </Button>
      </Permitido>

      {editando !== null && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">{editando ? "Editar pneu" : "Cadastrar pneu"}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="pneu-fogo">Número de fogo</Label>
              <Input
                id="pneu-fogo"
                value={form.numeroFogo}
                onChange={(e) => setForm({ ...form, numeroFogo: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pneu-marca">Marca</Label>
              <Input
                id="pneu-marca"
                value={form.marca}
                onChange={(e) => setForm({ ...form, marca: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pneu-medida">Medida</Label>
              <Input
                id="pneu-medida"
                placeholder="ex: 295/80 R22.5"
                value={form.medida}
                onChange={(e) => setForm({ ...form, medida: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Caminhão (vazio = em estoque)</Label>
              <VeiculoCombobox
                triggerClassName="sm:w-full"
                value={form.veiculoId}
                onChange={(v) => setForm({ ...form, veiculoId: v })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pneu-pos">Posição</Label>
              <Input
                id="pneu-pos"
                placeholder="ex: DE1, TD2"
                value={form.posicao}
                onChange={(e) => setForm({ ...form, posicao: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pneu-sulco">Sulco medido (mm)</Label>
              <Input
                id="pneu-sulco"
                inputMode="decimal"
                placeholder="ex: 8,5"
                value={form.sulcoMm}
                onChange={(e) => setForm({ ...form, sulcoMm: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                1,6 mm é o limite legal. O sistema avisa a partir de 3 mm.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pneu-valor">Valor de compra (R$)</Label>
              <Input
                id="pneu-valor"
                inputMode="decimal"
                value={form.valorCompra}
                onChange={(e) => setForm({ ...form, valorCompra: e.target.value })}
              />
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button size="sm" variant="success" onClick={() => void salvar()}>
              Salvar pneu
            </Button>
          </div>
        </Card>
      )}

      {lista.isLoading && <LoadingCard />}
      {itens.length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum pneu cadastrado. O controle por número de fogo é o que permite saber o custo
          por carcaça.
        </Card>
      )}
      {itens.map((p) => {
        const mm = p.sulcoMm != null ? Number(p.sulcoMm) : null;
        const sit = situacaoSulco(mm);
        return (
          <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">Fogo {p.numeroFogo}</p>
              <p className="text-xs text-muted-foreground">
                {p.veiculo?.placa ?? "em estoque"}
                {p.posicao && ` · posição ${p.posicao}`}
                {[p.marca, p.medida].filter(Boolean).length > 0 &&
                  ` · ${[p.marca, p.medida].filter(Boolean).join(" ")}`}
                {p.medidoEm && ` · medido em ${dataBR(p.medidoEm)}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={`border-transparent ${
                  sit === "CRITICO"
                    ? "bg-red-100 text-red-700"
                    : sit === "ATENCAO"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {mm != null ? `${String(mm).replace(".", ",")} mm` : "sem medição"}
              </Badge>
              <Permitido chave="pneus.editar">
                <Button size="sm" variant="outline" onClick={() => abrir(p)}>
                  Editar
                </Button>
              </Permitido>
              <Permitido chave="pneus.excluir">
                <Button size="sm" variant="outline" onClick={() => void tirarDeUso(p)}>
                  Tirar de uso
                </Button>
              </Permitido>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

type Multa = {
  id: string;
  infracao: string;
  numeroAit: string | null;
  gravidade: string | null;
  local: string | null;
  ocorridaEm: string;
  valor: string;
  vencimento: string | null;
  prazoIndicacao: string | null;
  status: StatusMultaTipo;
  veiculo: Veiculo | null;
  motorista: { id: string; nome: string } | null;
};

const GRAVIDADES = [
  ["LEVE", "Leve (3 pontos)"],
  ["MEDIA", "Média (4 pontos)"],
  ["GRAVE", "Grave (5 pontos)"],
  ["GRAVISSIMA", "Gravíssima (7 pontos)"],
] as const;

function ListaMultas() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("multas.editar");
  const queryClient = useQueryClient();
  const [criando, setCriando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const vazio = {
    infracao: "",
    ocorridaEm: "",
    valor: "",
    veiculoId: undefined as string | undefined,
    motoristaId: undefined as string | undefined,
    numeroAit: "",
    gravidade: "",
    local: "",
    vencimento: "",
    prazoIndicacao: "",
  };
  const [form, setForm] = React.useState(vazio);

  const lista = useQuery({
    queryKey: ["multas"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<{ data: Multa[] }>("/admin/multas?pageSize=100", { token: token! }),
  });

  async function atualizar() {
    await queryClient.invalidateQueries({ queryKey: ["multas"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
  }

  async function salvar() {
    if (!token) return;
    if (form.infracao.trim().length < 3) return setErro("Diga qual foi a infração.");
    if (!form.ocorridaEm) return setErro("Informe a data da infração.");
    const valor = decimal(form.valor);
    if (valor == null || valor <= 0) return setErro("Informe o valor da multa.");
    setErro(null);
    try {
      await fetchApi("/admin/multas", {
        token,
        method: "POST",
        body: JSON.stringify({
          infracao: form.infracao,
          ocorridaEm: form.ocorridaEm,
          valor,
          veiculoId: form.veiculoId ?? null,
          motoristaId: form.motoristaId ?? null,
          numeroAit: form.numeroAit || null,
          gravidade: form.gravidade || null,
          local: form.local || null,
          vencimento: form.vencimento || null,
          prazoIndicacao: form.prazoIndicacao || null,
        }),
      });
      setCriando(false);
      setForm(vazio);
      await atualizar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function mudarStatus(id: string, status: StatusMultaTipo) {
    if (!token) return;
    await fetchApi(`/admin/multas/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await atualizar();
  }

  async function indicarCondutor(id: string, motoristaId: string | undefined) {
    if (!token) return;
    await fetchApi(`/admin/multas/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ motoristaId: motoristaId ?? null }),
    });
    await atualizar();
  }

  const itens = lista.data?.data ?? [];

  return (
    <div className="space-y-3">
      <Permitido chave="multas.criar">
        <Button variant="outline" size="sm" onClick={() => setCriando((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Registrar multa
        </Button>
      </Permitido>

      {criando && (
        <Card className="space-y-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="multa-inf">Infração</Label>
            <Input
              id="multa-inf"
              placeholder="ex: Excesso de velocidade até 20%"
              value={form.infracao}
              onChange={(e) => setForm({ ...form, infracao: e.target.value })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="multa-data">Data da infração</Label>
              <Input
                id="multa-data"
                type="date"
                value={form.ocorridaEm}
                onChange={(e) => setForm({ ...form, ocorridaEm: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="multa-valor">Valor (R$)</Label>
              <Input
                id="multa-valor"
                inputMode="decimal"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="multa-grav">Gravidade</Label>
              <Select
                id="multa-grav"
                value={form.gravidade}
                onChange={(e) => setForm({ ...form, gravidade: e.target.value })}
              >
                <option value="">Não sei</option>
                {GRAVIDADES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                triggerClassName="sm:w-full"
                value={form.veiculoId}
                onChange={(v) => setForm({ ...form, veiculoId: v })}
              />
            </div>
            <div className="space-y-1">
              <Label>Quem dirigia (se já souber)</Label>
              <MotoristaCombobox
                  triggerClassName="sm:w-full"
                value={form.motoristaId}
                onChange={(v) => setForm({ ...form, motoristaId: v })}
                placeholder="Escolher motorista…"
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="multa-ait">Número do auto (AIT)</Label>
              <Input
                id="multa-ait"
                value={form.numeroAit}
                onChange={(e) => setForm({ ...form, numeroAit: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="multa-local">Local</Label>
              <Input
                id="multa-local"
                placeholder="ex: BR-277, km 120"
                value={form.local}
                onChange={(e) => setForm({ ...form, local: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="multa-prazo">Prazo pra indicar o condutor</Label>
              <Input
                id="multa-prazo"
                type="date"
                value={form.prazoIndicacao}
                onChange={(e) => setForm({ ...form, prazoIndicacao: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Perder esse prazo passa os pontos pra empresa. O sistema avisa antes.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="multa-venc">Vencimento do boleto</Label>
              <Input
                id="multa-venc"
                type="date"
                value={form.vencimento}
                onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
              />
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
            <Button size="sm" variant="success" onClick={() => void salvar()}>
              Salvar multa
            </Button>
          </div>
        </Card>
      )}

      {lista.isLoading && <LoadingCard />}
      {itens.length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma multa registrada.</Card>
      )}
      {itens.map((m) => (
        <Card key={m.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{m.infracao}</p>
              <p className="text-xs text-muted-foreground">
                {m.veiculo?.placa ?? "sem placa"} · {dataBR(m.ocorridaEm)}
                {m.local && ` · ${m.local}`}
                {m.prazoIndicacao && ` · indicar até ${dataBR(m.prazoIndicacao)}`}
                {m.vencimento && ` · vence ${dataBR(m.vencimento)}`}
              </p>
            </div>
            <div className="text-right">
              <p className="font-medium tabular-nums">{brl(m.valor)}</p>
              <Badge className="mt-1 border-transparent bg-slate-100 text-slate-700">
                {STATUS_MULTA_LABEL[m.status]}
              </Badge>
            </div>
          </div>
          {m.motorista && !podeEditar && (
            <p className="text-xs text-muted-foreground">Quem dirigia: {m.motorista.nome}</p>
          )}
          <Permitido chave="multas.editar">
            <div className="grid gap-3 border-t pt-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Quem dirigia</Label>
                <MotoristaCombobox
                  triggerClassName="sm:w-full"
                  value={m.motorista?.id}
                  initialOption={
                    m.motorista ? { value: m.motorista.id, label: m.motorista.nome } : undefined
                  }
                  onChange={(v) => void indicarCondutor(m.id, v)}
                  placeholder="Escolher motorista…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`multa-st-${m.id}`}>Situação</Label>
                <Select
                  id={`multa-st-${m.id}`}
                  value={m.status}
                  onChange={(e) => void mudarStatus(m.id, e.target.value as StatusMultaTipo)}
                >
                  {STATUS_MULTA.map((st) => (
                    <option key={st} value={st}>
                      {STATUS_MULTA_LABEL[st]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Permitido>
        </Card>
      ))}
    </div>
  );
}

function ListaDocumentos() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [veiculoInicial, setVeiculoInicial] = React.useState<Veiculo | null>(null);
  const [form, setForm] = React.useState({
    veiculoId: undefined as string | undefined,
    tipo: "CRLV",
    validade: "",
  });
  const [erro, setErro] = React.useState<string | null>(null);

  const lista = useQuery({
    queryKey: ["documentos-veiculo"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Alertas["documentos"]>("/admin/documentos-veiculo", { token: token! }),
  });

  async function salvar() {
    if (!token) return;
    if (!form.veiculoId) return setErro("Escolha o caminhão.");
    setErro(null);
    await fetchApi("/admin/documentos-veiculo", {
      token,
      method: "POST",
      body: JSON.stringify({
        veiculoId: form.veiculoId,
        tipo: form.tipo,
        validade: form.validade || null,
      }),
    });
    setForm({ ...form, validade: "" });
    await queryClient.invalidateQueries({ queryKey: ["documentos-veiculo"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
  }

  /** Editar = o mesmo caminhão e documento com a data nova (o salvar troca a validade). */
  function editar(d: Alertas["documentos"][number]) {
    setVeiculoInicial(d.veiculo);
    setForm({ veiculoId: d.veiculo.id, tipo: d.tipo, validade: d.validade ? d.validade.slice(0, 10) : "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function excluir(d: Alertas["documentos"][number]) {
    if (!token) return;
    const ok = await confirmar({
      title: `Excluir o ${d.tipo} do ${d.veiculo.placa}?`,
      description: "O aviso de vencimento deste documento para de aparecer.",
      confirmLabel: "Excluir documento",
      variant: "destructive",
    });
    if (!ok) return;
    await fetchApi(`/admin/documentos-veiculo/${d.id}`, { token, method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["documentos-veiculo"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
  }

  return (
    <div className="space-y-3">
      <ConfirmDialog />
      <Permitido chave="documentos-veiculo.editar">
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">Cadastrar validade</p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                triggerClassName="sm:w-full"
                value={form.veiculoId}
                initialOption={
                  veiculoInicial ? { value: veiculoInicial.id, label: veiculoInicial.placa } : undefined
                }
                onChange={(v) => setForm({ ...form, veiculoId: v })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-tipo">Documento</Label>
              <Select
                id="doc-tipo"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              >
                {TIPOS_DOCUMENTO_VEICULO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-val">Vence em</Label>
              <Input
                id="doc-val"
                type="date"
                value={form.validade}
                onChange={(e) => setForm({ ...form, validade: e.target.value })}
              />
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void salvar()}>
              Salvar
            </Button>
          </div>
        </Card>
      </Permitido>

      {lista.isLoading && <LoadingCard />}
      {(lista.data ?? []).map((d) => (
        <Card key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">
              {d.veiculo.placa} · {d.tipo}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              vence {dataBR(d.validade)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          {d.diasRestantes != null && d.diasRestantes <= 45 && (
            <Badge
              className={`border-transparent ${
                d.diasRestantes < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
              }`}
            >
              <AlertTriangle className="mr-1 h-3 w-3" />
              {d.diasRestantes < 0 ? "vencido" : `${d.diasRestantes} dias`}
            </Badge>
          )}
          <Permitido chave="documentos-veiculo.editar">
            <Button size="sm" variant="outline" onClick={() => editar(d)}>
              Editar
            </Button>
            <Button size="sm" variant="outline" onClick={() => void excluir(d)}>
              Excluir
            </Button>
          </Permitido>
          </div>
        </Card>
      ))}
    </div>
  );
}
