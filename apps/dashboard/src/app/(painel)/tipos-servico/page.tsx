"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Lock, Pencil, Plus, Star, Timer } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableColumnHeader, DataTableToolbar } from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";
import { EstadoVazio } from "@/components/estado-vazio";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import type { TipoServico } from "./_components/tipo-servico-form";
import { AbasDaTela } from "@/components/abas-da-tela";

const PATH = "/admin/tipos-servico";
const PATH_MINHA_EMPRESA = "/admin/minha-empresa";

type Flag = "exigeMaterial" | "exigeTicket" | "exigeLocalDescarga" | "exigeKm" | "mostraPedagio";

/**
 * O que o app SEMPRE pede, e por quê. Não é configurável de propósito: sem
 * qualquer um destes a viagem não casa com a planilha, não sabe de quem cobrar
 * ou não tem de onde tirar o km. Mostrar travado (com o motivo) evita a pergunta
 * "por que não dá pra desligar a placa?".
 */
const SEMPRE: { titulo: string; porque: string }[] = [
  { titulo: "Placa", porque: "é por ela que a viagem casa com a planilha do cliente" },
  { titulo: "Data", porque: "é o dia em que a viagem entra no fechamento" },
  { titulo: "Obra (cliente)", porque: "é ela que diz de quem cobrar" },
  { titulo: "Local de carga", porque: "de onde sai o km e o remetente do CT-e" },
  {
    titulo: "Peso",
    porque: "toda viagem é por peso — se o romaneio só sai no fim do dia, o motorista completa depois",
  },
];

/** O que a empresa liga e desliga, na ordem em que o app pergunta. */
const ESCOLHAS: { flag: Flag; titulo: string; hint: string }[] = [
  {
    flag: "exigeMaterial",
    titulo: "Material",
    hint: "Desligado, o app não pergunta o que o caminhão levou.",
  },
  {
    flag: "exigeTicket",
    titulo: "Número do ticket",
    hint: "Desligado, o app não pede o número do ticket de balança (nem a foto dele).",
  },
  {
    flag: "exigeLocalDescarga",
    titulo: "Local de descarga",
    hint: "Desligue quando a viagem começa e termina no mesmo lugar.",
  },
  {
    flag: "exigeKm",
    titulo: "Km rodado",
    hint: "Desligado, o motorista pode lançar sem informar o km.",
  },
  {
    flag: "mostraPedagio",
    titulo: "Mostrar o pedágio",
    hint: "Desligado, o app esconde o campo de pedágio e não avisa quando a rota passa por um.",
  },
];

export default function TiposServicoPage() {
  return (
    <div className="space-y-6">
      <AbasDaTela grupo="viagens" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Campos da viagem no app</h1>
        <p className="text-sm text-muted-foreground">
          O que o app pergunta ao motorista quando ele lança ou finaliza uma viagem.
        </p>
      </header>

      <OQueOAppPede />
      <TiposAvancado />
    </div>
  );
}

/**
 * O card de cima: edita o tipo PADRÃO da conta como se fosse "a" configuração
 * — que é o que ela é pra toda empresa com um tipo só (todas, hoje). Quem tem
 * mais de um mexe nos outros lá embaixo, no avançado.
 */
