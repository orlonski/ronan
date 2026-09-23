"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CircleDot,
  FileWarning,
  Plus,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import {
  STATUS_MANUTENCAO_LABEL,
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
import { VeiculoCombobox } from "@/components/fk-comboboxes";
import { fetchApi, useAuthToken } from "@/lib/client-api";

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
};

type Manutencao = {
  id: string;
  tipo: TipoManutencaoTipo;
  status: StatusManutencaoTipo;
  descricao: string;
  odometro: number | null;
  previstaEm: string | null;
  valorTotal: string | null;
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

type Aba = "alertas" | "manutencoes" | "pneus" | "multas" | "documentos";

function Conteudo() {
  const token = useAuthToken();
  const [aba, setAba] = React.useState<Aba>("alertas");

  const alertas = useQuery({
    queryKey: ["frota-alertas"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Alertas>("/admin/manutencao/alertas", { token: token! }),
  });

  const total = alertas.data
    ? alertas.data.manutencoes.length +
      alertas.data.documentos.length +
      alertas.data.pneus.length +
      alertas.data.emOficina.length
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
        {(
          [
            ["alertas", total > 0 ? `Precisa de você (${total})` : "Precisa de você"],
            ["manutencoes", "Manutenções"],
            ["pneus", "Pneus"],
            ["multas", "Multas"],
            ["documentos", "Documentos"],
          ] as const
        ).map(([chave, label]) => (
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
        ))}
      </div>

      {aba === "alertas" && (
        <>
          {alertas.isLoading && <LoadingCard />}
          {alertas.data && <BlocoAlertas a={alertas.data} />}
        </>
      )}
      {aba === "manutencoes" && <ListaManutencoes />}
      {aba === "pneus" && <ListaPneus />}
      {aba === "multas" && <ListaMultas />}
      {aba === "documentos" && <ListaDocumentos />}
    </div>
  );
}

function BlocoAlertas({ a }: { a: Alertas }) {
  const nada =
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
          Cadastre planos de manutenção e a validade dos documentos pra ser avisado antes de
          o caminhão parar.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
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
              <li key={m.planoId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{m.veiculo.placa}</span> · {m.descricao}
                </span>
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

function ListaManutencoes() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [criando, setCriando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    veiculoId: undefined as string | undefined,
    tipo: "PREVENTIVA" as TipoManutencaoTipo,
    descricao: "",
    odometro: "",
    valorPecas: "",
    valorMaoObra: "",
  });

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
        }),
      });
      setCriando(false);
      setForm({ ...form, descricao: "", odometro: "", valorPecas: "", valorMaoObra: "" });
      await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
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
      body: JSON.stringify({ status, gerarContaPagar: status === "CONCLUIDA" }),
    });
    await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
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
                value={form.veiculoId}
                onChange={(v) => setForm({ ...form, veiculoId: v })}
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
          <div className="space-y-1">
            <Label htmlFor="man-desc">O que foi feito</Label>
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
                <Button size="sm" variant="success" onClick={() => void mudarStatus(m.id, "CONCLUIDA")}>
                  Concluir e lançar a conta
                </Button>
              </div>
            </Permitido>
          )}
        </Card>
      ))}
    </div>
  );
}

function ListaPneus() {
  const token = useAuthToken();
  const lista = useQuery({
    queryKey: ["pneus"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<{ data: Alertas["pneus"] }>("/admin/pneus?pageSize=200", { token: token! }),
  });

  return (
    <div className="space-y-3">
      {lista.isLoading && <LoadingCard />}
      {(lista.data?.data ?? []).length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum pneu cadastrado. O controle por número de fogo é o que permite saber o custo
          por carcaça.
        </Card>
      )}
      {(lista.data?.data ?? []).map((p) => (
        <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Fogo {p.numeroFogo}</p>
            <p className="text-xs text-muted-foreground">
              {p.veiculo?.placa ?? "em estoque"}
              {p.posicao && ` · posição ${p.posicao}`}
            </p>
          </div>
          <Badge
            className={`border-transparent ${
              p.situacao === "CRITICO"
                ? "bg-red-100 text-red-700"
                : p.situacao === "ATENCAO"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-700"
            }`}
          >
            {p.sulcoMm != null ? `${p.sulcoMm}mm` : "sem medição"}
          </Badge>
        </Card>
      ))}
    </div>
  );
}

function ListaMultas() {
  const token = useAuthToken();
  const lista = useQuery({
    queryKey: ["multas"],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<{ data: Alertas["multas"] }>("/admin/multas?pageSize=100", { token: token! }),
  });

  return (
    <div className="space-y-3">
      {lista.isLoading && <LoadingCard />}
      {(lista.data?.data ?? []).length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma multa registrada.</Card>
      )}
      {(lista.data?.data ?? []).map((m) => (
        <Card key={m.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium">{m.infracao}</p>
            <p className="text-xs text-muted-foreground">
              {m.veiculo?.placa ?? "sem placa"}
              {m.motorista && ` · ${m.motorista.nome}`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular-nums">{brl(m.valor)}</p>
            <Badge className="mt-1 border-transparent bg-slate-100 text-slate-700">
              {STATUS_MULTA_LABEL[m.status]}
            </Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ListaDocumentos() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
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

  return (
    <div className="space-y-3">
      <Permitido chave="documentos-veiculo.editar">
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">Cadastrar validade</p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                value={form.veiculoId}
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
        </Card>
      ))}
    </div>
  );
}
