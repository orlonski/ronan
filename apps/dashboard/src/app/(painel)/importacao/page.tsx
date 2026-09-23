"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleAlert, Download, FileSpreadsheet, Upload } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { LoadingCard } from "@/components/loading";
import { toast } from "sonner";
import { apiBaseUrl, fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";

type Campo = {
  chave: string;
  rotulo: string;
  obrigatorio: boolean;
  ajuda?: string;
  exemplos: string[];
};

type Entidade = {
  chave: string;
  rotulo: string;
  descricao: string;
  chaveNatural: string;
  campos: Campo[];
};

type Linha = {
  numero: number;
  valores: Record<string, string | number>;
  chave: string;
  erros: { campo: string; mensagem: string }[];
  duplicadaNoArquivo?: boolean;
};

type Previa = {
  entidade: string;
  arquivo: string;
  aba: string;
  linhaCabecalho: number;
  cabecalho: (string | number | null)[];
  mapa: Record<string, number>;
  faltando: string[];
  linhas: Linha[];
  resumo: { total: number; prontas: number; comErro: number; duplicadasNoArquivo: number };
};

type Resultado = {
  criados: number;
  atualizados: number;
  ignorados: number;
  avisos: string[];
};

export default function ImportacaoPage() {
  return (
    <RequerTela chave="importacao.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const [entidadeChave, setEntidadeChave] = React.useState("");
  const [empresaId, setEmpresaId] = React.useState<string | null>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [resultado, setResultado] = React.useState<Resultado | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  const { data: entidades, isLoading } = useQuery({
    queryKey: ["importacao", "entidades"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Entidade[]>("/admin/importacao/entidades", { token: token! }),
  });

  // Poucas empresas por conta — um select simples basta e é mais rápido que
  // um combobox com busca no servidor.
  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas");

  const entidade = entidades?.find((e) => e.chave === entidadeChave) ?? null;

  async function baixarModelo() {
    if (!entidadeChave) return;
    try {
      const r = await fetch(`${apiBaseUrl}/admin/importacao/${entidadeChave}/modelo`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Não consegui gerar o modelo.");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelo-${entidadeChave}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Não consegui baixar o modelo", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  async function analisar(file: File, mapa?: Record<string, number>) {
    if (!token || !entidadeChave) return;
    setOcupado(true);
    setErro(null);
    setResultado(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("entidade", entidadeChave);
      if (mapa) fd.append("mapa", JSON.stringify(mapa));
      setPrevia(
        await fetchApi<Previa>("/admin/importacao/analisar", {
          token,
          method: "POST",
          body: fd,
        }),
      );
    } catch (e) {
      setPrevia(null);
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!token || !previa) return;
    setOcupado(true);
    setErro(null);
    try {
      setResultado(
        await fetchApi<Resultado>("/admin/importacao/aplicar", {
          token,
          method: "POST",
          body: JSON.stringify({
            entidade: previa.entidade,
            empresaId: empresaId ?? undefined,
            linhas: previa.linhas,
          }),
        }),
      );
      setPrevia(null);
      setArquivo(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function trocarColuna(campo: string, indice: number | null) {
    if (!previa || !arquivo) return;
    const mapa = { ...previa.mapa };
    if (indice === null) delete mapa[campo];
    else mapa[campo] = indice;
    void analisar(arquivo, mapa);
  }

  const precisaEmpresa = entidadeChave === "clientes";
  const podeAplicar =
    previa != null &&
    previa.resumo.prontas > 0 &&
    previa.faltando.length === 0 &&
    (!precisaEmpresa || empresaId != null);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Importar dados</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Traga a base que a empresa já tem. O sistema lê a planilha do jeito que ela está —
          título, logo e linha em branco no topo não atrapalham — e mostra o que entraria
          antes de gravar qualquer coisa. A lista abaixo está na ordem da implantação:
          as viagens vêm por último porque cada uma aponta pros cadastros.
        </p>
      </header>

      {isLoading && <LoadingCard />}

      <Card className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="imp-entidade">1. O que você vai importar</Label>
          <Select
            id="imp-entidade"
            value={entidadeChave}
            onChange={(e) => {
              setEntidadeChave(e.target.value);
              setPrevia(null);
              setResultado(null);
              setArquivo(null);
            }}
          >
            <option value="">Selecione…</option>
            {(entidades ?? []).map((e) => (
              <option key={e.chave} value={e.chave}>
                {e.rotulo}
              </option>
            ))}
          </Select>
          {entidade && (
            <p className="max-w-prose text-sm text-muted-foreground">{entidade.descricao}</p>
          )}
        </div>

        {entidade && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Colunas que o sistema reconhece</p>
            <div className="flex flex-wrap gap-1.5">
              {entidade.campos.map((c) => (
                <Badge
                  key={c.chave}
                  className={`border-transparent ${
                    c.obrigatorio ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"
                  }`}
                  title={[c.ajuda, `também aceita: ${c.exemplos.join(", ")}`]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {c.rotulo}
                  {c.obrigatorio ? " *" : ""}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Os nomes não precisam ser exatos: “Razão Social”, “Município”, “Placa do
              veículo” são reconhecidos. O que ficar errado você corrige na próxima tela.
            </p>
            {/* Aceitar vários nomes de coluna resolve o arquivo que o cliente
                JÁ tem. Não resolvia o caso mais comum: ele não ter arquivo
                nenhum e não saber por onde começar. */}
            <Button variant="outline" size="sm" onClick={() => void baixarModelo()}>
              <Download className="mr-1 h-4 w-4" /> Baixar planilha modelo
            </Button>
          </div>
        )}

        {/* Empresa é PARTE do cliente no modelo — sem ela o registro não existe.
            Perguntar aqui é melhor que aceitar o arquivo e falhar em cada linha. */}
        {precisaEmpresa && (
          <div className="space-y-1.5">
            <Label htmlFor="imp-empresa">2. De qual cliente são essas obras</Label>
            <Select
              id="imp-empresa"
              value={empresaId ?? ""}
              onChange={(e) => setEmpresaId(e.target.value || null)}
            >
              <option value="">Selecione…</option>
              {(empresas.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </Select>
          </div>
        )}

        {entidadeChave && (!precisaEmpresa || empresaId) && (
          <div className="space-y-1.5">
            <Label htmlFor="imp-arquivo">
              {precisaEmpresa ? "3." : "2."} A planilha (.xlsx ou .csv)
            </Label>
            <input
              id="imp-arquivo"
              type="file"
              accept=".xlsx,.xlsm,.csv,text/csv"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setArquivo(f);
                  void analisar(f);
                }
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
            />
          </div>
        )}

        {ocupado && <LoadingCard label="Lendo a planilha…" compact />}

        {erro && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{erro}</p>
          </div>
        )}
      </Card>

      {resultado && (
        <Card className="space-y-2 border-emerald-300 bg-emerald-50/50 p-4">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-600" />
            <p className="font-semibold">
              {resultado.criados} criados · {resultado.atualizados} atualizados
              {resultado.ignorados > 0 ? ` · ${resultado.ignorados} ignorados` : ""}
            </p>
          </div>
          {resultado.avisos.map((a) => (
            <p key={a} className="text-sm text-muted-foreground">
              {a}
            </p>
          ))}
          <p className="text-sm text-muted-foreground">
            Pode subir a mesma planilha de novo depois de corrigir: o sistema atualiza o que
            já existe em vez de duplicar.
          </p>
        </Card>
      )}

      {previa && entidade && (
        <Previsao
          previa={previa}
          entidade={entidade}
          onTrocarColuna={trocarColuna}
          onAplicar={aplicar}
          podeAplicar={podeAplicar}
          ocupado={ocupado}
        />
      )}
    </div>
  );
}

function Previsao({
  previa,
  entidade,
  onTrocarColuna,
  onAplicar,
  podeAplicar,
  ocupado,
}: {
  previa: Previa;
  entidade: Entidade;
  onTrocarColuna: (campo: string, indice: number | null) => void;
  onAplicar: () => void;
  podeAplicar: boolean;
  ocupado: boolean;
}) {
  const comErro = previa.linhas.filter((l) => l.erros.length > 0);
  const amostra = previa.linhas.filter((l) => l.erros.length === 0).slice(0, 10);

  return (
    <>
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          <p className="font-semibold">{previa.arquivo}</p>
          <span className="text-sm text-muted-foreground">
            aba “{previa.aba}” · cabeçalho na linha {previa.linhaCabecalho + 1}
          </span>
        </div>

        <div className="flex flex-wrap gap-4">
          <Numero rotulo="Prontas" valor={previa.resumo.prontas} destaque />
          <Numero rotulo="Com erro" valor={previa.resumo.comErro} />
          <Numero rotulo="Repetidas no arquivo" valor={previa.resumo.duplicadasNoArquivo} />
        </div>

        {/* Sem ticket, o sistema ainda separa duas viagens iguais do mesmo dia
            (contador por assinatura), mas subir a planilha com as linhas em
            outra ordem duplicaria o histórico. Dizer isso antes é barato. */}
        {previa.entidade === "viagens" && previa.mapa.ticket === undefined && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm">
              Sua planilha não tem a coluna de ticket/nota. Dá pra importar assim, mas se
              você subir o arquivo de novo com as linhas em outra ordem, o histórico
              duplica. Se existir uma coluna com o número do romaneio, aponte ela abaixo.
            </p>
          </div>
        )}

        {/* O automático é atalho, nunca a única porta: quando o palpite erra,
            trocar a coluna aqui é mais rápido que mexer na planilha. */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Como as colunas foram entendidas</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {entidade.campos.map((c) => {
              const faltando = previa.faltando.includes(c.chave);
              return (
                <div key={c.chave} className="flex items-center gap-2">
                  <span
                    className={`w-40 shrink-0 text-sm ${faltando ? "font-semibold text-destructive" : ""}`}
                  >
                    {c.rotulo}
                    {c.obrigatorio ? " *" : ""}
                  </span>
                  <Select
                    value={previa.mapa[c.chave] ?? ""}
                    onChange={(e) =>
                      onTrocarColuna(c.chave, e.target.value === "" ? null : Number(e.target.value))
                    }
                  >
                    <option value="">— não importar —</option>
                    {previa.cabecalho.map((h, i) => (
                      <option key={i} value={i}>
                        {String(h ?? `coluna ${i + 1}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
          {previa.faltando.length > 0 && (
            <p className="text-sm text-destructive">
              Aponte as colunas obrigatórias acima pra poder importar.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onAplicar} disabled={!podeAplicar || ocupado} variant="success">
            <Upload className="h-4 w-4" />
            Importar {previa.resumo.prontas}{" "}
            {previa.resumo.prontas === 1 ? "registro" : "registros"}
          </Button>
          <span className="text-sm text-muted-foreground">
            As linhas com erro ficam de fora — nada é gravado pela metade.
          </span>
        </div>
      </Card>

      {amostra.length > 0 && (
        <Card className="space-y-2 p-4">
          <p className="text-sm font-medium">As primeiras que vão entrar</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Linha</th>
                  {entidade.campos.map((c) => (
                    <th key={c.chave} className="py-1 pr-3 font-medium">
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {amostra.map((l) => (
                  <tr key={l.numero} className="border-b last:border-0">
                    <td className="py-1 pr-3 tabular-nums text-muted-foreground">{l.numero}</td>
                    {entidade.campos.map((c) => (
                      <td key={c.chave} className="py-1 pr-3">
                        {l.valores[c.chave] !== undefined ? String(l.valores[c.chave]) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {comErro.length > 0 && (
        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium">
              {comErro.length} {comErro.length === 1 ? "linha ficou" : "linhas ficaram"} de fora
            </p>
          </div>
          {/* O número da linha é o da planilha: é assim que ele acha e corrige. */}
          <ul className="space-y-1 text-sm text-muted-foreground">
            {comErro.slice(0, 30).map((l) => (
              <li key={l.numero}>
                <span className="tabular-nums font-medium text-foreground">
                  Linha {l.numero}:
                </span>{" "}
                {l.erros.map((e) => e.mensagem).join(" · ")}
              </li>
            ))}
          </ul>
          {comErro.length > 30 && (
            <p className="text-sm text-muted-foreground">
              …e mais {comErro.length - 30}. Corrija a planilha e suba de novo.
            </p>
          )}
        </Card>
      )}
    </>
  );
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={`tabular-nums text-2xl font-bold ${destaque ? "text-emerald-600" : "text-foreground"}`}
      >
        {valor}
      </p>
    </div>
  );
}
