"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  UNIDADES_PEDIDO,
  UNIDADE_PEDIDO_LABEL,
  type CampoLidoPedido,
  type ExtrairPedidoResult,
  type UnidadePedidoTipo,
} from "@ronan/shared-types";
import { ClienteCombobox, clienteOption, LocalCombobox } from "@/components/fk-comboboxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateResource, useResourceOptions, useUpdateResource } from "@/lib/client-api";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";
import { BarraDeAcao } from "@/components/barra-de-acao";
import { hojeSP } from "@/lib/datetime-br";

type Nomeado = { id: string; nome: string };

export type Pedido = {
  id: string;
  numero: number;
  empresaId: string;
  empresa: Nomeado;
  clienteId: string | null;
  cliente: Nomeado | null;
  materialId: string | null;
  localCargaId: string | null;
  localCarga: (Nomeado & { cidade: string | null; uf: string | null }) | null;
  localDescargaId: string | null;
  localDescarga: (Nomeado & { cidade: string | null; uf: string | null }) | null;
  tipoServicoId: string | null;
  quantidadeAlvo: string;
  unidadeAlvo: UnidadePedidoTipo;
  inicioEm: string;
  prazoEm: string | null;
  prioridade: number;
  status: string;
  observacao: string | null;
};

const PATH = "/admin/pedidos";

type Body = {
  empresaId: string;
  clienteId: string | null;
  materialId: string | null;
  localCargaId: string | null;
  localDescargaId: string | null;
  tipoServicoId: string | null;
  quantidadeAlvo: number;
  unidadeAlvo: UnidadePedidoTipo;
  inicioEm: string;
  prazoEm: string | null;
  prioridade: number;
  observacao: string | null;
};

