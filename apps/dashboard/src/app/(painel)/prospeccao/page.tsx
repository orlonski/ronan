"use client";

import { useState } from "react";
import {
  Building2,
  Download,
  Loader2,
  Phone,
  PhoneOff,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DataTableToolbar } from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { usePaginatedList, useApiQuery } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { FichaLead } from "./_components/ficha-lead";
import { AcoesBase } from "./_components/acoes-base";

export type Lead = {
  id: string;
  empresa: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  socio: string | null;
  porte: string | null;
  cnaeDescricao: string | null;
  score: number | null;
  scoreMotivo: string | null;
  status: string;
  origem: string;
  registradoEm: string | null;
  ultimoContato: string | null;
  enriquecidoEm: string | null;
  _count?: { interacoes: number };
};

export type Resumo = {
  total: number;
  comTelefone: number;
  comEmail: number;
  porStatus: { status: string; total: number }[];
  porUf: { uf: string; total: number }[];
  suprimidos: number;
};

const STATUS_LABEL: Record<string, string> = {
  NOVO: "Novo",
  EM_CONTATO: "Em contato",
  QUALIFICADO: "Qualificado",
  PROPOSTA: "Proposta enviada",
  GANHOU: "Fechou",
  PERDEU: "Perdeu",
};

export default function ProspeccaoPage() {
  const { temPermissao } = usePermissoes();
  const [uf, setUf] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [contato, setContato] = useState<string | undefined>("true");
  const [scoreMinimo, setScoreMinimo] = useState<string | undefined>();
  const [aberto, setAberto] = useState<string | null>(null);

  const tableState = useDataTableState({ defaultSort: { field: "score", order: "desc" } });

  const resumo = useApiQuery<Resumo>("/admin/prospeccao/resumo");

  const lista = usePaginatedList<Lead>("/admin/prospeccao/leads", {
    ...tableState,
    filters: {
      ...tableState.filters,
      ...(uf ? { uf } : {}),
      ...(status ? { status } : {}),
      ...(contato ? { comContato: contato } : {}),
      ...(scoreMinimo ? { scoreMinimo } : {}),
    },
  });

  const leads = lista.data?.data ?? [];
  const podeEditar = temPermissao("prospeccao.editar");

  function recarregar() {
    void lista.refetch();
    void resumo.refetch();
  }

  const total = resumo.data?.total ?? 0;
  const comTelefone = resumo.data?.comTelefone ?? 0;
  const semContato = Math.max(total - comTelefone, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Captação de clientes</h1>
        <p className="text-sm text-muted-foreground">
          Transportadoras do registro público da ANTT, com nota por aderência ao que o Movatruck
          resolve. Ligue para as de cima.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica titulo="Na base" valor={total.toLocaleString("pt-BR")} icone={<Building2 className="h-4 w-4" />} />
        <Metrica
          titulo="Com telefone"
          valor={comTelefone.toLocaleString("pt-BR")}
          icone={<Phone className="h-4 w-4" />}
          rodape={total > 0 ? percentualDaBase(comTelefone, total) : undefined}
        />
        <Metrica
          titulo="Falta enriquecer"
          valor={semContato.toLocaleString("pt-BR")}
          icone={<Download className="h-4 w-4" />}
          rodape={semContato > 0 ? "Sem contato não dá pra trabalhar" : "Tudo com contato"}
        />
        <Metrica
          titulo="Pediram pra não contatar"
          valor={(resumo.data?.suprimidos ?? 0).toLocaleString("pt-BR")}
          icone={<PhoneOff className="h-4 w-4" />}
          rodape="Some de toda lista, em todo canal"
        />
      </div>

      {temPermissao("prospeccao.importar") && <AcoesBase onPronto={recarregar} />}

      <div className="space-y-3">
        <DataTableToolbar
          state={tableState}
          searchPlaceholder="Buscar empresa, cidade, CNPJ ou sócio…"
          filters={
            <>
              <Combobox
                value={contato}
                onChange={setContato}
                placeholder="Contato"
                showSearch={false}
                options={[
                  { value: "true", label: "Só com telefone" },
                  { value: "false", label: "Só sem contato" },
                ]}
              />
              <Combobox
                value={scoreMinimo}
                onChange={setScoreMinimo}
                placeholder="Nota mínima"
                showSearch={false}
                options={[
                  { value: "90", label: "90 ou mais" },
                  { value: "75", label: "75 ou mais" },
                  { value: "60", label: "60 ou mais" },
                ]}
              />
              <Combobox
                value={status}
                onChange={setStatus}
                placeholder="Situação"
                showSearch={false}
                options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <Combobox
                value={uf}
                onChange={setUf}
                placeholder="UF"
                showSearch={false}
                options={(resumo.data?.porUf ?? []).map((u) => ({
                  value: u.uf,
                  label: `${u.uf} (${u.total.toLocaleString("pt-BR")})`,
                }))}
              />
              <button
                type="button"
                onClick={recarregar}
                className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent/30"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${lista.isFetching ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </>
          }
        />

        {lista.isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Carregando…
          </Card>
        ) : leads.length === 0 ? (
          <Card className="p-8 text-center">
            <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhum lead com esses filtros</p>
            <p className="text-sm text-muted-foreground">
              {semContato > 0
                ? "Tente “Só sem contato” — ou rode o enriquecimento para achar os telefones."
                : "Importe o RNTRC para montar a base."}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {leads.map((l) => (
              <LinhaLead key={l.id} lead={l} onAbrir={() => setAberto(l.id)} />
            ))}
          </div>
        )}
      </div>

      {aberto && (
        <FichaLead
          leadId={aberto}
          podeEditar={podeEditar}
          onFechar={() => setAberto(null)}
          onMudou={recarregar}
        />
      )}
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  icone,
  rodape,
}: {
  titulo: string;
  valor: string | number;
  icone?: React.ReactNode;
  rodape?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{titulo}</span>
        {icone}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {rodape && <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{rodape}</p>}
    </Card>
  );
}