function OQueOAppPede() {
  const { temPermissao } = usePermissoes();
  const tipos = useResourceOptions<TipoServico>(PATH);
  const update = useUpdateResource<Partial<Record<Flag, boolean>>, TipoServico>(PATH, PATH);
  const criar = useCriarFretePadrao();

  const ativos = useMemo(() => (tipos.data ?? []).filter((t) => t.ativo), [tipos.data]);
  // O padrão; sem padrão, o primeiro ativo (base antiga que não passou pelo
  // backfill). Nenhum → oferece criar.
  const alvo = useMemo(
    () => (tipos.data ?? []).find((t) => t.padrao) ?? ativos[0] ?? null,
    [tipos.data, ativos],
  );
  const podeEditar = temPermissao("tipos-servico.editar");
  const token = useAuthToken();

  async function mudar(flag: Flag, valor: boolean) {
    if (!alvo) return;
    try {
      // Sem padrão, o app e a API caem no clássico (tudo exigido) — mexer nas
      // flags de um tipo que não é o padrão não mudaria nada pro motorista.
      // Então o tipo editado aqui vira o padrão primeiro.
      if (!alvo.padrao) await fetchApi(`${PATH}/${alvo.id}/padrao`, { method: "POST", token });
      await update.mutateAsync({ id: alvo.id, body: { [flag]: valor } });
      toast.success("Salvo. O app pega a mudança na próxima vez que abrir.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-1">
        <p className="text-base font-semibold">O que o app pede na viagem</p>
        <p className="text-sm text-muted-foreground">
          Vale pra “Lançar viagem feita” e pra “Começar viagem”.
          {alvo && ativos.length > 1 ? (
            <>
              {" "}
              Estes são os campos do tipo <strong>{alvo.nome}</strong>, o padrão — os outros
              tipos se ajustam em “Tipos de viagem”, lá embaixo.
            </>
          ) : null}
          {alvo && !alvo.padrao ? (
            <>
              {" "}
              Nenhum tipo está marcado como padrão: ao mexer aqui, <strong>{alvo.nome}</strong>{" "}
              passa a ser o padrão.
            </>
          ) : null}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sempre pede
        </p>
        <ul className="divide-y rounded-md border">
          {SEMPRE.map((c) => (
            <li key={c.titulo} className="flex items-start gap-3 px-4 py-2.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm">
                <span className="font-medium">{c.titulo}</span>
                <span className="text-muted-foreground"> — {c.porque}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Você escolhe
        </p>
        {tipos.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !alvo ? (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              Sua conta ainda não tem o jeito de lançar viagem configurado — o app está
              pedindo tudo. Crie o “Frete por tonelada” pra poder escolher o que ele pede.
            </p>
            {temPermissao("tipos-servico.criar") && podeEditar ? (
              <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
                <Plus className="h-4 w-4" /> Criar “Frete por tonelada”
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {ESCOLHAS.map((e) => (
              <li key={e.flag} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{e.titulo}</p>
                  <p className="text-xs text-muted-foreground">{e.hint}</p>
                </div>
                <StatusToggle
                  active={alvo[e.flag] ?? true}
                  onChange={(next) => void mudar(e.flag, next)}
                  size="sm"
                  disabled={!podeEditar || update.isPending}
                />
              </li>
            ))}
            <FotoDoTicket ticketLigado={alvo.exigeTicket} />
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Alguns materiais dispensam ticket ou permitem bota-fora — isso é do material, e se
        ajusta em{" "}
        <Link href="/materiais" className="font-medium text-primary hover:underline">
          Materiais
        </Link>
        .
      </p>
    </Card>
  );
}

/**
 * "Foto do ticket na viagem" — `Conta.exigeFotoViagem`. Continua no MESMO
 * campo e endpoint de Minha empresa; só mudou de tela, pra ficar junto do resto
 * do que o app pede na viagem. O endpoint é gatado por `minha-empresa.editar`,
 * então quem não tem essa permissão nem vê a linha (não daria pra ler o valor).
 */
function FotoDoTicket({ ticketLigado }: { ticketLigado: boolean }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const pode = temPermissao("minha-empresa.editar");

  const config = useQuery({
    queryKey: [PATH_MINHA_EMPRESA],
    enabled: !!token && pode,
    queryFn: () => fetchApi<{ exigeFotoViagem: boolean }>(PATH_MINHA_EMPRESA, { token }),
  });
  const salvar = useMutation({
    mutationFn: (exigeFotoViagem: boolean) =>
      fetchApi(PATH_MINHA_EMPRESA, {
        method: "PATCH",
        token,
        body: JSON.stringify({ exigeFotoViagem }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [PATH_MINHA_EMPRESA] });
      toast.success("Regra salva.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui salvar."),
  });

  if (!pode) return null;

  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="space-y-0.5">
        <p className={cn("text-sm font-medium", !ticketLigado && "text-muted-foreground")}>
          Foto do ticket
        </p>
        <p className="text-xs text-muted-foreground">
          {ticketLigado
            ? "Ligado, o app não deixa salvar sem a foto. Se o motorista não conseguir fotografar, escreve o motivo e a viagem chega marcada como “sem foto”, pra você cobrar. Material que não gera comprovante (ex.: concreto) fica de fora sozinho."
            : "Sem o número do ticket, o app também não pede a foto dele."}
        </p>
      </div>
      <StatusToggle
        active={config.data?.exigeFotoViagem ?? false}
        onChange={(next) => salvar.mutate(next)}
        size="sm"
        disabled={config.isLoading || salvar.isPending}
      />
    </li>
  );
}

/**
 * Conta sem nenhum tipo cadastrado: cria o "Frete por tonelada" (tudo ligado =
 * o que o app já pede hoje, nada muda pro motorista) e marca como padrão.
 */
function useCriarFretePadrao() {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const novo = await fetchApi<TipoServico>(PATH, {
        method: "POST",
        token,
        body: JSON.stringify({ nome: "Frete por tonelada" }),
      });
      await fetchApi(`${PATH}/${novo.id}/padrao`, { method: "POST", token });
      return novo;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [PATH] });
      toast.success("Pronto. Agora é só escolher o que o app pede.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui criar."),
  });
}

/**
 * Mais de um jeito de lançar viagem na mesma conta. Com dois ou mais ativos, o
 * app pergunta ao motorista qual é — por isso fica fechado: quem tem um só
 * (todo mundo, hoje) não precisa nem ver.
 */
function TiposAvancado() {
  const [aberto, setAberto] = useState(false);
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div>
          <p className="text-sm font-semibold">Tipos de viagem (avançado)</p>
          <p className="text-xs text-muted-foreground">
            Pra quando o motorista precisa escolher entre jeitos diferentes de lançar. Com
            mais de um ativo, o app pergunta qual é.
          </p>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", aberto && "rotate-180")}
        />
      </button>
      {aberto ? (
        <div className="border-t p-5">
          <ListaTipos />
        </div>
      ) : null}
    </Card>
  );
}

function ListaTipos() {
  const { temPermissao } = usePermissoes();
  const tableState = useDataTableState({ defaultSort: { field: "ordem", order: "asc" } });
  const list = usePaginatedList<TipoServico>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, TipoServico>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("tipos-servico");
  const token = useAuthToken();
  const qc = useQueryClient();

  const tornarPadrao = useMutation({
    mutationFn: (id: string) => fetchApi(`${PATH}/${id}/padrao`, { method: "POST", token }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [PATH] });
      toast.success("Padrão trocado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui trocar."),
  });

  const columns = useMemo<ColumnDef<TipoServico>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.nome}</span>
            {row.original.padrao && <SeloPadrao />}
          </div>
        ),
      },
      {
        id: "exige",
        enableSorting: false,
        header: "Pede ao motorista",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{resumoCampos(row.original)}</span>
        ),
      },
      {
        id: "ordem",
        accessorKey: "ordem",
        size: 80,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ordem" />,
        cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.ordem}</span>,
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 128,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Permitido chave="tipos-servico.editar">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) => update.mutate({ id: row.original.id, body: { ativo: next } })}
              size="sm"
              label
              // O padrão é o chão de toda viagem sem tipo — desativar quebraria
              // o histórico. O backend recusa; aqui a gente nem oferece.
              disabled={row.original.padrao}
            />
          </Permitido>
        ),
      },
      {
        id: "acoes",
        size: 150,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <AcoesTipo
            t={row.original}
            aoTornarPadrao={() => tornarPadrao.mutate(row.original.id)}
            ocupado={tornarPadrao.isPending}
          />
        ),
      },
    ],
    [update, tornarPadrao],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
        <Permitido chave="tipos-servico.criar">
          <Link href="/tipos-servico/novo">
            <Button>
              <Plus className="h-4 w-4" /> Novo tipo
            </Button>
          </Link>
        </Permitido>
      </div>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar tipo de viagem…"
            filters={
              <Combobox
                value={tableState.filters.ativo}
                onChange={(v) => tableState.setFilter("ativo", v)}
                placeholder="Status"
                showSearch={false}
                options={[
                  { value: "true", label: "Ativos" },
                  { value: "false", label: "Inativos" },
                ]}
              />
            }
          />
        }
        emptyMessage={
          <EstadoVazio
            icone={Timer}
            titulo="Nenhum tipo de viagem cadastrado"
            descricao="Com um tipo só, o app nem pergunta qual é."
            acaoHref="/tipos-servico/novo"
            acaoLabel="Criar tipo de viagem"
            perm="tipos-servico.criar"
            temPermissao={temPermissao}
          />
        }
        viewMode={viewMode}
        renderMobileCard={(t) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">{t.nome}</span>
                  {t.padrao && <SeloPadrao />}
                </div>
                <p className="text-xs text-muted-foreground">{resumoCampos(t)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="tipos-servico.editar">
                  <StatusToggle
                    active={t.ativo}
                    onChange={(next) => update.mutate({ id: t.id, body: { ativo: next } })}
                    size="sm"
                    disabled={t.padrao}
                  />
                </Permitido>
                <AcoesTipo
                  t={t}
                  aoTornarPadrao={() => tornarPadrao.mutate(t.id)}
                  ocupado={tornarPadrao.isPending}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}

function AcoesTipo({
  t,
  aoTornarPadrao,
  ocupado,
}: {
  t: TipoServico;
  aoTornarPadrao: () => void;
  ocupado: boolean;
}) {
  return (
    <div className="flex justify-center">
      {!t.padrao && t.ativo ? (
        <Permitido chave="tipos-servico.editar">
          <Button
            variant="ghost"
            size="icon"
            title="Tornar padrão"
            onClick={aoTornarPadrao}
            disabled={ocupado}
          >
            <Star className="h-4 w-4" />
          </Button>
        </Permitido>
      ) : null}
      <Permitido chave="tipos-servico.editar">
        <Link href={`/tipos-servico/${t.id}`}>
          <Button variant="ghost" size="icon" title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        </Link>
      </Permitido>
      {!t.padrao && (
        <ExcluirButton
          perm="tipos-servico.excluir"
          path={PATH}
          id={t.id}
          nomeRecurso={`o tipo de viagem "${t.nome}"`}
        />
      )}
    </div>
  );
}

function SeloPadrao() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
      title="É o que vale pras viagens que não escolhem nenhum tipo."
    >
      <Star className="h-3 w-3" /> padrão
    </span>
  );
}

function resumoCampos(t: TipoServico): string {
  return [
    "peso",
    t.exigeMaterial && "material",
    t.exigeTicket && "ticket",
    t.exigeLocalDescarga && "descarga",
    t.exigeKm && "km",
    (t.mostraPedagio ?? true) && "pedágio",
  ]
    .filter(Boolean)
    .join(" · ");
}
