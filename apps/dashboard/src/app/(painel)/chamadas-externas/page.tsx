"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraSP } from "@/lib/datetime-br";

type Chamada = {
  id: string;
  criadoEm: string;
  contaId: string | null;
  conta: string | null;
  gatilho: string | null;
  servico: string;
  host: string;
  metodo: string;
  caminho: string;
  status: number | null;
  ok: boolean;
  duracaoMs: number;
  bytesEnvio: number | null;
  bytesResposta: number | null;
  erro: string | null;
  iaModelo: string | null;
  iaTokensEntrada: number | null;
  iaTokensSaida: number | null;
};
type Detalhe = Chamada & { pedido: unknown; resposta: unknown };
type Resumo = {
  porServico: {
    servico: string;
    chamadas: number;
    erros: number;
    duracaoMediaMs: number;
    tokensEntrada: number;
    tokensSaida: number;
  }[];
  servicos: string[];
};

const PERIODOS = { "24h": 1, "7d": 7, "30d": 30 } as const;
type Periodo = keyof typeof PERIODOS;

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtNum = (n: number) => n.toLocaleString("pt-BR");
const fmtBytes = (n: number | null) =>
  n == null ? "—" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

/**
 * Toda chamada que a plataforma faz pra fora — IA, ANTT, IBGE, mapas, WhatsApp…
 * Capturada sozinha (o `fetch` da API é envelopado na subida), então integração
 * nova aparece aqui sem ninguém lembrar de registrar. Só a equipe da plataforma.
 */
