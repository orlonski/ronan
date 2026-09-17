"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, MessageSquare, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { telefoneDiscavel } from "@ronan/shared-types";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";

type Interacao = {
  id: string;
  canal: string;
  desfecho: string;
  resumo: string | null;
  autor: string | null;
  criadoEm: string;
};

type LeadDetalhe = {
  id: string;
  empresa: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  rntrc: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  socio: string | null;
  porte: string | null;
  capitalSocial: string | number | null;
  cnaeDescricao: string | null;
  situacaoCadastral: string | null;
  score: number | null;
  scoreMotivo: string | null;
  status: string;
  origem: string;
  origemDado: string | null;
  registradoEm: string | null;
  observacao: string | null;
  /** A conversa no Chatwoot, montada pela API. Nulo pra quem nunca escreveu. */
  chatwootUrl: string | null;
  interacoes: Interacao[];
};

const CANAIS = [
  { value: "LIGACAO", label: "Ligação" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EMAIL", label: "E-mail" },
  { value: "REUNIAO", label: "Reunião" },
  { value: "NOTA", label: "Anotação" },
];

const DESFECHOS = [
  { value: "RESPONDEU", label: "Falei com alguém" },
  { value: "SEM_RESPOSTA", label: "Não atendeu" },
  { value: "ENVIADO", label: "Deixei recado" },
  { value: "RECUSOU", label: "Não tem interesse" },
  { value: "PEDIU_OPT_OUT", label: "Pediu pra não contatar mais" },
];

const SITUACOES = [
  { value: "NOVO", label: "Novo" },
  { value: "EM_CONTATO", label: "Em contato" },
  { value: "QUALIFICADO", label: "Qualificado" },
  { value: "PROPOSTA", label: "Proposta enviada" },
  { value: "GANHOU", label: "Fechou" },
  { value: "PERDEU", label: "Perdeu" },
];

/** Mostra o número em que dá pra falar — com o nono dígito, quando falta. */
function telefoneBonito(t: string | null): string | null {
  if (!t) return null;
  const d = telefoneDiscavel(t) ?? t.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

/**
 * O telefone como se cola em outro lugar: DDD e número, sem parêntese, traço
 * nem DDI. É o formato que o WhatsApp, o discador e a busca de qualquer
 * sistema aceitam — o bonito é pra ler na tela, não pra colar.
 *
 * Passa pelo `telefoneDiscavel` porque a base da ANTT guarda celular sem o
 * nono dígito: copiar "4399360877" entrega um número que não acha ninguém.
 */
function soDigitos(t: string | null): string {
  return telefoneDiscavel(t ?? "") ?? (t ?? "").replace(/\D/g, "");
}

function cnpjBonito(c: string | null): string | null {
  if (!c) return null;
  const d = c.replace(/\D/g, "");
  if (d.length !== 14) return c;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function FichaLead({
  leadId,
  podeEditar,
  onFechar,
  onMudou,
}: {
  leadId: string;
  podeEditar: boolean;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const caminho = `/admin/prospeccao/leads/${leadId}`;

  const { data: lead, isLoading, refetch } = useApiQuery<LeadDetalhe>(caminho);

  const [canal, setCanal] = useState<string | undefined>("LIGACAO");
  const [desfecho, setDesfecho] = useState<string | undefined>();
  const [resumo, setResumo] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const registrar = useMutation({
    mutationFn: (body: { canal: string; desfecho: string; resumo?: string }) =>
      fetchApi(`${caminho}/interacoes`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      setDesfecho(undefined);
      setResumo("");
      void refetch();
      void qc.invalidateQueries({ queryKey: ["/admin/prospeccao/leads"] });
      onMudou();
    },
  });

  /**
   * Prepara a conversa no Chatwoot e leva pra lá.
   *
   * A aba é aberta ANTES da chamada, em branco: aberta depois, o navegador
   * entende como pop-up e engole — o clique já teria acontecido faz dois
   * segundos. A janela em branco vira a conversa quando a resposta chega.
   */
  const abrirConversa = useMutation({
    mutationFn: async () => {
      const aba = window.open("", "_blank");
      try {
        const r = await fetchApi<{ url: string }>(`${caminho}/chatwoot/conversa`, {
          method: "POST",
          body: JSON.stringify({}),
          token,
        });
        if (aba) aba.location.href = r.url;
        else window.open(r.url, "_blank", "noopener");
        return r;
      } catch (e) {
        aba?.close();
        throw e;
      }
    },
    onSuccess: () => void refetch(),
    onError: (e: Error) => toast.error("Não deu pra abrir a conversa", { description: e.message }),
  });

  const mudarSituacao = useMutation({
    mutationFn: (status: string) =>
      fetchApi(caminho, { method: "PATCH", body: JSON.stringify({ status }), token }),
    onSuccess: () => {
      void refetch();
      onMudou();
    },
  });

  const tel = telefoneBonito(lead?.telefone ?? null);
  const optOut = desfecho === "PEDIU_OPT_OUT";

  async function copiar(valor: string, oQue: string) {
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      // Contexto não-seguro (http sem TLS) não tem clipboard API.
      const el = document.createElement("textarea");
      el.value = valor;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopiado(valor);
    toast.success(`${oQue} copiado: ${valor}`);
    setTimeout(() => setCopiado((atual) => (atual === valor ? null : atual)), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Ficha do lead"
      onClick={onFechar}
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">{lead?.empresa ?? "…"}</h2>
            {lead?.nomeFantasia && (
              <p className="text-sm text-muted-foreground">{lead.nomeFantasia}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md border p-1.5 hover:bg-accent/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading || !lead ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Carregando…
          </Card>
        ) : (
          <div className="space-y-5">
            {tel && (
              <div className="flex flex-wrap gap-2">
                {/* Secundário à esquerda, principal à direita — padrão de botões. */}
                <button
                  type="button"
                  onClick={() => void copiar(soDigitos(lead.telefone), "Número")}
                  className="flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm font-medium hover:bg-accent/40"
                >
                  {copiado === soDigitos(lead.telefone) ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiado === soDigitos(lead.telefone) ? "Copiado" : "Copiar número"}
                </button>
                <a
                  href={`tel:+55${soDigitos(lead.telefone)}`}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
                >
                  <Phone className="h-4 w-4" />
                  Ligar para {tel}
                  {lead.socio ? ` — ${lead.socio.split(" ")[0]}` : ""}
                </a>
              </div>
            )}

            {lead.chatwootUrl ? (
              <a
                href={lead.chatwootUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent/40"
              >
                <MessageSquare className="h-4 w-4" />
                Abrir a conversa no WhatsApp
              </a>
            ) : (
              lead.telefone &&
              podeEditar && (
                <button
                  type="button"
                  disabled={abrirConversa.isPending}
                  onClick={() => abrirConversa.mutate()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent/40 disabled:opacity-50"
                >
                  {abrirConversa.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                  {abrirConversa.isPending ? "Preparando…" : "Falar no WhatsApp"}
                </button>
              )
            )}

            <Card className="divide-y text-sm">
              <Linha rotulo="CNPJ" valor={cnpjBonito(lead.cnpj)} mono copiar={copiar} copiado={copiado} />
              <Linha rotulo="RNTRC" valor={lead.rntrc} mono copiar={copiar} copiado={copiado} />
              <Linha
                rotulo="Cidade"
                valor={lead.municipio ? `${lead.municipio}${lead.uf ? `/${lead.uf}` : ""}` : null}
              />
              <Linha rotulo="Sócio" valor={lead.socio} />
              <Linha rotulo="Porte" valor={lead.porte} />
              <Linha rotulo="Ramo (CNAE)" valor={lead.cnaeDescricao} />
              <Linha rotulo="Situação na Receita" valor={lead.situacaoCadastral} />
              <Linha
                rotulo="RNTRC desde"
                valor={lead.registradoEm ? fmtDataHoraBR(lead.registradoEm).slice(0, 10) : null}
              />
              <Linha rotulo="E-mail" valor={lead.email} copiar={copiar} copiado={copiado} />
            </Card>

            <Card className="p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Nota {lead.score ?? "—"}
              </p>
              <p className="mt-1 text-sm leading-relaxed">{lead.scoreMotivo ?? "sem avaliação"}</p>
              {lead.origemDado && (
                <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Origem do dado: {lead.origemDado}
                </p>
              )}
            </Card>

            {podeEditar && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Situação</label>
                <Combobox
                  value={lead.status}
                  onChange={(v) => v && mudarSituacao.mutate(v)}
                  placeholder="Situação"
                  showSearch={false}
                  options={SITUACOES}
                />
              </div>
            )}

            {podeEditar && (
              <Card className="space-y-3 p-4">
                <p className="text-sm font-medium">Registrar contato</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Combobox
                    value={canal}
                    onChange={setCanal}
                    placeholder="Canal"
                    showSearch={false}
                    options={CANAIS}
                  />
                  <Combobox
                    value={desfecho}
                    onChange={setDesfecho}
                    placeholder="O que aconteceu"
                    showSearch={false}
                    options={DESFECHOS}
                  />
                </div>
                <textarea
                  value={resumo}
                  onChange={(e) => setResumo(e.target.value)}
                  rows={3}
                  placeholder="O que foi conversado"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />

                {optOut && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    Isso apaga essa empresa de todas as listas, em todos os canais, e o bloqueio
                    sobrevive à próxima importação. É pra sempre.
                  </p>
                )}

                <button
                  type="button"
                  disabled={!canal || !desfecho || registrar.isPending}
                  onClick={() =>
                    canal &&
                    desfecho &&
                    registrar.mutate({ canal, desfecho, resumo: resumo.trim() || undefined })
                  }
                  className={`w-full rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                    optOut ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {registrar.isPending
                    ? "Salvando…"
                    : optOut
                      ? "Registrar e nunca mais contatar"
                      : "Salvar contato"}
                </button>
              </Card>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">Histórico</p>
              {lead.interacoes.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">
                  Ninguém falou com essa empresa ainda.
                </Card>
              ) : (
                lead.interacoes.map((i) => (
                  <Card key={i.id} className="p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {CANAIS.find((c) => c.value === i.canal)?.label ?? i.canal}
                      </span>
                      <span>·</span>
                      <span>{DESFECHOS.find((d) => d.value === i.desfecho)?.label ?? i.desfecho}</span>
                      <span>·</span>
                      <span className="tabular-nums">{fmtDataHoraBR(i.criadoEm)}</span>
                      {i.autor && (
                        <>
                          <span>·</span>
                          <span>{i.autor}</span>
                        </>
                      )}
                    </div>
                    {i.resumo && <p className="mt-1 leading-relaxed">{i.resumo}</p>}
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Uma linha da ficha. Com `copiar`, ganha o botão — CNPJ, RNTRC e e-mail são
 * o que se cola em outro lugar (Receita, Google, e-mail), e digitar 14 dígitos
 * na mão é onde nasce o erro que faz a consulta não achar a empresa.
 */
function Linha({
  rotulo,
  valor,
  mono = false,
  copiar,
  copiado,
}: {
  rotulo: string;
  valor: string | null;
  mono?: boolean;
  copiar?: (valor: string, oQue: string) => void;
  copiado?: string | null;
}) {
  if (!valor) return null;
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5">
      <span className="w-40 shrink-0 text-muted-foreground">{rotulo}</span>
      <span className={mono ? "tabular-nums" : ""}>{valor}</span>
      {copiar && (
        <button
          type="button"
          onClick={() => copiar(valor, rotulo)}
          aria-label={`Copiar ${rotulo}`}
          title={`Copiar ${rotulo}`}
          className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-accent/40 hover:text-foreground focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          {copiado === valor ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