function soData(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

/** O local que a leitura achou, no formato do `localOption` — rótulo sem buscar. */
function localSugerido(c: ExtrairPedidoResult["localCarga"] | undefined) {
  return c?.valor && c.nome
    ? { id: c.valor, nome: c.nome, cidade: c.cidade ?? null, uf: c.uf ?? null }
    : null;
}

function localOption(l: (Nomeado & { cidade: string | null; uf: string | null }) | null) {
  if (!l) return undefined;
  return {
    value: l.id,
    label: l.cidade ? `${l.nome} — ${l.cidade}${l.uf ? `/${l.uf}` : ""}` : l.nome,
  };
}

/**
 * Destaque do campo que veio da leitura do documento. A cor diz o quanto
 * confiar: verde casou certinho com o cadastro, âmbar é pra conferir com
 * atenção. Campo que não veio fica sem destaque (e vazio) — a pessoa vê que
 * tem que preencher.
 */
function destaque(c: CampoLidoPedido<unknown> | undefined): string {
  if (!c || c.valor == null) return "";
  return c.confianca === "ALTA"
    ? "rounded-md border-l-4 border-emerald-500 bg-emerald-50/60 p-2 dark:bg-emerald-950/20"
    : "rounded-md border-l-4 border-amber-500 bg-amber-50/70 p-2 dark:bg-amber-950/20";
}

/** "lido no documento: …" embaixo do campo — é com isso que se confere. */
function Lido({
  campo,
  cadastro = true,
}: {
  campo: CampoLidoPedido<unknown> | undefined;
  /** Campo que aponta pra cadastro: o "não achei" é no cadastro; nos outros, é o valor que não deu pra usar. */
  cadastro?: boolean;
}) {
  if (!campo?.lido) return null;
  const achou = campo.valor != null;
  return (
    <p className="text-xs text-muted-foreground" data-lido>
      lido no documento: <span className="font-medium text-foreground">“{campo.lido}”</span>
      {!achou && (
        <span className="text-amber-700 dark:text-amber-400">
          {cadastro ? " · não achei no cadastro" : " · preencha você"}
        </span>
      )}
      {achou && campo.confianca !== "ALTA" && (
        <span className="text-amber-700 dark:text-amber-400"> · confira</span>
      )}
    </p>
  );
}

/** Número pro campo de texto no formato que o `onSubmit` lê (vírgula decimal). */
function numeroBR(n: number | undefined): string {
  return n == null ? "" : String(n).replace(".", ",");
}

const ROTULO_ORIGEM: Record<ExtrairPedidoResult["origem"], string> = {
  PDF: "do PDF",
  IMAGEM: "da foto",
  TEXTO: "do texto colado",
};

export function PedidoForm({
  initial,
  sugestao,
}: {
  initial?: Pedido;
  /**
   * Leitura de documento pela IA. Só PREENCHE o formulário: salvar continua
   * sendo o clique da pessoa. Quem troca de sugestão remonta o form (`key`).
   */
  sugestao?: ExtrairPedidoResult;
}) {
  const s = sugestao;
  const router = useRouter();
  const empresas = useResourceOptions<Nomeado>("/admin/empresas");
  const materiais = useResourceOptions<Nomeado & { densidadeTonM3?: string | number | null }>(
    "/admin/materiais",
  );
  const tiposServico = useResourceOptions<Nomeado>("/admin/tipos-servico");
  const create = useCreateResource<Body, Pedido>(PATH, PATH);
  const update = useUpdateResource<Partial<Body>, Pedido>(PATH, PATH);
  const [erro, setErro] = useState<string | null>(null);

  const hoje = hojeSP();
  const [form, setForm] = useState({
    empresaId: initial?.empresaId ?? s?.empresa.valor ?? "",
    clienteId: initial?.clienteId ?? s?.obra.valor ?? undefined,
    materialId: initial?.materialId ?? s?.material.valor ?? "",
    localCargaId: initial?.localCargaId ?? s?.localCarga.valor ?? undefined,
    localDescargaId: initial?.localDescargaId ?? s?.localDescarga.valor ?? undefined,
    tipoServicoId: initial?.tipoServicoId ?? "",
    quantidadeAlvo: initial?.quantidadeAlvo ?? numeroBR(s?.quantidade.valor),
    unidadeAlvo: (initial?.unidadeAlvo ?? s?.unidade.valor ?? "VIAGENS") as UnidadePedidoTipo,
    inicioEm: soData(initial?.inicioEm) || s?.inicioEm.valor || hoje,
    prazoEm: soData(initial?.prazoEm) || s?.prazoEm.valor || "",
    prioridade: initial?.prioridade ?? 0,
    observacao: initial?.observacao ?? s?.observacao.valor ?? "",
  });

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  useEffect(() => {
    // Vindo de documento, cliente vazio quer dizer "não achei no cadastro":
    // escolher o primeiro da lista sozinho seria inventar quem pediu.
    if (initial || s || form.empresaId || !empresas.data?.[0]?.id) return;
    setForm((f) => ({ ...f, empresaId: empresas.data![0]!.id }));
  }, [initial, s, form.empresaId, empresas.data]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);

    const qtd = Number(form.quantidadeAlvo.replace(/\./g, "").replace(",", "."));
    if (!form.empresaId) return setErro("Escolha o cliente.");
    if (!Number.isFinite(qtd) || qtd <= 0) return setErro("Informe quanto foi pedido.");
    if (form.unidadeAlvo === "M3" && !form.materialId) {
      return setErro("Pedido em m³ precisa do material: é a densidade dele que converte o peso em volume.");
    }
    if (form.prazoEm && form.prazoEm < form.inicioEm) {
      return setErro("O prazo não pode ser antes do início.");
    }

    const body: Body = {
      empresaId: form.empresaId,
      clienteId: form.clienteId ?? null,
      materialId: form.materialId || null,
      localCargaId: form.localCargaId ?? null,
      localDescargaId: form.localDescargaId ?? null,
      tipoServicoId: form.tipoServicoId || null,
      quantidadeAlvo: qtd,
      unidadeAlvo: form.unidadeAlvo,
      inicioEm: form.inicioEm,
      prazoEm: form.prazoEm || null,
      prioridade: form.prioridade,
      observacao: form.observacao.trim() || null,
    };

    try {
      if (initial) await update.mutateAsync({ id: initial.id, body });
      else await create.mutateAsync(body);
      router.push("/pedidos");
    } catch (e) {
      setErro((e as Error).message || "Não salvei. Confira os campos e tente de novo.");
    }
  }

  const saving = create.isPending || update.isPending;

  // Pedido em m³: a balança pesa em tonelada, e quem converte é a densidade do
  // material. Avisar AQUI, na hora de criar, poupa o supervisor de descobrir
  // depois que o saldo ficou "indisponível".
  const materialEscolhido = materiais.data?.find((m) => m.id === form.materialId);
  const densidade =
    materialEscolhido?.densidadeTonM3 != null ? Number(materialEscolhido.densidadeTonM3) : null;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        {s && (
          <div
            data-testid="aviso-leitura"
            className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"
          >
            <p>
              <span className="font-medium">Preenchido a partir {ROTULO_ORIGEM[s.origem]}.</span>{" "}
              Confira cada campo antes de salvar: em verde o que casou com o cadastro, em âmbar o
              que precisa de atenção. O que ficou vazio não foi encontrado.
            </p>
            {s.avisos.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-200">
                {s.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`space-y-2 ${destaque(s?.empresa)}`}>
            <Label htmlFor="pedidoform-empresa-que-pediu">Cliente que pediu</Label>
            <Select id="pedidoform-empresa-que-pediu"
              required
              value={form.empresaId}
              onChange={(e) => setForm({ ...form, empresaId: e.target.value, clienteId: undefined })}
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
            <Lido campo={s?.empresa} />
          </div>
          <div className={`space-y-2 ${destaque(s?.obra)}`}>
            <Label>Obra</Label>
            <ClienteCombobox
              value={form.clienteId}
              onChange={(v) => setForm({ ...form, clienteId: v })}
              triggerClassName="sm:w-full"
              initialOption={
                initial?.cliente
                  ? clienteOption(initial.cliente)
                  : s?.obra.valor && s.obra.nome
                    ? clienteOption({ id: s.obra.valor, nome: s.obra.nome })
                    : undefined
              }
            />
            <Lido campo={s?.obra} />
            <p className="text-xs text-muted-foreground">
              Deixe vazio se o pedido vale pra qualquer obra desse cliente.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className={`space-y-2 ${destaque(s?.quantidade)}`}>
            <Label htmlFor="pedidoform-quanto">Quanto</Label>
            <Input id="pedidoform-quanto"
              inputMode="decimal"
              placeholder="ex: 20"
              value={form.quantidadeAlvo}
              onChange={(e) => setForm({ ...form, quantidadeAlvo: e.target.value })}
            />
            <Lido campo={s?.quantidade} cadastro={false} />
          </div>
          <div className={`space-y-2 ${destaque(s?.unidade)}`}>
            <Label htmlFor="pedidoform-medido-em">Medido em</Label>
            <Select id="pedidoform-medido-em"
              value={form.unidadeAlvo}
              onChange={(e) =>
                setForm({ ...form, unidadeAlvo: e.target.value as UnidadePedidoTipo })
              }
            >
              {UNIDADES_PEDIDO.map((u) => (
                <option key={u} value={u}>
                  {UNIDADE_PEDIDO_LABEL[u]}
                </option>
              ))}
            </Select>
          </div>
          <div className={`space-y-2 ${destaque(s?.material)}`}>
            <Label htmlFor="pedidoform-material">Material</Label>
            <Select id="pedidoform-material"
              value={form.materialId}
              onChange={(e) => setForm({ ...form, materialId: e.target.value })}
            >
              <option value="">Qualquer material</option>
              {materiais.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Select>
            <Lido campo={s?.material} />
          </div>
        </div>

        {form.unidadeAlvo === "M3" &&
          (!form.materialId ? (
            <p className="text-xs text-amber-700">
              Pedido em m³ precisa do material: a balança pesa em tonelada, e é a densidade
              do material que converte o peso em volume.
            </p>
          ) : densidade == null ? (
            <p className="text-xs text-amber-700">
              {materialEscolhido?.nome ?? "Esse material"} ainda não tem densidade cadastrada.
              O pedido salva, mas o saldo fica indisponível até alguém cadastrar a densidade
              em{" "}
              <Link href={`/materiais/${form.materialId}`} className="underline">
                Materiais
              </Link>
              .
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              O saldo converte as toneladas das viagens pela densidade de{" "}
              {materialEscolhido?.nome}:{" "}
              {densidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} t/m³.
            </p>
          ))}

        <div className="grid gap-4 md:grid-cols-2">
          <div className={`space-y-2 ${destaque(s?.localCarga)}`}>
            <Label>Carrega em</Label>
            <LocalCombobox
              value={form.localCargaId}
              onChange={(v) => setForm({ ...form, localCargaId: v })}
              triggerClassName="sm:w-full"
              initialOption={localOption(initial?.localCarga ?? localSugerido(s?.localCarga))}
            />
            <Lido campo={s?.localCarga} />
          </div>
          <div className={`space-y-2 ${destaque(s?.localDescarga)}`}>
            <Label>Entrega em</Label>
            <LocalCombobox
              value={form.localDescargaId}
              onChange={(v) => setForm({ ...form, localDescargaId: v })}
              triggerClassName="sm:w-full"
              initialOption={localOption(initial?.localDescarga ?? localSugerido(s?.localDescarga))}
            />
            <Lido campo={s?.localDescarga} />
            <p className="text-xs text-muted-foreground">
              É o campo que mais ajuda o sistema a saber quais viagens abatem este pedido.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className={`space-y-2 ${destaque(s?.inicioEm)}`}>
            <Label htmlFor="pedido-inicio">Começa em</Label>
            <Input
              id="pedido-inicio"
              type="date"
              value={form.inicioEm}
              onChange={(e) => setForm({ ...form, inicioEm: e.target.value })}
            />
            <Lido campo={s?.inicioEm} cadastro={false} />
          </div>
          <div className={`space-y-2 ${destaque(s?.prazoEm)}`}>
            <Label htmlFor="pedido-prazo">Prazo</Label>
            <Input
              id="pedido-prazo"
              type="date"
              value={form.prazoEm}
              onChange={(e) => setForm({ ...form, prazoEm: e.target.value })}
            />
            <Lido campo={s?.prazoEm} cadastro={false} />
            <p className="text-xs text-muted-foreground">
              Vazio = sem prazo combinado. Com prazo, a tela calcula o ritmo por dia.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pedidoform-prioridade">Prioridade</Label>
            <Select id="pedidoform-prioridade"
              value={String(form.prioridade)}
              onChange={(e) => setForm({ ...form, prioridade: Number(e.target.value) })}
            >
              <option value="0">Normal</option>
              <option value="5">Alta</option>
              <option value="9">Urgente</option>
            </Select>
          </div>
        </div>

        <div className={`space-y-2 ${destaque(s?.observacao)}`}>
          <Label htmlFor="pedido-obs">Observação</Label>
          <Input
            id="pedido-obs"
            placeholder="o que mais importa saber sobre esse pedido"
            value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
          />
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <BarraDeAcao>
          <BotaoCancelar href="/pedidos" sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </BarraDeAcao>
      </form>
    </Card>
  );
}
