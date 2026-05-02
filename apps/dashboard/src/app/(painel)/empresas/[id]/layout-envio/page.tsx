"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Eye,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import {
  type LayoutEnvio,
  useLayoutsEnvio,
  useRemoverLayout,
  useSalvarLayout,
} from "@/lib/fechamentos-api";
import { useQuery } from "@tanstack/react-query";

const CAMPOS_DISPONIVEIS: Array<{ campo: string; defaultHeader: string; formato?: string }> = [
  { campo: "data", defaultHeader: "Data" },
  { campo: "placa", defaultHeader: "Placa" },
  { campo: "modelo", defaultHeader: "Modelo do veículo" },
  { campo: "motorista", defaultHeader: "Motorista" },
  { campo: "ticket", defaultHeader: "Ticket" },
  { campo: "obra", defaultHeader: "Obra" },
  { campo: "material", defaultHeader: "Material" },
  { campo: "toneladas", defaultHeader: "Toneladas", formato: "decimal_br" },
  { campo: "km", defaultHeader: "Distância (Km)", formato: "decimal_br" },
  { campo: "valor_total", defaultHeader: "Valor total (R$)", formato: "currency_br" },
  { campo: "valor_pedagio", defaultHeader: "Pedágio (R$)", formato: "currency_br" },
  { campo: "local_carga", defaultHeader: "Local de carga" },
  { campo: "local_descarga", defaultHeader: "Local de descarga" },
];

type Empresa = { id: string; nome: string };

