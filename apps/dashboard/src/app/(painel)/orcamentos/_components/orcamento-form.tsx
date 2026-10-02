"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Plus, Trash2 } from "lucide-react";
import {
  BASES_PRECO,
  BASE_PRECO_LABEL,
  UNIDADES_PEDIDO,
  UNIDADE_PEDIDO_LABEL,
  VALIDADE_PADRAO_ORCAMENTO_DIAS,
  type BasePrecoTipo,
  type SugestaoItemOrcamento,
  type UnidadePedidoTipo,
} from "@ronan/shared-types";
import { LocalCombobox } from "@/components/fk-comboboxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken, useCreateResource, useResourceOptions, useUpdateResource } from "@/lib/client-api";
import { lerNumero } from "@/lib/numero";
import { hojeSP } from "@/lib/datetime-br";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";
import { BarraDeAcao } from "@/components/barra-de-acao";
import { brl, num, type LocalResumo, type Orcamento } from "./tipos";

type Nomeado = { id: string; nome: string };
type MaterialOpt = Nomeado & { densidadeTonM3?: string | number | null };

const PATH = "/admin/orcamentos";

type ItemForm = {
  chave: string;
  materialId: string;
  tipoServicoId: string;
  localCargaId: string | undefined;
  localCarga: LocalResumo | null;
  localDescargaId: string | undefined;
  localDescarga: LocalResumo | null;
  descricao: string;
  quantidade: string;
  unidade: UnidadePedidoTipo;
  base: BasePrecoTipo;
  preco: string;
  /** De onde veio o preço: a pessoa digitou ou a tabela do cliente sugeriu. */
  precoDaTabela: boolean;
  kmEstimado: string | null;
  kmMotivo: string | null;
  precoMotivo: string | null;
  buscando: boolean;
};

let seq = 0;
const novaChave = () => `i${++seq}`;

function itemVazio(): ItemForm {
  return {
    chave: novaChave(),
    materialId: "",
    tipoServicoId: "",
    localCargaId: undefined,
    localCarga: null,
    localDescargaId: undefined,
    localDescarga: null,
    descricao: "",
    quantidade: "",
    unidade: "TONELADAS",
    base: "TONELADA",
    preco: "",
    precoDaTabela: false,
    kmEstimado: null,
    kmMotivo: null,
    precoMotivo: null,
    buscando: false,
  };
}

/** Rótulo do local já escolhido, sem esperar a busca do combobox. */
const opcaoLocal = (l: LocalResumo) => ({
  value: l.id,
  label: l.nome,
  sublabel: [l.cidade, l.uf].filter(Boolean).join("/") || undefined,
});

