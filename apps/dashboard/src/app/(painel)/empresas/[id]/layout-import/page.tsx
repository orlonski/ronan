"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Eye,
  Fuel,
  Pencil,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Truck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, useAuthToken } from "@/lib/client-api";

// Slug é dinâmico — vem da tabela CampoLayout via API. Aceita qualquer string.
type CampoLayout = string;

type CampoLayoutDef = {
  id: string;
  slug: string;
  label: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
  tipo: string;
  descricao: string | null;
};

// Fallback usado quando o backend ainda não tem a tabela campos_layout
// populada (deploy fresh, seed pendente). UI continua funcional.
const CAMPOS_FALLBACK: CampoLayoutDef[] = [
  ["data", "Data", 10],
  ["placa", "Placa", 20],
  ["ticket", "Ticket", 30],
  ["toneladas", "Toneladas", 40],
  ["km", "Km", 50],
  ["cliente", "Cliente", 60],
  ["material", "Material", 70],
  ["fornecedor", "Fornecedor", 80],
  ["unidade", "Unidade", 90],
  ["valor_unitario", "Valor unitário", 100],
  ["valor_total", "Valor total", 110],
  ["praca_pedagio", "Praça de pedágio", 120],
  ["eixos", "Eixos", 130],
  ["ignorar", "— Ignorar —", 999],
].map(([slug, label, ordem], idx) => ({
  id: `fallback-${idx}`,
  slug: slug as string,
  label: label as string,
  ordem: ordem as number,
  ativo: true,
  sistema: true,
  tipo: "TEXTO",
  descricao: null,
}));

type LayoutColuna = { letra: string; cabecalho: string; campo: CampoLayout };

type LayoutSalvo = {
  tipoBloco: "viagens" | "pedagios" | "outro";
  abaPreferida?: string;
  linhaCabecalho?: number;
  linhaInicioDados?: number;
  colunas: LayoutColuna[];
  observacoes?: string;
};

type EstruturaPlanilha = {
  formato: "xlsx" | "csv" | "pdf";
  nomeArquivo: string;
  abas: {
    nome: string;
    totalLinhas: number;
    primeirasLinhas: (string | number | null)[][];
  }[];
};

type InferirResult = {
  estrutura: EstruturaPlanilha;
  sugestao: LayoutSalvo | null;
};

type FechamentoRecente = {
  id: string;
  periodoInicio: string;
  periodoFim: string;
  versao: number;
  status: string;
  criadoEm: string;
  _count: { linhas: number };
};

type CampoChave = "placa" | "data" | "ticket";
type Empresa = {
  id: string;
  nome: string;
  papel: string;
  chaveMatch: CampoChave[] | null;
  toleranciaKmPct: number;
  toleranciaTonPct: number;
};

type TipoBloco = "VIAGEM" | "PEDAGIO" | "COMBUSTIVEL";

type BlocoSalvo = {
  id: string;
  empresaId: string;
  tipo: TipoBloco;
  abaPreferida: string | null;
  linhaCabecalho: number | null;
  linhaInicioDados: number | null;
  colunas: LayoutColuna[];
  ativo: boolean;
};

const TIPOS_INFO: Record<TipoBloco, { titulo: string; icone: typeof Truck; cor: string; descricao: string }> = {
  VIAGEM: {
    titulo: "Viagens",
    icone: Truck,
    cor: "text-blue-700",
    descricao: "Lista de viagens com placa, ticket, km, toneladas, valor.",
  },
  PEDAGIO: {
    titulo: "Pedágios",
    icone: AlertTriangle,
    cor: "text-amber-700",
    descricao: "Praças/postos de pedágio, valor pago, eixos.",
  },
  COMBUSTIVEL: {
    titulo: "Combustível",
    icone: Fuel,
    cor: "text-green-700",
    descricao: "Abastecimentos: posto, litros, valor, odômetro.",
  },
};

