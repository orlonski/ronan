"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleAlert, FlaskConical, Radio, ShieldCheck } from "lucide-react";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Certificado = {
  cnpj: string | null;
  titular: string;
  validoDe: string;
  validoAte: string;
  diasParaVencer: number;
  vencido: boolean;
} | null;

type Config = {
  cnpj: string | null;
  razaoSocial: string | null;
  inscricaoEstadual: string | null;
  crt: string | null;
  rntrc: string | null;
  uf: string | null;
  municipio: string | null;
  codigoMunicipioIbge: string | null;
  cteEmissor: string | null;
  cteAmbiente: number | null;
  cteSerie: number | null;
  cteNaturezaCfop: string | null;
  cteNaturezaOperacao: string | null;
  cteIcmsTipo: string | null;
  cteIcmsAliquota: number | null;
  cteIcmsReducao: number | null;
  cteIcmsCst: string | null;
  cteUfAutorizador: string | null;
  cteGatewayUrl: string | null;
  gatewayTemToken: boolean;
  proximoNumero: number;
  pendencias: string[];
};

export default function ConfigCtePage() {
  return (
    <RequerTela chave="cte.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [form, setForm] = React.useState<Partial<Config> & { cteGatewayToken?: string }>({});
  const [salvando, setSalvando] = React.useState(false);
  const [senhaCert, setSenhaCert] = React.useState("");
  const [subindo, setSubindo] = React.useState(false);
  const [testando, setTestando] = React.useState(false);
  const [conexao, setConexao] = React.useState<{ ok: boolean; motivo: string | null } | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  async function subirCertificado(file: File) {
    if (!token) return;
    if (!senhaCert) {
      toast.error("Informe a senha do certificado antes de escolher o arquivo.");
      return;
    }
    setSubindo(true);
    try {
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("senha", senhaCert);
      await fetchApi("/admin/cte/certificado", { token, method: "POST", body: fd });
      await qc.invalidateQueries({ queryKey: ["cte", "certificado"] });
      setSenhaCert("");
      toast.success("Certificado guardado.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubindo(false);
    }
  }

  async function testar() {
    if (!token) return;
    setTestando(true);
    setConexao(null);
    try {
      setConexao(
        await fetchApi<{ ok: boolean; motivo: string | null }>("/admin/cte/testar-conexao", {
          token,
          method: "POST",
        }),
      );
    } catch (e) {
      setConexao({ ok: false, motivo: (e as Error).message });
    } finally {
      setTestando(false);
    }
  }

  const cert = useQuery({
    queryKey: ["cte", "certificado"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Certificado>("/admin/cte/certificado", { token: token! }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["cte", "config"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Config>("/admin/cte/config", { token: token! }),
  });

  React.useEffect(() => {
    if (data) setForm({ ...data, cteGatewayToken: "" });
  }, [data]);

  const v = { ...data, ...form } as Config & { cteGatewayToken?: string };
  const set = (k: string, valor: unknown) => setForm((f) => ({ ...f, [k]: valor }));

  async function salvar() {
    if (!token) return;
    setSalvando(true);
    try {
      await fetchApi("/admin/cte/config", {
        token,
        method: "PATCH",
        body: JSON.stringify({
          cteEmissor: v.cteEmissor ?? "SIMULADOR",
          cteAmbiente: Number(v.cteAmbiente ?? 2),
          cteSerie: Number(v.cteSerie ?? 1),
          cteNaturezaCfop: v.cteNaturezaCfop || null,
          cteNaturezaOperacao: v.cteNaturezaOperacao || null,
          cteIcmsTipo: v.cteIcmsTipo || null,
          cteIcmsAliquota: v.cteIcmsAliquota ?? null,
          cteIcmsReducao: v.cteIcmsReducao ?? null,
          cteIcmsCst: v.cteIcmsCst || null,
          cteUfAutorizador: v.cteUfAutorizador || null,
          cteGatewayUrl: v.cteGatewayUrl || null,
          // Em branco = não mexi. O servidor nunca devolve o token, então
          // mandar vazio apagaria a credencial de quem só trocou a série.
          ...(form.cteGatewayToken ? { cteGatewayToken: form.cteGatewayToken } : {}),
        }),
      });
      await qc.invalidateQueries({ queryKey: ["cte", "config"] });
      setForm((f) => ({ ...f, cteGatewayToken: "" }));
      toast.success("Configuração salva.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (isLoading || !data) return <LoadingCard />;

  const producao = Number(v.cteAmbiente) === 1;
  const gateway = v.cteEmissor === "GATEWAY";
  const direto = v.cteEmissor === "SEFAZ";
  const destacaIcms = ["00", "20", "90"].includes(String(v.cteIcmsTipo));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurar emissor de CT-e</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          O CT-e modelo 57, rodoviário. O sistema monta, valida e numera; quem assina e
          manda pra SEFAZ é o emissor escolhido abaixo.
        </p>
      </header>

      {/* Dizer o que falta, em lista, é o que evita o usuário descobrir campo a
          campo na primeira tentativa de emitir. */}
      {v.pendencias.length > 0 && (
        <Card className="space-y-2 border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-amber-600" />
            <p className="font-medium">Ainda não dá pra emitir. Falta:</p>
          </div>
          <ul className="ml-6 list-disc space-y-0.5 text-sm text-muted-foreground">
            {v.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Os dados da empresa ficam em{" "}
            <Link href="/configuracoes/empresa" className="underline">
              Minha empresa
            </Link>
            .
          </p>
        </Card>
      )}

      <Card className="space-y-5 p-4">
        <div className="space-y-2">
          <Label htmlFor="emissor">Por onde emitir</Label>
          <Select
            id="emissor"
            value={v.cteEmissor ?? "SIMULADOR"}
            onChange={(e) => set("cteEmissor", e.target.value)}
          >
            <option value="SIMULADOR">Simulador — local, sem certificado</option>
            <option value="SEFAZ">Direto na SEFAZ — nós assinamos</option>
            <option value="GATEWAY">Gateway — um provedor assina por nós</option>
          </Select>
          <p className="text-sm text-muted-foreground">
            {direto
              ? "O sistema assina o XML com o certificado da empresa e fala com o autorizador do estado. Sem mensalidade de intermediário — em troca, somos nós que acompanhamos as notas técnicas da SEFAZ."
              : gateway
                ? "O documento sai daqui pro provedor, que assina com o certificado e manda pra SEFAZ."
                : "Nada sai desta máquina. O simulador refaz as conferências que dependem só do documento — o dígito da chave e a soma dos componentes — e responde no mesmo formato da SEFAZ. Serve pra provar que tudo depois da emissão funciona."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ambiente">Ambiente</Label>
            <Select
              id="ambiente"
              value={String(v.cteAmbiente ?? 2)}
              onChange={(e) => set("cteAmbiente", Number(e.target.value))}
            >
              <option value="2">Homologação — sem valor fiscal</option>
              <option value="1">Produção — vale de verdade</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="serie">Série</Label>
            <Input
              id="serie"
              inputMode="numeric"
              value={String(v.cteSerie ?? 1)}
              onChange={(e) => set("cteSerie", e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-2">
            <Label>Próximo número</Label>
            <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 tabular-nums">
              {v.proximoNumero}
            </div>
          </div>
        </div>

        {/* Produção é o único lugar onde um erro custa dinheiro de verdade.
            Dizer isso na tela é mais barato que descobrir emitindo. */}
        {producao && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <Radio className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              Em produção cada CT-e autorizado é documento fiscal de verdade: entra na
              apuração e só sai por cancelamento, que tem prazo. Só mude pra cá depois de
              o contador conferir CFOP, CST e alíquota abaixo.
            </p>
          </div>
        )}

        {!producao && v.cteEmissor === "SIMULADOR" && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nível 1. Os documentos emitidos aqui existem só neste banco — não estão na
              SEFAZ e nunca estiveram.
            </p>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold">O que o contador define</h2>
          <p className="text-sm text-muted-foreground">
            O sistema não escolhe tributo. Chutar uma alíquota produz um documento que a
            SEFAZ autoriza e que está errado — e errado em imposto só aparece na
            fiscalização.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cfop">Natureza do CFOP</Label>
            <Input
              id="cfop"
              inputMode="numeric"
              maxLength={3}
              placeholder="353"
              value={v.cteNaturezaCfop ?? ""}
              onChange={(e) => set("cteNaturezaCfop", e.target.value.replace(/\D/g, ""))}
            />
            <p className="text-xs text-muted-foreground">
              Só os 3 últimos dígitos. O 5 (dentro do estado) ou 6 (interestadual) o sistema
              põe pela UF de carga e de descarga — que é o dígito que mais erra na mão.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="natop">Natureza da operação</Label>
            <Input
              id="natop"
              maxLength={60}
              placeholder="PRESTACAO DE SERVICO DE TRANSPORTE"
              value={v.cteNaturezaOperacao ?? ""}
              onChange={(e) => set("cteNaturezaOperacao", e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="icms">ICMS</Label>
            <Select
              id="icms"
              value={v.cteIcmsTipo ?? ""}
              onChange={(e) => set("cteIcmsTipo", e.target.value)}
            >
              <option value="">Selecione…</option>
              <option value="SN">Simples Nacional — sem destaque</option>
              <option value="00">Tributada integralmente (CST 00)</option>
              <option value="20">Com redução de base (CST 20)</option>
              <option value="45">Isenta / não tributada / diferida</option>
              <option value="60">ICMS cobrado por ST (CST 60)</option>
              <option value="90">Outros (CST 90)</option>
            </Select>
          </div>
          {destacaIcms && (
            <div className="space-y-2">
              <Label htmlFor="aliq">Alíquota (%)</Label>
              <Input
                id="aliq"
                inputMode="decimal"
                value={v.cteIcmsAliquota ?? ""}
                onChange={(e) => set("cteIcmsAliquota", Number(e.target.value.replace(",", ".")))}
              />
            </div>
          )}
          {["20", "90"].includes(String(v.cteIcmsTipo)) && (
            <div className="space-y-2">
              <Label htmlFor="red">Redução de base (%)</Label>
              <Input
                id="red"
                inputMode="decimal"
                value={v.cteIcmsReducao ?? ""}
                onChange={(e) => set("cteIcmsReducao", Number(e.target.value.replace(",", ".")))}
              />
            </div>
          )}
          {v.cteIcmsTipo === "45" && (
            <div className="space-y-2">
              <Label htmlFor="cst">Situação</Label>
              <Select
                id="cst"
                value={v.cteIcmsCst ?? "41"}
                onChange={(e) => set("cteIcmsCst", e.target.value)}
              >
                <option value="40">40 — Isenta</option>
                <option value="41">41 — Não tributada</option>
                <option value="51">51 — Diferimento</option>
              </Select>
            </div>
          )}
        </div>

        {/* O cruzamento que evita o pior erro de cadastro: empresa do Simples
            destacando imposto que não recolheu, e o tomador creditando. */}
        {v.crt === "1" && destacaIcms && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              A empresa está no Simples Nacional e esta regra destaca ICMS. No Simples o
              CT-e sai sem destaque — o tomador creditaria um imposto que não foi recolhido.
              A emissão vai ser barrada assim.
            </p>
          </div>
        )}
      </Card>

      {direto && (
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Certificado digital (A1)</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              É ele que assina o documento — e é ele também que a SEFAZ exige na própria
              conexão. Fica guardado cifrado, com a chave fora do banco: um backup do banco
              sozinho não serve pra assinar nada.
            </p>
          </div>

          {cert.data ? (
            <div
              className={`rounded-md border p-3 ${
                cert.data.vencido
                  ? "border-destructive/40 bg-destructive/5"
                  : cert.data.diasParaVencer < 30
                    ? "border-amber-300 bg-amber-50"
                    : "border-emerald-300 bg-emerald-50/50"
              }`}
            >
              <p className="font-medium">{cert.data.titular}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {cert.data.cnpj ? `CNPJ ${cert.data.cnpj} · ` : ""}
                válido até {new Date(cert.data.validoAte).toLocaleDateString("pt-BR")}
                {cert.data.vencido
                  ? " — VENCIDO"
                  : ` (${cert.data.diasParaVencer} dias)`}
              </p>
              {/* Avisar antes é o que evita a emissão parar num dia qualquer:
                  certificado vence sem avisar ninguém. */}
              {!cert.data.vencido && cert.data.diasParaVencer < 30 && (
                <p className="mt-1 text-sm font-medium text-amber-800">
                  Renove agora. No dia em que vencer, a emissão para.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum certificado cadastrado.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="senha-cert">Senha do certificado</Label>
              <Input
                id="senha-cert"
                type="password"
                autoComplete="off"
                value={senhaCert}
                onChange={(e) => setSenhaCert(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="arq-cert">Arquivo .pfx</Label>
              <input
                id="arq-cert"
                ref={arquivoRef}
                type="file"
                accept=".pfx,.p12"
                disabled={subindo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirCertificado(f);
                  e.target.value = "";
                }}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O CNPJ, o titular e a validade são lidos do próprio arquivo — nada disso é
            digitado. Se o CNPJ não bater com o da empresa, o sistema recusa.
          </p>

          <div className="space-y-2">
            <div className="space-y-2">
              <Label htmlFor="uf-aut">UF do autorizador</Label>
              <Select
                id="uf-aut"
                value={v.cteUfAutorizador ?? v.uf ?? ""}
                onChange={(e) => set("cteUfAutorizador", e.target.value)}
              >
                <option value="">Selecione…</option>
                <option value="PR">Paraná</option>
              </Select>
              <p className="text-xs text-muted-foreground">
                São oito autorizadores no país — a maioria dos estados delega pra SVRS. Hoje
                o sistema fala com o do Paraná; acrescentar outro é trabalho pequeno.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="outline" onClick={() => void testar()} disabled={testando}>
                <Radio className="h-4 w-4" />
                {testando ? "Testando…" : "Testar conexão com a SEFAZ"}
              </Button>
              {conexao && (
                <span
                  className={`text-sm ${conexao.ok ? "text-emerald-700" : "text-destructive"}`}
                >
                  {conexao.ok ? "Serviço em operação." : conexao.motivo}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              É a única chamada que não emite nada. Prova certificado, cadeia, credenciamento
              e rede de uma vez — antes de arriscar um CT-e e queimar um número da série.
            </p>
          </div>
        </Card>
      )}

      {gateway && (
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Gateway</h2>
            <p className="text-sm text-muted-foreground">
              Quem guarda o certificado A1 e fala com a SEFAZ. Em sandbox, muitos provedores
              aceitam sem certificado — é o nível 2. Apontando pra SEFAZ, é o nível 3.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="url">URL da API</Label>
            <Input
              id="url"
              placeholder="https://sandbox.provedor.com.br/v2"
              value={v.cteGatewayUrl ?? ""}
              onChange={(e) => set("cteGatewayUrl", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tok">Token</Label>
            <Input
              id="tok"
              type="password"
              autoComplete="off"
              placeholder={v.gatewayTemToken ? "••••••••  (já configurado)" : "cole o token aqui"}
              value={form.cteGatewayToken ?? ""}
              onChange={(e) => set("cteGatewayToken", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              O token nunca volta do servidor. Deixar em branco mantém o que já está lá.
            </p>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Permitido chave="cte.emitir">
          <Button onClick={() => void salvar()} disabled={salvando} variant="success">
            <ShieldCheck className="h-4 w-4" />
            {salvando ? "Salvando…" : "Salvar configuração"}
          </Button>
        </Permitido>
        <Link href="/cte" className="text-sm text-muted-foreground underline">
          Ver os CT-e emitidos
        </Link>
      </div>
    </div>
  );
}
