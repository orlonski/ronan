"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Camera, TriangleAlert } from "lucide-react";
import { AbasDaTela } from "@/components/abas-da-tela";
import { RequerTela } from "@/components/requer-tela";
import { MotoristaCombobox, VeiculoCombobox } from "@/components/fk-comboboxes";
import { VisualizadorFotos } from "@/components/visualizador-fotos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";
import { usePageTitle } from "@/lib/cabecalho";
import { cn } from "@/lib/utils";
import { brl, diaHora, IconeTipo, rotuloStatus, textoDoPonto, type GastoPainel, type TipoDespesaPainel } from "../_components/comum";

/**
 * Gastos de viagem › Todos: o histórico inteiro, com filtros. Só leitura —
 * decidir é na aba Conferir (outra permissão).
 */
export default function TodosGastosPage() {
  return (
    <RequerTela chave="despesas.ver">
      <Todos />
    </RequerTela>
  );
}

type Pagina = {
  data: GastoPainel[];
  total: number;
  page: number;
  pageSize: number;
  totalInformado: string;
  totalAprovado: string;
};

function Todos() {
  usePageTitle("Gastos de viagem");
  const token = useAuthToken();
  const [motoristaId, setMotoristaId] = React.useState<string | undefined>();
  const [veiculoId, setVeiculoId] = React.useState<string | undefined>();
  const [tipoId, setTipoId] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [cobrar, setCobrar] = React.useState("");
  const [de, setDe] = React.useState(primeiroDiaDoMesSP());
  const [ate, setAte] = React.useState(ultimoDiaDoMesSP());
  const [page, setPage] = React.useState(1);
  const [foto, setFoto] = React.useState<{ g: GastoPainel; i: number } | null>(null);

  const qs = React.useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (motoristaId) p.set("motoristaId", motoristaId);
    if (veiculoId) p.set("veiculoId", veiculoId);
    if (tipoId) p.set("tipoDespesaId", tipoId);
    if (status) p.set("status", status);
    if (cobrar) p.set("podeCobrarCliente", cobrar);
    if (de) p.set("de", de);
    if (ate) p.set("ate", ate);
    return p.toString();
  }, [motoristaId, veiculoId, tipoId, status, cobrar, de, ate, page]);

  const lista = useQuery({
    queryKey: ["gastos-todos", qs],
    enabled: !!token,
    queryFn: () => fetchApi<Pagina>(`/admin/despesas?${qs}`, { token }),
  });
  const tipos = useQuery({
    queryKey: ["tipos-despesa"],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: () => fetchApi<TipoDespesaPainel[]>("/admin/tipos-despesa", { token }),
  });
  const r = lista.data;
  const paginas = r ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gastos de viagem</h1>
        <p className="text-sm text-muted-foreground">Tudo o que os motoristas lançaram, com a decisão de cada um.</p>
      </div>
      <AbasDaTela grupo="gastos-viagem" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MotoristaCombobox value={motoristaId} onChange={(v) => { setMotoristaId(v); setPage(1); }} placeholder="Motorista" />
        <VeiculoCombobox value={veiculoId} onChange={(v) => { setVeiculoId(v); setPage(1); }} placeholder="Caminhão" />
        <Select value={tipoId} onChange={(e) => { setTipoId(e.target.value); setPage(1); }} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {(tipos.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.nome}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Situação">
          <option value="">Qualquer situação</option>
          <option value="COM_ESCRITORIO">Com o escritório</option>
          <option value="APROVADA">Aprovado</option>
          <option value="NAO_REEMBOLSADA">Não reembolsado</option>
        </Select>
        <Input type="date" value={de} onChange={(e) => { setDe(e.target.value); setPage(1); }} aria-label="De" />
        <Input type="date" value={ate} onChange={(e) => { setAte(e.target.value); setPage(1); }} aria-label="Até" />
        <Select value={cobrar} onChange={(e) => { setCobrar(e.target.value); setPage(1); }} aria-label="Cobrar do cliente">
          <option value="">Cobrável do cliente ou não</option>
          <option value="true">Só os que podem ser cobrados do cliente</option>
          <option value="false">Só os que não podem</option>
        </Select>
      </div>

      {r && (
        <p className="text-sm text-muted-foreground">
          {r.total} gasto{r.total === 1 ? "" : "s"} · lançado {brl(r.totalInformado)} · aprovado {brl(r.totalAprovado)}
        </p>
      )}

      {foto && (
        <VisualizadorFotos
          fotos={foto.g.fotos.map((f) => ({ id: f.id, caminho: `/admin/despesas/${foto.g.id}/fotos/${f.id}`, rotacao: f.rotacao }))}
          indice={foto.i}
          onIndice={(i) => setFoto({ ...foto, i })}
          onFechar={() => setFoto(null)}
          titulo={`${foto.g.tipo.nome} · ${foto.g.motorista.nome}`}
        />
      )}

      {lista.isLoading ? (
        <LoadingCard />
      ) : !r || r.data.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum gasto com esses filtros.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Motorista</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 max-2xl:hidden">Viagem</th>
                <th className="px-3 py-2 text-right">Lançado</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.data.map((g) => {
                const st = rotuloStatus(g);
                return (
                  <tr key={g.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{diaHora(g.data)}</td>
                    <td className="px-3 py-2">
                      {g.motorista.nome}
                      {g.veiculo && <span className="block text-xs text-muted-foreground">{g.veiculo.placa}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <IconeTipo icone={g.tipo.icone} className="h-6 w-6 text-sm" />
                        {g.tipo.nome}
                      </span>
                      {g.descricao && <span className="block text-xs text-muted-foreground">{g.descricao}</span>}
                      {g.pontos.length > 0 && (
                        <span className="mt-0.5 flex items-start gap-1 text-xs text-amber-700" title={g.pontos.map(textoDoPonto).join("\n")}>
                          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                          {g.pontos.length} ponto{g.pontos.length === 1 ? "" : "s"} de atenção
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-2xl:hidden">
                      {g.viagem ? (
                        <Link href={`/viagens/${g.viagem.id}`} className="text-primary hover:underline">
                          {g.viagem.resumo}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{g.vinculo === "FORA_DE_VIAGEM" ? "Fora de viagem" : "Sem viagem"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {brl(g.valorInformado)}
                      {g.valorAprovado && Number(g.valorAprovado) !== Number(g.valorInformado) && (
                        <span className="block text-xs text-amber-700">aprovado {brl(g.valorAprovado)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cor)}>{st.texto}</span>
                      {g.motivo && <span className="mt-0.5 block text-xs italic text-muted-foreground">{g.motivo}</span>}
                      {g.acerto && (
                        <Link href={`/acertos/${g.acerto.id}`} className="mt-0.5 block text-xs text-primary hover:underline">
                          No acerto de {g.acerto.periodoFim.split("-").reverse().slice(0, 2).join("/")}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {g.fotos.length > 0 && (
                        <Button variant="ghost" size="icon" title="Ver a foto" onClick={() => setFoto({ g, i: 0 })}>
                          <Camera className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            {page} de {paginas}
          </span>
          <Button variant="outline" size="sm" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