/**
 * "0% da base" com 49 de 24 mil é tecnicamente verdade e visualmente idiota:
 * parece que nada foi encontrado. Abaixo de 1% a gente escreve por extenso.
 */
function percentualDaBase(parte: number, total: number): string {
  const pct = (parte / total) * 100;
  if (parte === 0) return "nenhum ainda";
  if (pct < 1) return "menos de 1% da base";
  return `${Math.round(pct)}% da base`;
}

/** (42) 3535-3078 — a maioria é fixo, que a Receita entrega com 10 dígitos. */
function telefoneBonito(t: string | null): string | null {
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

function corDaNota(score: number | null): string {
  if (score == null) return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  if (score >= 90) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (score >= 75) return "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300";
  if (score >= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function LinhaLead({ lead, onAbrir }: { lead: Lead; onAbrir: () => void }) {
  const tel = telefoneBonito(lead.telefone);
  const toques = lead._count?.interacoes ?? 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-accent/30"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums ${corDaNota(lead.score)}`}
        title={lead.scoreMotivo ?? undefined}
      >
        {lead.score ?? "—"}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{lead.empresa}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {lead.municipio && (
            <span>
              {lead.municipio}
              {lead.uf ? `/${lead.uf}` : ""}
            </span>
          )}
          {lead.porte && (
            <>
              <span>·</span>
              <span>{lead.porte.toLowerCase()}</span>
            </>
          )}
          {lead.socio && (
            <>
              <span>·</span>
              <span className="truncate">falar com {lead.socio.split(" ")[0]}</span>
            </>
          )}
          {toques > 0 && (
            <>
              <span>·</span>
              <span>
                {toques} contato{toques > 1 ? "s" : ""}
              </span>
            </>
          )}
          {!lead.enriquecidoEm && (
            <>
              <span>·</span>
              <span className="text-amber-700 dark:text-amber-500">sem dados da Receita</span>
            </>
          )}
        </div>
      </div>

      {tel ? (
        <a
          href={`tel:+55${lead.telefone}`}
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm tabular-nums hover:bg-accent/50"
        >
          <Phone className="h-3.5 w-3.5" />
          {tel}
        </a>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          sem telefone
        </span>
      )}
    </Card>
  );
}