export default function LayoutImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: empresaId } = use(params);
  const token = useAuthToken();
  const qc = useQueryClient();

  const empresa = useQuery({
    queryKey: ["empresa", empresaId],
    enabled: !!token,
    queryFn: () => fetchApi<Empresa>(`/admin/empresas/${empresaId}`, { token }),
  });

  // Lista de campos vem do banco — admin pode adicionar campos novos sem dev.
  const camposLayout = useQuery({
    queryKey: ["campos-layout"],
    enabled: !!token,
    queryFn: () =>
      fetchApi<CampoLayoutDef[]>(`/admin/campos-layout`, { token }),
  });

  // Fallback: se ainda não carregou ou veio vazio (banco zerado), usa lista
  // padrão pra UI não quebrar.
  const camposAtivos: CampoLayoutDef[] =
    camposLayout.data && camposLayout.data.length > 0
      ? camposLayout.data.filter((c) => c.ativo)
      : CAMPOS_FALLBACK;

  // Lista de blocos cadastrados pra empresa (até 3: VIAGEM/PEDAGIO/COMBUSTIVEL)
  const blocos = useQuery({
    queryKey: ["layout-import-blocos", empresaId],
    enabled: !!token,
    queryFn: () =>
      fetchApi<BlocoSalvo[]>(`/admin/empresas/${empresaId}/layout-import`, {
        token,
      }),
  });

  const fechamentos = useQuery({
    queryKey: ["layout-import-fechamentos", empresaId],
    enabled: !!token,
    queryFn: () =>
      fetchApi<FechamentoRecente[]>(
        `/admin/empresas/${empresaId}/layout-import/fechamentos-recentes`,
        { token },
      ),
  });

  // Bloco em edição (null = mostra cards de visão geral dos 3 tipos)
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoBloco | null>(null);
  const [layout, setLayout] = useState<LayoutSalvo | null>(null);
  const [estrutura, setEstrutura] = useState<EstruturaPlanilha | null>(null);
  const [arquivoSel, setArquivoSel] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvouAgora, setSalvouAgora] = useState(false);

  /**
   * Recalcula as colunas (`letra`, `cabecalho`) da aba/linha-cabeçalho
   * passadas, preservando mapeamentos `campo` quando o cabeçalho bate (case
   * insensitive). Colunas novas que não tinham equivalente viram "ignorar".
   */
  function recalcularColunas(
    abaNome: string,
    linhaCabecalho: number,
    mapeamentoAntigo: LayoutColuna[],
  ): LayoutColuna[] {
    const aba = estrutura?.abas.find((a) => a.nome === abaNome);
    if (!aba) return mapeamentoAntigo;
    const idxCab = Math.max(0, linhaCabecalho - 1);
    const headers = aba.primeirasLinhas[idxCab] ?? [];
    const memo = new Map<string, CampoLayout>();
    for (const c of mapeamentoAntigo) {
      const k = c.cabecalho.toUpperCase().trim();
      if (k && c.campo !== "ignorar") memo.set(k, c.campo);
    }
    return headers.map((h, i) => {
      const cabecalho = String(h ?? "").trim();
      const k = cabecalho.toUpperCase();
      return {
        letra: indiceParaLetra(i),
        cabecalho,
        campo: memo.get(k) ?? "ignorar",
      };
    });
  }

  // Quando seleciona um tipo, carrega o layout salvo daquele tipo (se existe)
  useEffect(() => {
    setEstrutura(null);
    setArquivoSel(null);
    setErro(null);
    setSalvouAgora(false);
    if (!tipoSelecionado) {
      setLayout(null);
      return;
    }
    const blocoExistente = (blocos.data ?? []).find(
      (b) => b.tipo === tipoSelecionado,
    );
    if (blocoExistente) {
      setLayout({
        tipoBloco: "viagens",
        abaPreferida: blocoExistente.abaPreferida ?? undefined,
        linhaCabecalho: blocoExistente.linhaCabecalho ?? undefined,
        linhaInicioDados: blocoExistente.linhaInicioDados ?? undefined,
        colunas: blocoExistente.colunas,
      });
    } else {
      setLayout(null);
    }
  }, [tipoSelecionado, blocos.data]);

  const inferir = useMutation({
    mutationFn: async (file: File): Promise<InferirResult> => {
      const fd = new FormData();
      fd.append("arquivo", file);
      const qs = tipoSelecionado ? `?tipo=${tipoSelecionado}` : "";
      return fetchApi<InferirResult>(
        `/admin/empresas/${empresaId}/layout-import/inferir${qs}`,
        { method: "POST", body: fd, token },
      );
    },
    onSuccess: (data) => {
      setEstrutura(data.estrutura);
      // Sugestão da IA vira o layout editável; se IA falhou, monta um stub
      if (data.sugestao && data.sugestao.colunas?.length > 0) {
        setLayout(data.sugestao);
      } else {
        // Stub: usa primeira aba, headers da primeira linha como cabeçalhos
        const aba = data.estrutura.abas[0];
        if (aba && aba.primeirasLinhas[0]) {
          const headers = aba.primeirasLinhas[0];
          setLayout({
            tipoBloco: "viagens",
            abaPreferida: aba.nome,
            linhaCabecalho: 1,
            linhaInicioDados: 2,
            colunas: headers.map((h, i) => ({
              letra: indiceParaLetra(i),
              cabecalho: String(h ?? ""),
              campo: "ignorar",
            })),
          });
        }
      }
      setErro(null);
    },
    onError: (err) => setErro((err as Error).message),
  });

  const salvar = useMutation({
    mutationFn: (body: LayoutSalvo) => {
      if (!tipoSelecionado) throw new Error("Tipo do bloco não selecionado");
      return fetchApi<unknown>(
        `/admin/empresas/${empresaId}/layout-import/${tipoSelecionado}`,
        { method: "PUT", body: JSON.stringify(body), token },
      );
    },
    onSuccess: () => {
      setSalvouAgora(true);
      void qc.invalidateQueries({ queryKey: ["layout-import-blocos", empresaId] });
    },
    onError: (err) => setErro((err as Error).message),
  });

  const limpar = useMutation({
    mutationFn: () => {
      if (!tipoSelecionado) throw new Error("Tipo do bloco não selecionado");
      return fetchApi<void>(
        `/admin/empresas/${empresaId}/layout-import/${tipoSelecionado}`,
        { method: "DELETE", token },
      );
    },
    onSuccess: () => {
      setLayout(null);
      setEstrutura(null);
      setSalvouAgora(false);
      void qc.invalidateQueries({ queryKey: ["layout-import-blocos", empresaId] });
    },
  });

  const reprocessarFechamento = useMutation({
    mutationFn: (fechamentoId: string) =>
      fetchApi<unknown>(`/admin/fechamentos/${fechamentoId}/reprocessar`, {
        method: "POST",
        token,
      }),
  });

  const [reprocessando, setReprocessando] = useState<Set<string>>(new Set());
  async function reprocessarLote(ids: string[]) {
    for (const id of ids) {
      setReprocessando((s) => new Set([...s, id]));
      try {
        await reprocessarFechamento.mutateAsync(id);
      } catch {
        /* segue */
      }
      setReprocessando((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  // Preview: aplica o mapeamento atual nas primeiras 5 linhas de dados
  const preview = useMemo(() => {
    if (!estrutura || !layout) return null;
    const aba = estrutura.abas.find((a) => a.nome === layout.abaPreferida);
    if (!aba) return null;
    const inicio = (layout.linhaInicioDados ?? 2) - 1;
    const linhasDados = aba.primeirasLinhas.slice(inicio, inicio + 5);
    return linhasDados.map((linha, i) => {
      const obj: Record<string, unknown> = { _linha: inicio + i + 1 };
      for (const col of layout.colunas) {
        if (col.campo === "ignorar") continue;
        const idx = letraParaIndice(col.letra);
        obj[col.campo] = linha[idx] ?? null;
      }
      return obj;
    });
  }, [estrutura, layout]);

  if (!token) return null;

  if (empresa.data?.papel === "RECEBE_PLANILHA") {
    return (
      <div className="space-y-4">
        <Link href="/empresas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" /> Empresas
        </Link>
        <Card className="p-6">
          <p className="text-sm">
            Esta empresa só recebe planilhas (não envia fechamento), então não
            precisa configurar layout de importação.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        {tipoSelecionado ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTipoSelecionado(null)}
            title="Voltar à visão geral"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : (
          <Link href="/empresas">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Layout de importação
            {tipoSelecionado && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                — {TIPOS_INFO[tipoSelecionado].titulo}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {empresa.data?.nome ?? "..."}
            {!tipoSelecionado &&
              " — configure como ler cada tipo de bloco da planilha."}
          </p>
        </div>
      </header>

      {/* Visão geral: 3 cards de tipos */}
      {!tipoSelecionado && (
        <>
          <BlocosOverview
            blocos={blocos.data ?? []}
            onSelect={setTipoSelecionado}
          />
          {empresa.data && (
            <MatchConfigCard empresa={empresa.data} token={token} qc={qc} />
          )}
        </>
      )}

      {/* Estado A: sem layout cached e sem inferência (DENTRO de um tipo selecionado) */}
      {tipoSelecionado && !layout && !estrutura && (
        <Card className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <Upload className="mt-1 h-5 w-5 text-blue-600" />
            <div className="flex-1">
              <h2 className="font-semibold">Configure o layout de importação</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Suba uma planilha de exemplo (XLSX, CSV ou PDF) que esta empresa
                costuma mandar. Vou ler o conteúdo e sugerir o mapeamento. Você
                confere e corrige antes de salvar.
              </p>
            </div>
          </div>
          <UploadInput
            file={arquivoSel}
            onFile={setArquivoSel}
            onInferir={() => arquivoSel && inferir.mutate(arquivoSel)}
            loading={inferir.isPending}
          />
        </Card>
      )}

      {/* Estado B: tem layout cacheado, mas ainda não fez nova inferência */}
      {tipoSelecionado && layout && !estrutura && (
        <>
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Layout atual
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="Aba" value={layout.abaPreferida ?? "—"} />
              <Info
                label="Linha cabeçalho"
                value={String(layout.linhaCabecalho ?? "—")}
              />
              <Info
                label="Linha início dados"
                value={String(layout.linhaInicioDados ?? "—")}
              />
            </div>
            <div className="border-t pt-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Colunas mapeadas ({layout.colunas.length})
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Letra</TableHead>
                    <TableHead>Cabeçalho do cliente</TableHead>
                    <TableHead>Nosso campo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {layout.colunas.map((c, i) => {
                    const def = camposAtivos.find((cl) => cl.slug === c.campo);
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono">{c.letra}</TableCell>
                        <TableCell className="text-sm">{c.cabecalho}</TableCell>
                        <TableCell className="text-sm">
                          {def?.sistema && "🔒 "}
                          {def?.label ?? c.campo}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setEstrutura(null)}
                disabled
              >
                <RefreshCw className="h-4 w-4" />
                (carregue uma nova planilha abaixo)
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm("Apagar layout atual? Próxima planilha vai re-inferir do zero.")) {
                    limpar.mutate();
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> Apagar e recomeçar
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Atualizar com nova planilha
            </h2>
            <UploadInput
              file={arquivoSel}
              onFile={setArquivoSel}
              onInferir={() => arquivoSel && inferir.mutate(arquivoSel)}
              loading={inferir.isPending}
            />
          </Card>
        </>
      )}

      {/* Estado C: depois de inferir/parsear */}
      {tipoSelecionado && estrutura && layout && (
        <>
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Estrutura detectada
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="Formato" value={estrutura.formato.toUpperCase()} />
              <Info
                label="Abas encontradas"
                value={String(estrutura.abas.length)}
              />
              <Info label="Arquivo" value={estrutura.nomeArquivo} />
            </div>
            {estrutura.abas.length > 1 && (
              <div className="space-y-2 pt-2">
                <Label>Aba escolhida</Label>
                <Select
                  value={layout.abaPreferida ?? estrutura.abas[0]?.nome ?? ""}
                  onChange={(e) => {
                    const novaAba = e.target.value;
                    setLayout((l) => {
                      if (!l) return l;
                      const colunas = recalcularColunas(
                        novaAba,
                        l.linhaCabecalho ?? 1,
                        l.colunas,
                      );
                      return { ...l, abaPreferida: novaAba, colunas };
                    });
                  }}
                >
                  {estrutura.abas.map((a) => (
                    <option key={a.nome} value={a.nome}>
                      {a.nome} ({a.totalLinhas} linhas)
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Mapeamentos com cabeçalho idêntico são preservados ao trocar
                  de aba.
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Linha do cabeçalho</Label>
                <Input
                  type="number"
                  min={1}
                  value={layout.linhaCabecalho ?? 1}
                  onChange={(e) => {
                    const novaLinha = Number(e.target.value) || 1;
                    setLayout((l) => {
                      if (!l) return l;
                      const colunas = recalcularColunas(
                        l.abaPreferida ?? estrutura.abas[0]?.nome ?? "",
                        novaLinha,
                        l.colunas,
                      );
                      return { ...l, linhaCabecalho: novaLinha, colunas };
                    });
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Linha de início dos dados</Label>
                <Input
                  type="number"
                  min={1}
                  value={layout.linhaInicioDados ?? 2}
                  onChange={(e) =>
                    setLayout((l) =>
                      l
                        ? { ...l, linhaInicioDados: Number(e.target.value) || 2 }
                        : l,
                    )
                  }
                />
              </div>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Mapeamento de colunas
            </h2>
            <p className="text-xs text-muted-foreground">
              Pra cada coluna que o cliente manda, escolha qual campo nosso ela
              representa. Marque como "Ignorar" se for coluna de subtotal,
              contrato, ou qualquer coisa que não usamos.
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">🔒</span> = campos do sistema, usados
              em match e comparação. Outros campos são extraídos e ficam
              disponíveis no detalhe da linha do fechamento. Pra cadastrar um
              campo novo, vá em <span className="font-medium">Configurações
              → Campos do layout</span>.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Letra</TableHead>
                  <TableHead>Cabeçalho do cliente</TableHead>
                  <TableHead className="w-64">Nosso campo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {layout.colunas.map((c, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono">{c.letra}</TableCell>
                    <TableCell className="text-sm">{c.cabecalho || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={c.campo}
                        onChange={(e) => {
                          const novo = [...layout.colunas];
                          novo[idx] = {
                            ...novo[idx]!,
                            campo: e.target.value as CampoLayout,
                          };
                          setLayout({ ...layout, colunas: novo });
                        }}
                      >
                        {camposAtivos.map((cl) => (
                          <option key={cl.slug} value={cl.slug}>
                            {cl.sistema ? "🔒 " : ""}
                            {cl.label}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {preview && preview.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Eye className="h-4 w-4" />
                Preview ({preview.length} linha{preview.length === 1 ? "" : "s"})
              </h2>
              <p className="text-xs text-muted-foreground">
                Como ficariam as primeiras linhas da planilha lidas com este
                mapeamento.
              </p>
              <div className="space-y-2">
                {preview.map((linha, i) => (
                  <div
                    key={i}
                    className="rounded border bg-muted/30 p-3 font-mono text-xs"
                  >
                    <div className="mb-1 text-muted-foreground">
                      Linha {linha._linha as number}
                    </div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {Object.entries(linha).map(([k, v]) => {
                        if (k === "_linha") return null;
                        const vazio = v === null || v === "" || v === undefined;
                        return (
                          <div key={k}>
                            <span className="text-muted-foreground">{k}:</span>{" "}
                            <span className={vazio ? "text-red-600" : ""}>
                              {vazio ? "(vazio)" : String(v)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {erro && (
            <Card className="border-destructive/40 bg-destructive/5 p-4">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {erro}
              </p>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                // volta pra visão geral (sai do tipo selecionado)
                setTipoSelecionado(null);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={() => layout && salvar.mutate(layout)} disabled={salvar.isPending}>
              <Save className="h-4 w-4" />
              {salvar.isPending ? "Salvando..." : "Salvar layout"}
            </Button>
          </div>

          {salvouAgora && (
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-green-700">
                ✓ Layout salvo
              </h2>
              <p className="text-sm">
                Reprocessar fechamentos antigos desta empresa com o novo layout?
              </p>
              {fechamentos.data && fechamentos.data.length > 0 ? (
                <div className="space-y-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período</TableHead>
                        <TableHead>Versão</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Linhas</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fechamentos.data.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="text-sm">
                            {fmtData(f.periodoInicio)} a {fmtData(f.periodoFim)}
                          </TableCell>
                          <TableCell>v{f.versao}</TableCell>
                          <TableCell className="text-xs">{f.status}</TableCell>
                          <TableCell>{f._count.linhas}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reprocessarLote([f.id])}
                              disabled={reprocessando.has(f.id)}
                            >
                              <RefreshCw className="h-3 w-3" />
                              {reprocessando.has(f.id) ? "..." : "Reprocessar"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Button
                    size="sm"
                    onClick={() =>
                      reprocessarLote((fechamentos.data ?? []).map((f) => f.id))
                    }
                    disabled={reprocessando.size > 0}
                  >
                    Reprocessar todos
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum fechamento anterior pra reprocessar.
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function UploadInput({
  file,
  onFile,
  onInferir,
  loading,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onInferir: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-3">
      <Input
        type="file"
        accept=".xlsx,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <Button onClick={onInferir} disabled={!file || loading}>
        <Upload className="h-4 w-4" />
        {loading ? "Lendo..." : "Ler e inferir layout"}
      </Button>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function indiceParaLetra(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function letraParaIndice(letra: string): number {
  let n = 0;
  for (const c of letra.toUpperCase()) {
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n - 1;
}

function fmtData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

const CAMPOS_CHAVE_LABELS: Record<CampoChave, string> = {
  placa: "Placa",
  data: "Data",
  ticket: "Ticket",
};

/**
 * Visão geral dos 3 blocos: Viagens, Pedágios, Combustível.
 * Cada card mostra status + botão Configurar/Editar.
 */
function BlocosOverview({
  blocos,
  onSelect,
}: {
  blocos: BlocoSalvo[];
  onSelect: (tipo: TipoBloco) => void;
}) {
  const tipos: TipoBloco[] = ["VIAGEM", "PEDAGIO", "COMBUSTIVEL"];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {tipos.map((tipo) => {
        const bloco = blocos.find((b) => b.tipo === tipo);
        const info = TIPOS_INFO[tipo];
        const Icon = info.icone;
        const configurado = !!bloco;
        return (
          <Card key={tipo} className="space-y-3 p-5">
            <div className="flex items-start gap-3">
              <Icon className={`h-6 w-6 ${info.cor} shrink-0`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold">{info.titulo}</h3>
                  {configurado ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/40" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {info.descricao}
                </p>
              </div>
            </div>
            {configurado && bloco && (
              <div className="rounded-md bg-muted/30 p-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Aba: </span>
                  <span className="font-mono">{bloco.abaPreferida ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Colunas mapeadas: </span>
                  <span className="font-medium">
                    {bloco.colunas.filter((c) => c.campo !== "ignorar").length}{" "}
                    de {bloco.colunas.length}
                  </span>
                </div>
              </div>
            )}
            <Button
              variant={configurado ? "outline" : "default"}
              className="w-full"
              onClick={() => onSelect(tipo)}
            >
              {configurado ? (
                <>
                  <Pencil className="h-4 w-4" /> Editar
                </>
              ) : (
                <>
                  <Settings className="h-4 w-4" /> Configurar
                </>
              )}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

function MatchConfigCard({
  empresa,
  token,
  qc,
}: {
  empresa: Empresa;
  token: string | undefined;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [chave, setChave] = useState<CampoChave[]>(
    empresa.chaveMatch ?? ["placa", "data", "ticket"],
  );
  const [tolKm, setTolKm] = useState(empresa.toleranciaKmPct ?? 0);
  const [tolTon, setTolTon] = useState(empresa.toleranciaTonPct ?? 0);

  const update = useMutation({
    mutationFn: (body: {
      chaveMatch: CampoChave[];
      toleranciaKmPct: number;
      toleranciaTonPct: number;
    }) =>
      fetchApi(`/admin/empresas/${empresa.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empresa", empresa.id] });
    },
  });

  function toggle(c: CampoChave) {
    setChave((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  return (
    <Card className="space-y-3 p-5">
      <button
        type="button"
        onClick={() => setExpandido((e) => !e)}
        className="flex w-full items-center justify-between"
      >
        <div className="text-left">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Como fazer o match? (avançado)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Personalize quando o sistema considera "MATCH" entre uma linha do
            cliente e uma viagem do motorista.
          </p>
        </div>
        <span className="text-xl text-muted-foreground">{expandido ? "−" : "+"}</span>
      </button>

      {expandido && (
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-2">
            <Label>Campos da chave única</Label>
            <p className="text-xs text-muted-foreground">
              Quais campos devem bater pra considerar a mesma viagem. Default:
              placa + data + ticket.
            </p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CAMPOS_CHAVE_LABELS) as CampoChave[]).map((c) => {
                const ativo = chave.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(c)}
                    className={`rounded-full border-2 px-4 py-1.5 text-sm font-medium ${
                      ativo
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {ativo ? "✓ " : ""}
                    {CAMPOS_CHAVE_LABELS[c]}
                  </button>
                );
              })}
            </div>
            {chave.length === 0 && (
              <p className="text-xs text-destructive">
                Selecione ao menos 1 campo.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label>Tolerância em KM</Label>
              <span className="text-sm font-bold text-primary">±{tolKm}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={tolKm}
              onChange={(e) => setTolKm(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              {tolKm === 0
                ? "Exato (qualquer divergência vira DIVERGENCIA)."
                : `Aceita até ±${tolKm}% de diferença antes de virar DIVERGENCIA.`}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label>Tolerância em toneladas</Label>
              <span className="text-sm font-bold text-primary">±{tolTon}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={tolTon}
              onChange={(e) => setTolTon(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground">
              {tolTon === 0
                ? "Exato (qualquer divergência vira DIVERGENCIA)."
                : `Aceita até ±${tolTon}% de diferença antes de virar DIVERGENCIA.`}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() =>
                update.mutate({
                  chaveMatch: chave,
                  toleranciaKmPct: tolKm,
                  toleranciaTonPct: tolTon,
                })
              }
              disabled={chave.length === 0 || update.isPending}
            >
              <Save className="h-4 w-4" />
              {update.isPending ? "Salvando..." : "Salvar config de match"}
            </Button>
          </div>
          {update.isSuccess && (
            <p className="text-right text-xs text-green-700">✓ salvo</p>
          )}
        </div>
      )}
    </Card>
  );
}