export default function LayoutEnvioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: empresaId } = use(params);
  const token = useAuthToken();
  const empresa = useQuery({
    queryKey: ["empresa", empresaId],
    enabled: !!token,
    queryFn: () => fetchApi<Empresa>(`/admin/empresas/${empresaId}`, { token }),
  });
  const layouts = useLayoutsEnvio(empresaId);
  const salvar = useSalvarLayout(empresaId);
  const remover = useRemoverLayout(empresaId);

  const [editing, setEditing] = useState<Partial<LayoutEnvio> | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Link href={`/empresas`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Layout de envio — {empresa.data?.nome}
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure como a planilha de fechamento deve sair pra esta empresa receber. Você pode
            ter múltiplos modelos (viagens, pedágios, consolidado).
          </p>
        </div>
      </header>

      {!editing && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setEditing(novoLayout())}>
              <Plus className="h-4 w-4" /> Novo modelo
            </Button>
          </div>
          <div className="space-y-3">
            {layouts.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            )}
            {layouts.data?.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Esta empresa ainda não tem layout configurado. Crie um modelo pra poder exportar
                planilhas pra ela.
              </Card>
            )}
            {layouts.data?.map((l) => (
              <Card key={l.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{l.nome}</p>
                    {l.padrao && (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        padrão
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {l.colunas.length} colunas · ordem: {l.colunas.slice(0, 5).map((c) => c.header).join(", ")}
                    {l.colunas.length > 5 ? "..." : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(l)}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Remover layout "${l.nome}"?`)) remover.mutate(l.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing && (
        <Editor
          empresaId={empresaId}
          inicial={editing}
          onSalvar={async (input) => {
            await salvar.mutateAsync(input);
            setEditing(null);
          }}
          onCancelar={() => setEditing(null)}
          salvando={salvar.isPending}
        />
      )}
    </div>
  );
}

function Editor({
  inicial,
  onSalvar,
  onCancelar,
  salvando,
}: {
  empresaId: string;
  inicial: Partial<LayoutEnvio>;
  onSalvar: (input: {
    id?: string;
    nome: string;
    colunas: LayoutEnvio["colunas"];
    config?: LayoutEnvio["config"];
    padrao?: boolean;
  }) => Promise<void>;
  onCancelar: () => void;
  salvando: boolean;
}) {
  const [nome, setNome] = useState(inicial.nome ?? "");
  const [colunas, setColunas] = useState<LayoutEnvio["colunas"]>(
    inicial.colunas?.length
      ? inicial.colunas.slice().sort((a, b) => a.ordem - b.ordem)
      : preset(),
  );
  const [config, setConfig] = useState<LayoutEnvio["config"]>(
    inicial.config ?? {
      incluiCabecalhoEmpresa: true,
      formatoData: "DD/MM/YYYY",
      separadorDecimal: "vírgula",
      totaisRodape: true,
    },
  );
  const [padrao, setPadrao] = useState(inicial.padrao ?? false);

  const naoUsados = CAMPOS_DISPONIVEIS.filter(
    (c) => !colunas.some((cc) => cc.campo === c.campo),
  );

  function adicionarColuna(campo: string) {
    const def = CAMPOS_DISPONIVEIS.find((c) => c.campo === campo);
    if (!def) return;
    setColunas((s) => [
      ...s,
      {
        campo: def.campo,
        header: def.defaultHeader,
        ordem: s.length,
        formato: def.formato as never,
      },
    ]);
  }

  function moverPara(idx: number, dir: -1 | 1) {
    setColunas((s) => {
      const next = s.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return s;
      const a = next[idx]!;
      const b = next[j]!;
      next[idx] = b;
      next[j] = a;
      return next.map((c, i) => ({ ...c, ordem: i }));
    });
  }

  function remover(idx: number) {
    setColunas((s) => s.filter((_, i) => i !== idx).map((c, i) => ({ ...c, ordem: i })));
  }

  function setHeader(idx: number, valor: string) {
    setColunas((s) => s.map((c, i) => (i === idx ? { ...c, header: valor } : c)));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <div className="space-y-1.5">
          <Label>Nome do modelo *</Label>
          <Input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder='ex: "Planilha mensal viagens", "Pedágios"'
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Colunas (na ordem que vão sair)</Label>
            {naoUsados.length > 0 && (
              <Select
                className="w-56"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    adicionarColuna(e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="">+ adicionar coluna...</option>
                {naoUsados.map((c) => (
                  <option key={c.campo} value={c.campo}>
                    {c.defaultHeader}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="space-y-2">
            {colunas.map((c, idx) => (
              <div
                key={c.campo}
                className="flex items-center gap-2 rounded-md border bg-background p-2"
              >
                <span className="w-6 text-center font-mono text-xs text-muted-foreground">
                  {idx + 1}
                </span>
                <Input
                  value={c.header}
                  onChange={(e) => setHeader(idx, e.target.value)}
                  className="flex-1"
                />
                <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
                  {c.campo}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => moverPara(idx, -1)}
                  disabled={idx === 0}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => moverPara(idx, 1)}
                  disabled={idx === colunas.length - 1}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remover(idx)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Formato de data</Label>
            <Select
              value={config?.formatoData ?? "DD/MM/YYYY"}
              onChange={(e) =>
                setConfig({ ...(config ?? {}), formatoData: e.target.value as never })
              }
            >
              <option value="DD/MM/YYYY">DD/MM/AAAA</option>
              <option value="DD/MM/YY">DD/MM/AA</option>
              <option value="YYYY-MM-DD">AAAA-MM-DD (ISO)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Separador decimal</Label>
            <Select
              value={config?.separadorDecimal ?? "vírgula"}
              onChange={(e) =>
                setConfig({ ...(config ?? {}), separadorDecimal: e.target.value as never })
              }
            >
              <option value="vírgula">Vírgula (1.234,56)</option>
              <option value="ponto">Ponto (1234.56)</option>
            </Select>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!config?.incluiCabecalhoEmpresa}
              onChange={(e) =>
                setConfig({ ...(config ?? {}), incluiCabecalhoEmpresa: e.target.checked })
              }
            />
            Incluir cabeçalho da empresa no topo (nome + período)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!config?.totaisRodape}
              onChange={(e) =>
                setConfig({ ...(config ?? {}), totaisRodape: e.target.checked })
              }
            />
            Linha de totais no rodapé (toneladas, km, valores)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={padrao}
              onChange={(e) => setPadrao(e.target.checked)}
            />
            Marcar como modelo padrão da empresa
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSalvar({
                id: inicial.id,
                nome,
                colunas,
                config,
                padrao,
              })
            }
            disabled={salvando || !nome || colunas.length === 0}
          >
            <Save className="h-4 w-4" /> {salvando ? "Salvando..." : "Salvar modelo"}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-base font-medium">Pré-visualização</h3>
        </div>
        <Preview colunas={colunas} config={config} />
      </Card>
    </div>
  );
}

function Preview({
  colunas,
  config,
}: {
  colunas: LayoutEnvio["colunas"];
  config: LayoutEnvio["config"];
}) {
  const sample = useMemo(() => sampleData(), []);
  const fmt = (val: unknown, c: LayoutEnvio["colunas"][number]) => formatPreview(val, c, config);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-slate-100">
          {config?.incluiCabecalhoEmpresa && (
            <>
              <tr>
                <th colSpan={colunas.length} className="px-2 py-2 text-left font-bold">
                  Construtora Alfa
                </th>
              </tr>
              <tr>
                <th colSpan={colunas.length} className="px-2 py-1 text-left text-muted-foreground">
                  Período: 01/03/2026 a 31/03/2026
                </th>
              </tr>
            </>
          )}
          <tr>
            {colunas.map((c) => (
              <th key={c.campo} className="border-l px-2 py-1.5 text-left font-semibold">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.map((row, i) => (
            <tr key={i} className={i % 2 ? "bg-white" : "bg-slate-50/50"}>
              {colunas.map((c) => (
                <td key={c.campo} className="border-l px-2 py-1.5">
                  {fmt(row[c.campo as never], c)}
                </td>
              ))}
            </tr>
          ))}
          {config?.totaisRodape && (
            <tr className="border-t-2 bg-slate-100 font-semibold">
              {colunas.map((c, i) => (
                <td key={c.campo} className="border-l px-2 py-1.5">
                  {i === 0 ? "TOTAL" : totalParaCampo(c.campo, sample)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function preset(): LayoutEnvio["colunas"] {
  return [
    { campo: "data", header: "Data", ordem: 0 },
    { campo: "placa", header: "Placa", ordem: 1 },
    { campo: "ticket", header: "Ticket", ordem: 2 },
    { campo: "obra", header: "Obra", ordem: 3 },
    { campo: "material", header: "Material", ordem: 4 },
    { campo: "toneladas", header: "Toneladas", ordem: 5, formato: "decimal_br" },
    { campo: "km", header: "Distância (Km)", ordem: 6, formato: "decimal_br" },
    { campo: "valor_total", header: "Valor total (R$)", ordem: 7, formato: "currency_br" },
  ];
}

function novoLayout(): Partial<LayoutEnvio> {
  return {
    nome: "",
    colunas: preset(),
    config: {
      incluiCabecalhoEmpresa: true,
      formatoData: "DD/MM/YYYY",
      separadorDecimal: "vírgula",
      totaisRodape: true,
    },
    padrao: false,
  };
}

const SAMPLE = [
  {
    data: "2026-03-02",
    placa: "BTO4E72",
    modelo: "Volvo FH",
    motorista: "João Silva",
    ticket: "TKB-040704",
    obra: "EV - C 011/2026",
    material: 'C.B.U.Q. FAIXA "C"',
    toneladas: 21.10,
    km: 65.7,
    valor_total: 970.39,
    valor_pedagio: 60.5,
    local_carga: "Pedreira Souza Naves (São José dos Pinhais/PR)",
    local_descarga: "Obra Centro (Curitiba/PR)",
  },
  {
    data: "2026-03-02",
    placa: "AUJ2962",
    modelo: "Scania R450",
    motorista: "José Pereira",
    ticket: "TKB-040708",
    obra: "EV - C 011/2026",
    material: 'C.B.U.Q. FAIXA "C"',
    toneladas: 21.25,
    km: 65.7,
    valor_total: 977.29,
    valor_pedagio: 60.5,
    local_carga: "Pedreira Souza Naves (São José dos Pinhais/PR)",
    local_descarga: "Obra Centro (Curitiba/PR)",
  },
  {
    data: "2026-03-03",
    placa: "APL6A61",
    modelo: "Mercedes Actros",
    motorista: "Pedro Santos",
    ticket: "TKB-040728",
    obra: "EV - C 011/2026",
    material: 'C.B.U.Q. FAIXA "C"',
    toneladas: 23.00,
    km: 31.5,
    valor_total: 507.15,
    valor_pedagio: 60.5,
    local_carga: "Pedreira Souza Naves (São José dos Pinhais/PR)",
    local_descarga: "Obra Centro (Curitiba/PR)",
  },
];

function sampleData() {
  return SAMPLE;
}

function formatPreview(
  val: unknown,
  coluna: LayoutEnvio["colunas"][number],
  config: LayoutEnvio["config"],
): string {
  if (val === undefined || val === null) return "—";
  if (coluna.campo === "data") {
    const parts = String(val).split("-");
    const yyyy = parts[0] ?? "0000";
    const mm = parts[1] ?? "01";
    const dd = parts[2] ?? "01";
    if (config?.formatoData === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
    if (config?.formatoData === "DD/MM/YY") return `${dd}/${mm}/${yyyy.slice(2)}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  if (typeof val === "number") {
    const decimal = config?.separadorDecimal === "ponto" ? "." : ",";
    if (coluna.campo === "valor_total" || coluna.campo === "valor_pedagio") {
      const formatted = val.toFixed(2).replace(".", decimal);
      return `R$ ${formatted}`;
    }
    if (coluna.campo === "toneladas") {
      return val.toFixed(3).replace(".", decimal);
    }
    return val.toFixed(2).replace(".", decimal);
  }
  return String(val);
}

function totalParaCampo(campo: string, rows: Record<string, unknown>[]): string {
  const numericos = ["toneladas", "km", "valor_total", "valor_pedagio"];
  if (!numericos.includes(campo)) return "";
  const total = rows.reduce((acc, r) => acc + Number(r[campo] ?? 0), 0);
  if (campo === "valor_total" || campo === "valor_pedagio") {
    return `R$ ${total.toFixed(2).replace(".", ",")}`;
  }
  if (campo === "toneladas") return total.toFixed(3).replace(".", ",");
  return total.toFixed(2).replace(".", ",");
}