const virgula =(v: string | number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

function somaDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Prévia do valor da linha, só pra quem monta ter noção. Quem decide o número
 * de verdade é a API (common/orcamento.ts) — a tela de detalhe mostra o dela.
 */
function previaValor(it: ItemForm, densidade: number | null): number | null {
  const q = lerNumero(it.quantidade);
  const p = lerNumero(it.preco);
  if (!q.ok || !p.ok || q.valor == null || p.valor == null) return null;
  const km = it.kmEstimado != null ? Number(it.kmEstimado) : null;
  const qtd = q.valor;
  switch (it.base) {
    case "VIAGEM":
      return it.unidade === "VIAGENS" ? qtd * p.valor : null;
    case "KM":
      return it.unidade === "VIAGENS" && km ? qtd * km * p.valor : null;
    case "TONELADA":
      if (it.unidade === "TONELADAS") return qtd * p.valor;
      if (it.unidade === "M3" && densidade) return qtd * densidade * p.valor;
      return null;
    case "M3":
      if (it.unidade === "M3") return qtd * p.valor;
      if (it.unidade === "TONELADAS" && densidade) return (qtd / densidade) * p.valor;
      return null;
  }
}

export function OrcamentoForm({ initial }: { initial?: Orcamento }) {
  const router = useRouter();
  const token = useAuthToken();
  const empresas = useResourceOptions<Nomeado & { contato?: string | null }>("/admin/empresas");
  const materiais = useResourceOptions<MaterialOpt>("/admin/materiais");
  const tiposServico = useResourceOptions<Nomeado>("/admin/tipos-servico");
  const create = useCreateResource<unknown, Orcamento>(PATH, PATH);
  const update = useUpdateResource<unknown, Orcamento>(PATH, PATH);
  const [erro, setErro] = useState<string | null>(null);

  const hoje = hojeSP();
  const [cab, setCab] = useState({
    // "cadastrado" = cliente da lista; "novo" = alguém que ainda não é cliente.
    tipoCliente: (initial && !initial.empresaId ? "novo" : "cadastrado") as "cadastrado" | "novo",
    empresaId: initial?.empresaId ?? "",
    clienteId: initial?.clienteId ?? "",
    prospectNome: initial?.prospectNome ?? "",
    prospectContato: initial?.prospectContato ?? "",
    validadeEm: initial?.validadeEm.slice(0, 10) ?? somaDias(hoje, VALIDADE_PADRAO_ORCAMENTO_DIAS),
    inicioPrevistoEm: initial?.inicioPrevistoEm?.slice(0, 10) ?? "",
    prazoEm: initial?.prazoEm?.slice(0, 10) ?? "",
    condicoes: initial?.condicoes ?? "",
  });
  const [itens, setItens] = useState<ItemForm[]>(() =>
    initial?.itens.length
      ? initial.itens.map((it) => ({
          ...itemVazio(),
          materialId: it.materialId ?? "",
          tipoServicoId: it.tipoServicoId ?? "",
          localCargaId: it.localCargaId ?? undefined,
          localCarga: it.localCarga,
          localDescargaId: it.localDescargaId ?? undefined,
          localDescarga: it.localDescarga,
          descricao: it.descricao ?? "",
          quantidade: virgula(Number(it.quantidade)),
          unidade: it.unidade,
          base: it.base,
          preco: virgula(it.precoUnitario),
          kmEstimado: it.kmEstimado,
        }))
      : [itemVazio()],
  );

  const obras = useResourceOptions<Nomeado>("/admin/clientes", {
    enabled: cab.tipoCliente === "cadastrado" && !!cab.empresaId,
    extraParams: { empresaId: cab.empresaId },
  });

  const sujo = useSujo({ cab, itens: itens.map(({ buscando: _b, ...r }) => r) });
  useAvisarSeSujo(sujo);

  const empresaIdEfetiva = cab.tipoCliente === "cadastrado" ? cab.empresaId : "";

  // Sugestão (km da rota + preço da tabela) quando muda o que a determina.
  // Chave por item: só refaz a consulta do item que mudou.
  const ultimaConsulta = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!token) return;
    for (const it of itens) {
      const params = new URLSearchParams();
      if (empresaIdEfetiva) params.set("empresaId", empresaIdEfetiva);
      if (it.materialId) params.set("materialId", it.materialId);
      if (it.tipoServicoId) params.set("tipoServicoId", it.tipoServicoId);
      if (it.localCargaId) params.set("localCargaId", it.localCargaId);
      if (it.localDescargaId) params.set("localDescargaId", it.localDescargaId);
      const qs = params.toString();
      if (ultimaConsulta.current[it.chave] === qs) continue;
      ultimaConsulta.current[it.chave] = qs;
      const chave = it.chave;
      setItens((lista) => lista.map((x) => (x.chave === chave ? { ...x, buscando: true } : x)));
      fetchApi<SugestaoItemOrcamento>(`${PATH}/sugestao?${qs}`, { token })
        .then((s) => {
          setItens((lista) =>
            lista.map((x) => {
              if (x.chave !== chave || ultimaConsulta.current[chave] !== qs) return x;
              // Preço digitado pela pessoa nunca é sobrescrito; o da tabela,
              // sim (mudou o material, muda a sugestão).
              const podeTrocarPreco = !x.preco.trim() || x.precoDaTabela;
              return {
                ...x,
                buscando: false,
                kmEstimado: s.kmEstimado,
                kmMotivo: s.kmMotivo,
                precoMotivo: s.precoMotivo,
                ...(podeTrocarPreco
                  ? s.preco
                    ? { preco: virgula(s.preco.precoUnitario), base: s.preco.base, precoDaTabela: true }
                    : x.precoDaTabela
                      ? { preco: "", precoDaTabela: false }
                      : {}
                  : {}),
              };
            }),
          );
        })
        .catch(() => {
          setItens((lista) => lista.map((x) => (x.chave === chave ? { ...x, buscando: false } : x)));
        });
    }
  }, [itens, empresaIdEfetiva, token]);

  function mudarItem(chave: string, patch: Partial<ItemForm>) {
    setItens((lista) => lista.map((x) => (x.chave === chave ? { ...x, ...patch } : x)));
  }

  const densidadeDe = (materialId: string) => {
    const m = materiais.data?.find((x) => x.id === materialId);
    return m?.densidadeTonM3 != null ? Number(m.densidadeTonM3) : null;
  };
  const previas = itens.map((it) => previaValor(it, densidadeDe(it.materialId)));
  const totalPrevia = previas.reduce<number>((s, v) => s + (v ?? 0), 0);
  // Item ainda em branco não "fica de fora": só conta o que tem quantidade e
  // preço e mesmo assim não fecha conta (unidade ≠ base, sem km, sem densidade).
  const semPrevia = previas.filter((v, i) => v == null && itens[i]!.quantidade.trim() && itens[i]!.preco.trim()).length;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (cab.tipoCliente === "cadastrado" && !cab.empresaId) return setErro("Escolha o cliente.");
    if (cab.tipoCliente === "novo" && !cab.prospectNome.trim()) return setErro("Escreva o nome de quem vai receber a proposta.");
    if (cab.validadeEm < hoje && initial?.status !== "VENCIDO") return setErro("A validade não pode ser antes de hoje.");
    if (cab.prazoEm && cab.inicioPrevistoEm && cab.prazoEm < cab.inicioPrevistoEm) {
      return setErro("O prazo não pode ser antes do início.");
    }
    const corpoItens = [];
    for (const [i, it] of itens.entries()) {
      const q = lerNumero(it.quantidade);
      const p = lerNumero(it.preco);
      if (!q.ok || q.valor == null || q.valor <= 0) return setErro(`Item ${i + 1}: informe a quantidade.`);
      if (!p.ok || p.valor == null || p.valor <= 0) return setErro(`Item ${i + 1}: informe o preço.`);
      if (it.unidade === "M3" && !it.materialId) {
        return setErro(`Item ${i + 1}: em m³ precisa do material — é a densidade dele que converte o peso em volume.`);
      }
      corpoItens.push({
        materialId: it.materialId || null,
        tipoServicoId: it.tipoServicoId || null,
        localCargaId: it.localCargaId ?? null,
        localDescargaId: it.localDescargaId ?? null,
        descricao: it.descricao.trim() || null,
        quantidade: q.valor,
        unidade: it.unidade,
        base: it.base,
        precoUnitario: p.valor,
        kmEstimado: it.kmEstimado != null ? Number(it.kmEstimado) : null,
      });
    }
    const body = {
      empresaId: cab.tipoCliente === "cadastrado" ? cab.empresaId : null,
      clienteId: cab.tipoCliente === "cadastrado" ? cab.clienteId || null : null,
      prospectNome: cab.tipoCliente === "novo" ? cab.prospectNome.trim() : null,
      prospectContato: cab.prospectContato.trim() || null,
      validadeEm: cab.validadeEm,
      inicioPrevistoEm: cab.inicioPrevistoEm || null,
      prazoEm: cab.prazoEm || null,
      condicoes: cab.condicoes.trim() || null,
      itens: corpoItens,
    };
    try {
      const salvo = initial
        ? await update.mutateAsync({ id: initial.id, body })
        : await create.mutateAsync(body);
      router.push(`/orcamentos/${salvo.id}` as Route);
    } catch (e) {
      setErro((e as Error).message || "Não salvei. Confira os campos e tente de novo.");
    }
  }

  const salvando = create.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Para quem</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="tipoCliente"
              checked={cab.tipoCliente === "cadastrado"}
              onChange={() => setCab({ ...cab, tipoCliente: "cadastrado" })}
            />
            Cliente cadastrado
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="tipoCliente"
              checked={cab.tipoCliente === "novo"}
              onChange={() => setCab({ ...cab, tipoCliente: "novo", empresaId: "", clienteId: "" })}
            />
            Ainda não é cliente
          </label>
        </div>
        {cab.tipoCliente === "cadastrado" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="orc-empresa">Cliente</Label>
              <Select
                id="orc-empresa"
                value={cab.empresaId}
                onChange={(e) => setCab({ ...cab, empresaId: e.target.value, clienteId: "" })}
              >
                <option value="" disabled>
                  Escolha o cliente
                </option>
                {empresas.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Com cliente cadastrado, o preço da tabela dele aparece sozinho em cada item.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orc-obra">Obra</Label>
              <Select
                id="orc-obra"
                value={cab.clienteId}
                disabled={!cab.empresaId}
                onChange={(e) => setCab({ ...cab, clienteId: e.target.value })}
              >
                <option value="">Qualquer obra / ainda não definida</option>
                {obras.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orc-contato">Contato pra mandar a proposta</Label>
              <Input
                id="orc-contato"
                placeholder="WhatsApp ou e-mail (opcional)"
                value={cab.prospectContato}
                onChange={(e) => setCab({ ...cab, prospectContato: e.target.value })}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="orc-prospect">Nome</Label>
              <Input
                id="orc-prospect"
                placeholder="empresa ou pessoa que vai receber"
                value={cab.prospectNome}
                onChange={(e) => setCab({ ...cab, prospectNome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orc-prospect-contato">Contato</Label>
              <Input
                id="orc-prospect-contato"
                placeholder="WhatsApp ou e-mail"
                value={cab.prospectContato}
                onChange={(e) => setCab({ ...cab, prospectContato: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground md:col-span-2">
              Quando ele aprovar, dá pra cadastrar como cliente na hora, com esse nome e contato.
            </p>
          </div>
        )}
      </Card>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">O que está sendo proposto</h2>
        {itens.map((it, i) => {
          const previa = previas[i];
          return (
            <Card key={it.chave} className="space-y-4 p-5" data-testid="orcamento-item">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">Item {i + 1}</p>
                {itens.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setItens(itens.filter((x) => x.chave !== it.chave))}
                  >
                    <Trash2 className="h-4 w-4" /> Tirar item
                  </Button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor={`orc-mat-${it.chave}`}>Material</Label>
                  <Select
                    id={`orc-mat-${it.chave}`}
                    value={it.materialId}
                    onChange={(e) => mudarItem(it.chave, { materialId: e.target.value })}
                  >
                    <option value="">Sem material específico</option>
                    {materiais.data?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`orc-serv-${it.chave}`}>Tipo de serviço</Label>
                  <Select
                    id={`orc-serv-${it.chave}`}
                    value={it.tipoServicoId}
                    onChange={(e) => mudarItem(it.chave, { tipoServicoId: e.target.value })}
                  >
                    <option value="">Qualquer</option>
                    {tiposServico.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`orc-desc-${it.chave}`}>Descrição no PDF</Label>
                  <Input
                    id={`orc-desc-${it.chave}`}
                    placeholder="opcional — ex.: entrega parcelada"
                    value={it.descricao}
                    onChange={(e) => mudarItem(it.chave, { descricao: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Carrega em</Label>
                  <LocalCombobox
                    value={it.localCargaId}
                    onChange={(v) => mudarItem(it.chave, { localCargaId: v })}
                    triggerClassName="sm:w-full"
                    initialOption={it.localCarga ? opcaoLocal(it.localCarga) : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Entrega em</Label>
                  <LocalCombobox
                    value={it.localDescargaId}
                    onChange={(v) => mudarItem(it.chave, { localDescargaId: v })}
                    triggerClassName="sm:w-full"
                    initialOption={it.localDescarga ? opcaoLocal(it.localDescarga) : undefined}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="orcamento-km">
                {it.buscando
                  ? "Calculando a rota…"
                  : it.kmEstimado != null
                    ? `Rota: ${num(it.kmEstimado, 1)} km pela estrada.`
                    : (it.kmMotivo ?? "")}
              </p>

              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor={`orc-qtd-${it.chave}`}>Quantidade</Label>
                  <Input
                    id={`orc-qtd-${it.chave}`}
                    inputMode="decimal"
                    placeholder="ex: 300"
                    value={it.quantidade}
                    onChange={(e) => mudarItem(it.chave, { quantidade: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`orc-un-${it.chave}`}>Medido em</Label>
                  <Select
                    id={`orc-un-${it.chave}`}
                    value={it.unidade}
                    onChange={(e) => mudarItem(it.chave, { unidade: e.target.value as UnidadePedidoTipo })}
                  >
                    {UNIDADES_PEDIDO.map((u) => (
                      <option key={u} value={u}>
                        {UNIDADE_PEDIDO_LABEL[u]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`orc-base-${it.chave}`}>Preço cobrado</Label>
                  <Select
                    id={`orc-base-${it.chave}`}
                    value={it.base}
                    onChange={(e) =>
                      mudarItem(it.chave, { base: e.target.value as BasePrecoTipo, precoDaTabela: false })
                    }
                  >
                    {BASES_PRECO.map((b) => (
                      <option key={b} value={b}>
                        {BASE_PRECO_LABEL[b].nome}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`orc-preco-${it.chave}`}>Preço ({BASE_PRECO_LABEL[it.base].unidade})</Label>
                  <Input
                    id={`orc-preco-${it.chave}`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={it.preco}
                    onChange={(e) => mudarItem(it.chave, { preco: e.target.value, precoDaTabela: false })}
                  />
                  {it.precoDaTabela ? (
                    <p className="text-xs text-emerald-700" data-testid="orcamento-preco-tabela">
                      Preço da tabela do cliente.
                    </p>
                  ) : (
                    !it.preco.trim() &&
                    it.precoMotivo && <p className="text-xs text-muted-foreground">{it.precoMotivo}</p>
                  )}
                </div>
              </div>
              {it.unidade === "M3" && !it.materialId && (
                <p className="text-xs text-amber-700">
                  Em m³ precisa do material: a balança pesa em tonelada, e é a densidade dele que converte.
                </p>
              )}
              <p className="text-right text-sm tabular-nums">
                {previa != null ? (
                  <>
                    Valor estimado: <span className="font-semibold">{brl(previa)}</span>
                  </>
                ) : it.quantidade && it.preco ? (
                  <span className="text-amber-700">
                    Sem valor estimado: a quantidade não está na unidade do preço
                    {it.base === "KM" ? " ou a rota não tem distância" : ""}.
                  </span>
                ) : null}
              </p>
            </Card>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setItens([...itens, itemVazio()])}>
          <Plus className="h-4 w-4" /> Outro item
        </Button>
      </div>

      <Card className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Prazos e condições</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="orc-validade">Proposta vale até</Label>
            <Input
              id="orc-validade"
              type="date"
              value={cab.validadeEm}
              onChange={(e) => setCab({ ...cab, validadeEm: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orc-inicio">Início previsto</Label>
            <Input
              id="orc-inicio"
              type="date"
              value={cab.inicioPrevistoEm}
              onChange={(e) => setCab({ ...cab, inicioPrevistoEm: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orc-prazo">Concluir até</Label>
            <Input
              id="orc-prazo"
              type="date"
              value={cab.prazoEm}
              onChange={(e) => setCab({ ...cab, prazoEm: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="orc-condicoes">Condições</Label>
          <Textarea
            id="orc-condicoes"
            rows={4}
            placeholder="ex.: pagamento em 28 dias após o fechamento; pedágio incluso; sujeito à disponibilidade de caminhão"
            value={cab.condicoes}
            onChange={(e) => setCab({ ...cab, condicoes: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Sai no PDF, embaixo dos itens.</p>
        </div>
        <div className="flex items-baseline justify-between border-t pt-4">
          <span className="text-sm text-muted-foreground">
            Total estimado
            {semPrevia > 0 && ` (${semPrevia} ${semPrevia === 1 ? "item fica" : "itens ficam"} de fora)`}
          </span>
          <span className="text-2xl font-semibold tabular-nums" data-testid="orcamento-total">
            {brl(totalPrevia)}
          </span>
        </div>
      </Card>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <BarraDeAcao>
        <BotaoCancelar href={initial ? `/orcamentos/${initial.id}` : "/orcamentos"} sujo={sujo} />
        <Button type="submit" variant="success" disabled={salvando}>
          Salvar orçamento
        </Button>
      </BarraDeAcao>
    </form>
  );
}
