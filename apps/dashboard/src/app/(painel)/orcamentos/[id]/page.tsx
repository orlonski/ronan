"use client";

import { use, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FileDown, MessageCircle, Pencil, Trash2, X } from "lucide-react";
import { BASE_PRECO_LABEL, STATUS_ORCAMENTO_LABEL, UNIDADE_PEDIDO_LABEL } from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingCard } from "@/components/loading";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchApi, useAuthToken, useResourceItem, useResourceOptions } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { hojeSP } from "@/lib/datetime-br";
import { STATUS_COR, brl, dataBR, num, type Orcamento } from "../_components/tipos";

const PATH = "/admin/orcamentos";

type ResultadoAprovar = Orcamento & {
  pedidosCriados: { id: string; numero: number }[];
  tabela: { itemId: string; resultado: string }[];
};

export default function OrcamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequerTela chave="orcamentos.ver">
      <Detalhe id={id} />
    </RequerTela>
  );
}

function Detalhe({ id }: { id: string }) {
  const token = useAuthToken();
  const router = useRouter();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const { confirmar, ConfirmDialog } = useConfirm();
  const item = useResourceItem<Orcamento>(PATH, id);
  const o = item.data;
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [painel, setPainel] = useState<"aprovar" | "recusar" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aprovado, setAprovado] = useState<ResultadoAprovar | null>(null);

  // Aprovação
  const [destino, setDestino] = useState<"cadastrar" | "existente">("cadastrar");
  const [empresaId, setEmpresaId] = useState("");
  const [usarPreco, setUsarPreco] = useState(false);
  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas", {
    enabled: painel === "aprovar" && !!o && !o.empresaId,
  });
  // Recusa
  const [motivo, setMotivo] = useState("");

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: [PATH] });
  }

  async function chamar<T>(caminho: string, body?: unknown): Promise<T | null> {
    setErro(null);
    setOcupado(true);
    try {
      return await fetchApi<T>(caminho, {
        method: "POST",
        token,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      setErro((e as Error).message);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function baixarPdf() {
    if (!token) return;
    setErro(null);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}${PATH}/${id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return setErro("Não consegui gerar o PDF do orçamento.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "orcamento.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Tira o link (vale 30 dias) — e a proposta passa a contar como enviada. */
  async function pegarLink() {
    const r = await chamar<{ url: string; telefone: string | null }>(`${PATH}/${id}/link`);
    if (r) await recarregar();
    return r;
  }

  async function copiarLink() {
    const r = await pegarLink();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.url);
      setAviso("Link copiado. Ele abre o PDF da proposta por 30 dias.");
    } catch {
      setAviso(`Link da proposta: ${r.url}`);
    }
  }

  async function mandarWhatsapp() {
    if (!o) return;
    // A aba abre ANTES do await: navegador bloqueia pop-up aberto depois de
    // uma chamada assíncrona.
    const aba = window.open("", "_blank");
    const r = await pegarLink();
    if (!r) {
      aba?.close();
      return;
    }
    const texto =
      `Olá! Segue o orçamento nº ${o.numero} que preparamos pra vocês` +
      ` (válido até ${dataBR(o.validadeEm)}): ${r.url}`;
    const digitos = (r.telefone ?? "").replace(/\D/g, "");
    const numero = digitos.length >= 10 && digitos.length <= 11 ? `55${digitos}` : digitos.length >= 12 ? digitos : "";
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
    if (aba) aba.location.href = url;
    else window.open(url, "_blank", "noopener");
  }

  async function aprovar() {
    if (!o) return;
    const body = {
      empresaId: !o.empresaId && destino === "existente" ? empresaId || null : null,
      cadastrarCliente: !o.empresaId && destino === "cadastrar",
      usarPrecoNaTabela: usarPreco,
    };
    if (!o.empresaId && destino === "existente" && !empresaId) return setErro("Escolha o cliente.");
    const r = await chamar<ResultadoAprovar>(`${PATH}/${id}/aprovar`, body);
    if (r) {
      setAprovado(r);
      setPainel(null);
      await qc.invalidateQueries({ queryKey: ["/admin/pedidos"] });
      await recarregar();
    }
  }

  async function recusar() {
    if (motivo.trim().length < 3) return setErro("Diga por que o cliente recusou.");
    const r = await chamar<Orcamento>(`${PATH}/${id}/recusar`, { motivo: motivo.trim() });
    if (r) {
      setPainel(null);
      await recarregar();
    }
  }

  async function apagar() {
    const ok = await confirmar({
      title: "Apagar este rascunho?",
      description: "Ele nunca foi mandado ao cliente, então some de vez.",
      confirmLabel: "Apagar rascunho",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await fetchApi(`${PATH}/${id}`, { method: "DELETE", token });
      await recarregar();
      router.push("/orcamentos" as Route);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (item.isLoading) return <LoadingCard />;
  if (!o) return <Card className="p-6 text-sm">Orçamento não encontrado.</Card>;

  const hoje = hojeSP();
  const venceu = o.validadeEm.slice(0, 10) < hoje;
  const editavel = o.status === "RASCUNHO" || o.status === "ENVIADO" || o.status === "VENCIDO";
  const aprovavel = (o.status === "RASCUNHO" || o.status === "ENVIADO") && !venceu;
  const podeTabela = temPermissao("tabelas-preco.criar");

  return (
    <div className="space-y-6">
      <ConfirmDialog />
      <FormPageHeader
        title={`Orçamento #${o.numero}`}
        description={`Para ${o.destinatario}${o.empresaId ? "" : " (ainda não é cliente)"}`}
        backHref="/orcamentos"
      />

      {erro && <Card className="border-l-4 border-l-red-500 p-4 text-sm">{erro}</Card>}
      {aviso && (
        <Card className="border-l-4 border-l-blue-500 p-4 text-sm" data-testid="orcamento-aviso">
          {aviso}
        </Card>
      )}

      {aprovado && (
        <Card className="space-y-2 border-l-4 border-l-emerald-500 p-4 text-sm" data-testid="orcamento-aprovado">
          <p className="font-medium">
            Aprovado. {aprovado.pedidosCriados.length === 1 ? "Pedido criado" : "Pedidos criados"}:{" "}
            {aprovado.pedidosCriados.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link href={`/pedidos/${p.id}` as Route} className="underline">
                  #{p.numero}
                </Link>
              </span>
            ))}
          </p>
          {aprovado.tabela.length > 0 && (
            <ul className="list-disc pl-5 text-muted-foreground">
              {aprovado.tabela.map((t) => (
                <li key={t.itemId}>{t.resultado}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <Badge className={`border-transparent ${STATUS_COR[o.status]}`}>{STATUS_ORCAMENTO_LABEL[o.status]}</Badge>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total estimado</p>
            <p className="text-3xl font-bold tabular-nums" data-testid="orcamento-total">
              {brl(o.total)}
            </p>
            {o.itensSemValor > 0 && (
              <p className="text-xs text-amber-700">
                {o.itensSemValor} {o.itensSemValor === 1 ? "item fica" : "itens ficam"} fora do total (ver abaixo).
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Vale até {dataBR(o.validadeEm)}
              {o.enviadoEm && ` · enviado em ${dataBR(o.enviadoEm)}`}
              {o.aprovadoEm && ` · aprovado em ${dataBR(o.aprovadoEm)}`}
              {o.recusadoEm && ` · recusado em ${dataBR(o.recusadoEm)}`}
            </p>
            {o.motivoRecusa && <p className="text-sm">Motivo da recusa: {o.motivoRecusa}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void baixarPdf()}>
              <FileDown className="h-4 w-4" /> Baixar PDF
            </Button>
            {aprovavel && (
              <Permitido chave="orcamentos.editar">
                <Button onClick={() => void copiarLink()} disabled={ocupado}>
                  <Copy className="h-4 w-4" /> Copiar link
                </Button>
                <Button onClick={() => void mandarWhatsapp()} disabled={ocupado}>
                  <MessageCircle className="h-4 w-4" /> Mandar no WhatsApp
                </Button>
              </Permitido>
            )}
            {editavel && (
              <Permitido chave="orcamentos.editar">
                <Link href={`/orcamentos/${o.id}/editar` as Route}>
                  <Button variant="outline">
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                </Link>
              </Permitido>
            )}
          </div>
        </div>
        {venceu && (o.status === "RASCUNHO" || o.status === "ENVIADO" || o.status === "VENCIDO") && (
          <p className="mt-3 text-sm text-amber-700">
            A validade passou. Edite e coloque uma data nova pra mandar ou aprovar.
          </p>
        )}
      </Card>

      <Card className="divide-y p-0">
        {o.itens.map((it, i) => (
          <div key={it.id} className="flex flex-wrap items-start justify-between gap-3 p-4" data-testid="orcamento-item">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {i + 1}. {it.material?.nome ?? it.descricao ?? "Transporte"}
                {it.tipoServico && <span className="text-muted-foreground"> · {it.tipoServico.nome}</span>}
              </p>
              {it.material && it.descricao && <p className="text-sm text-muted-foreground">{it.descricao}</p>}
              {(it.localCarga || it.localDescarga) && (
                <p className="text-sm text-muted-foreground">
                  {it.localCarga?.nome ?? "?"} → {it.localDescarga?.nome ?? "?"}
                  {it.kmEstimado && ` · ${num(it.kmEstimado, 1)} km`}
                </p>
              )}
              <p className="text-sm tabular-nums">
                {num(it.quantidade)} {UNIDADE_PEDIDO_LABEL[it.unidade]} × {brl(it.precoUnitario)}{" "}
                <span className="text-muted-foreground">{BASE_PRECO_LABEL[it.base].unidade}</span>
              </p>
              {it.pedido && (
                <p className="text-sm">
                  Virou o{" "}
                  <Link href={`/pedidos/${it.pedido.id}` as Route} className="underline">
                    pedido #{it.pedido.numero}
                  </Link>
                  {it.tabelaPrecoCriadaId && " · preço levado pra tabela do cliente"}
                </p>
              )}
            </div>
            <div className="text-right">
              {it.valor ? (
                <p className="font-semibold tabular-nums">{brl(it.valor)}</p>
              ) : (
                <p className="max-w-[240px] text-xs text-amber-700">Fora do total: {it.semValorMotivo}</p>
              )}
            </div>
          </div>
        ))}
      </Card>

      {(o.condicoes || o.inicioPrevistoEm || o.prazoEm) && (
        <Card className="space-y-1 p-5 text-sm">
          {(o.inicioPrevistoEm || o.prazoEm) && (
            <p>
              Prazo: {o.inicioPrevistoEm && `início em ${dataBR(o.inicioPrevistoEm)}`}
              {o.inicioPrevistoEm && o.prazoEm && ", "}
              {o.prazoEm && `concluir até ${dataBR(o.prazoEm)}`}
            </p>
          )}
          {o.condicoes && <p className="whitespace-pre-line text-muted-foreground">{o.condicoes}</p>}
        </Card>
      )}

      {/* Resposta do cliente. Painéis inline, não modal: é a decisão principal
          da tela e merece o espaço dela. */}
      {(aprovavel || o.status === "VENCIDO" || o.status === "RASCUNHO") && (
        <Permitido chave="orcamentos.editar">
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold">O cliente respondeu?</h2>
            {painel === null && (
              <div className="flex flex-wrap gap-2">
                {aprovavel && temPermissao("pedidos.criar") && (
                  <Button variant="success" onClick={() => setPainel("aprovar")}>
                    <Check className="h-4 w-4" /> Aprovar e criar pedido
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setPainel("recusar")}>
                  <X className="h-4 w-4" /> Cliente recusou
                </Button>
                {o.status === "RASCUNHO" && (
                  <Button variant="outline" onClick={() => void apagar()}>
                    <Trash2 className="h-4 w-4" /> Apagar rascunho
                  </Button>
                )}
              </div>
            )}

            {painel === "aprovar" && (
              <div className="space-y-4" data-testid="painel-aprovar">
                <p className="text-sm text-muted-foreground">
                  Cada item vira um pedido do cliente, com a quantidade, o material, a rota e o prazo da proposta.
                </p>
                {!o.empresaId && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{o.prospectNome} ainda não é cliente. Quem paga os pedidos?</p>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" checked={destino === "cadastrar"} onChange={() => setDestino("cadastrar")} />
                      Cadastrar “{o.prospectNome}” como cliente agora
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" checked={destino === "existente"} onChange={() => setDestino("existente")} />
                      É um cliente que já está cadastrado
                    </label>
                    {destino === "existente" && (
                      <div className="max-w-sm space-y-1">
                        <Label htmlFor="aprovar-empresa">Cliente</Label>
                        <Select id="aprovar-empresa" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                          <option value="" disabled>
                            Escolha o cliente
                          </option>
                          {empresas.data?.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.nome}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </div>
                )}
                {podeTabela && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={usarPreco}
                      onChange={(e) => setUsarPreco(e.target.checked)}
                      data-testid="usar-preco-tabela"
                    />
                    <span>
                      Usar este preço na tabela do cliente a partir de hoje
                      <span className="block text-xs text-muted-foreground">
                        Cria um preço novo, valendo de hoje em diante. O preço antigo continua valendo pras viagens
                        que já rodaram.
                      </span>
                    </span>
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setPainel(null)}>
                    Voltar
                  </Button>
                  <Button variant="success" onClick={() => void aprovar()} disabled={ocupado}>
                    <Check className="h-4 w-4" /> Aprovar e criar {o.itens.length === 1 ? "o pedido" : `${o.itens.length} pedidos`}
                  </Button>
                </div>
              </div>
            )}

            {painel === "recusar" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="motivo-recusa">Por que o cliente recusou?</Label>
                  <Textarea
                    id="motivo-recusa"
                    rows={2}
                    placeholder="ex.: achou caro; fechou com outro; obra adiada"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setPainel(null)}>
                    Voltar
                  </Button>
                  <Button variant="destructive" onClick={() => void recusar()} disabled={ocupado}>
                    <X className="h-4 w-4" /> Marcar como recusado
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </Permitido>
      )}
    </div>
  );
}