export default function ChamadasExternasPage() {
  const token = useAuthToken();
  const { plataforma, isLoading: carregandoPerm } = usePermissoes();
  const [periodo, setPeriodo] = useState<Periodo>("24h");
  const [servico, setServico] = useState("");
  const [soErros, setSoErros] = useState(false);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState<string | null>(null);

  const de = new Date(Date.now() - PERIODOS[periodo] * 86_400_000).toISOString();
  const qs = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ de, ...extra });
    if (servico) p.set("servico", servico);
    if (busca.trim()) p.set("busca", busca.trim());
    return p.toString();
  };

  const resumo = useQuery({
    queryKey: ["chamadas-resumo", periodo, busca],
    enabled: !!token && plataforma,
    refetchInterval: 30_000,
    queryFn: () => fetchApi<Resumo>(`/admin/chamadas-externas/resumo?${qs()}`, { token: token! }),
  });
  const lista = useQuery({
    queryKey: ["chamadas", periodo, servico, soErros, busca, pagina],
    enabled: !!token && plataforma,
    refetchInterval: 15_000,
    queryFn: () =>
      fetchApi<{ itens: Chamada[]; total: number; pagina: number; tamanho: number }>(
        `/admin/chamadas-externas?${qs({ pagina: String(pagina), ...(soErros ? { soErros: "true" } : {}) })}`,
        { token: token! },
      ),
  });

  if (carregandoPerm) return null;
  if (!plataforma) return <div className="p-6 text-sm text-muted-foreground">Esta tela é da equipe da plataforma.</div>;

  const filtrar = (s: string) => {
    setServico((atual) => (atual === s ? "" : s));
    setPagina(1);
  };
  const paginas = lista.data ? Math.max(1, Math.ceil(lista.data.total / lista.data.tamanho)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ArrowLeftRight className="h-6 w-6" /> Chamadas externas
        </h1>
        <p className="text-sm text-muted-foreground">
          Tudo que a plataforma pede pra fora — IA, ANTT, IBGE, mapas, WhatsApp — com o que foi enviado e o que voltou.
          Chave, senha, foto e áudio nunca ficam guardados; CPF, telefone e e-mail aparecem mascarados. O conteúdo some
          em 30 dias; o resumo fica 12 meses. Rotas e arquivos guardam só o resumo (são muitas).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={periodo}
          onChange={(e) => {
            setPeriodo(e.target.value as Periodo);
            setPagina(1);
          }}
          className="w-40"
        >
          <option value="24h">Últimas 24 horas</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
        </Select>
        <Select
          value={servico}
          onChange={(e) => {
            setServico(e.target.value);
            setPagina(1);
          }}
          className="w-56"
        >
          <option value="">Todos os serviços</option>
          {(resumo.data?.servicos ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Buscar no endereço, no erro ou em quem disparou"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          className="w-80"
        />
        <Button
          variant={soErros ? "destructive" : "outline"}
          size="sm"
          onClick={() => {
            setSoErros((x) => !x);
            setPagina(1);
          }}
        >
          {soErros ? "Mostrando só erros" : "Só erros"}
        </Button>
      </div>

      {resumo.isLoading ? (
        <LoadingCard />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(resumo.data?.porServico ?? []).map((s) => (
            <button
              key={s.servico}
              type="button"
              onClick={() => filtrar(s.servico)}
              className={`rounded-lg border p-3 text-left transition hover:bg-muted/50 ${servico === s.servico ? "border-primary ring-1 ring-primary" : ""}`}
            >
              <p className="truncate text-sm font-semibold">{s.servico}</p>
              <p className="text-xs text-muted-foreground">
                {fmtNum(s.chamadas)} chamada{s.chamadas === 1 ? "" : "s"} · média {fmtMs(s.duracaoMediaMs)}
              </p>
              <p className="text-xs">
                {s.erros > 0 ? (
                  <span className="font-medium text-red-700">{fmtNum(s.erros)} com erro</span>
                ) : (
                  <span className="text-emerald-700">sem erro</span>
                )}
                {s.tokensEntrada + s.tokensSaida > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {fmtNum(s.tokensEntrada)} + {fmtNum(s.tokensSaida)} tokens
                  </span>
                )}
              </p>
            </button>
          ))}
          {resumo.data?.porServico.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma chamada externa no período.</p>
          )}
        </div>
      )}

      <Card className="p-0">
        {lista.isLoading ? (
          <LoadingCard />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Chamada</TableHead>
                <TableHead>Disparada por</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Tempo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lista.data?.itens ?? []).map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setAberta(c.id)}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDataHoraSP(c.criadoEm)}</TableCell>
                  <TableCell className="text-xs font-medium">{c.servico}</TableCell>
                  <TableCell className="max-w-[28rem] text-xs">
                    <span className="font-mono">{c.metodo}</span>{" "}
                    <span className="break-all text-muted-foreground">{c.caminho}</span>
                    {c.iaTokensEntrada != null && (
                      <span className="ml-1 text-muted-foreground">
                        · {fmtNum(c.iaTokensEntrada)}+{fmtNum(c.iaTokensSaida ?? 0)} tokens
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.gatilho ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.conta ?? "—"}</TableCell>
                  <TableCell>
                    <Situacao c={c} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{fmtMs(c.duracaoMs)}</TableCell>
                </TableRow>
              ))}
              {lista.data?.itens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    Nada com esses filtros.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {lista.data && lista.data.total > 0 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            {fmtNum(lista.data.total)} chamada{lista.data.total === 1 ? "" : "s"} · página {pagina} de {paginas}
          </span>
          <Button size="sm" variant="outline" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <DetalheDaChamada id={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}

function Situacao({ c }: { c: Pick<Chamada, "ok" | "status" | "erro"> }) {
  if (c.ok) return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">{c.status ?? "ok"}</Badge>;
  return (
    <Badge className="border-red-200 bg-red-50 text-red-800" title={c.erro ?? undefined}>
      {c.status ?? "falhou"}
    </Badge>
  );
}

function DetalheDaChamada({ id, onFechar }: { id: string | null; onFechar: () => void }) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["chamada", id],
    enabled: !!token && !!id,
    queryFn: () => fetchApi<Detalhe>(`/admin/chamadas-externas/${id}`, { token: token! }),
  });
  const c = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{c ? `${c.servico} · ${c.metodo}` : "Chamada"}</SheetTitle>
          <SheetDescription className="break-all">{c ? `${c.host}${c.caminho}` : ""}</SheetDescription>
        </SheetHeader>
        {q.isLoading || !c ? (
          <LoadingCard />
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Campo nome="Quando" valor={fmtDataHoraSP(c.criadoEm)} />
              <Campo nome="Situação" valor={<Situacao c={c} />} />
              <Campo nome="Tempo" valor={fmtMs(c.duracaoMs)} />
              <Campo nome="Disparada por" valor={c.gatilho ?? "—"} />
              <Campo nome="Empresa" valor={c.conta ?? "—"} />
              <Campo nome="Tamanho" valor={`${fmtBytes(c.bytesEnvio)} enviados · ${fmtBytes(c.bytesResposta)} recebidos`} />
              {c.iaModelo && <Campo nome="Modelo de IA" valor={c.iaModelo} />}
              {c.iaTokensEntrada != null && (
                <Campo nome="Tokens" valor={`${fmtNum(c.iaTokensEntrada)} de entrada · ${fmtNum(c.iaTokensSaida ?? 0)} de saída`} />
              )}
            </div>
            {c.erro && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">{c.erro}</p>}
            <Conteudo titulo="O que foi enviado" valor={c.pedido} />
            <Conteudo titulo="O que voltou" valor={c.resposta} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Campo({ nome, valor }: { nome: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <p className="text-xs text-muted-foreground">{nome}</p>
      <div className="break-words text-sm">{valor}</div>
    </div>
  );
}

function Conteudo({ titulo, valor }: { titulo: string; valor: unknown }) {
  const texto =
    valor == null
      ? "Não guardado (serviço de alto volume, sem corpo, ou mais de 30 dias)."
      : typeof valor === "string"
        ? valor
        : // Texto de IA (instruções, resposta) vem cheio de quebras de linha: mostra
          // como texto, não como "\n" escapado — é pra gente ler, não pra copiar JSON.
          JSON.stringify(valor, null, 2).replace(/\\n/g, "\n");
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 font-mono text-xs">
        {texto}
      </pre>
    </div>
  );
}
