"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RequerTela } from "@/components/requer-tela";
import { AbasMinhaEmpresa } from "@/components/abas-minha-empresa";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { StatusToggle } from "@/components/status-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const PATH_MINHA_EMPRESA = "/admin/minha-empresa";

/**
 * A empresa mexendo na marca dela. Só a logo por enquanto — cor mexeria em
 * contraste e tema escuro, que merece cuidado próprio.
 */
export default function MinhaEmpresaPage() {
  return (
    <RequerTela chave="minha-empresa.editar">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const { confirmar, ConfirmDialog } = useConfirm();
  const { conta } = usePermissoes();
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function recarregar() {
    // O nome e a logo vêm do /me, que é a fonte do painel inteiro.
    await queryClient.invalidateQueries({ queryKey: ["/admin/users/me"] });
  }

  async function enviar(arquivo: File) {
    if (arquivo.size > 2 * 1024 * 1024) {
      toast.error("A logo precisa ter no máximo 2 MB.");
      return;
    }
    setEnviando(true);
    try {
      const form = new FormData();
      form.append("logo", arquivo);
      await fetchApi("/admin/minha-empresa/logo", { method: "POST", token, body: form });
      toast.success("Logo atualizada.");
      await recarregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui enviar a logo.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function trocarCodigo() {
    const ok = await confirmar({
      variant: "destructive",
      title: "Gerar um código de convite novo?",
      description: "O código atual para de funcionar na hora. Quem ainda não entrou com ele vai precisar do novo.",
      confirmLabel: "Gerar código novo",
      cancelLabel: "Manter o atual",
    });
    if (!ok) return;
    setEnviando(true);
    try {
      await fetchApi("/admin/minha-empresa/codigo-convite", { method: "POST", token });
      toast.success("Código novo gerado. Passe o novo para os motoristas.");
      await recarregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui gerar o código.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    setEnviando(true);
    try {
      await fetchApi("/admin/minha-empresa/logo", { method: "DELETE", token });
      toast.success("Logo removida.");
      await recarregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui remover.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ConfirmDialog />
      <AbasMinhaEmpresa />
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Building2 className="h-5 w-5" />
          Minha empresa
        </h1>
        <p className="text-sm text-muted-foreground">
          Tudo da sua transportadora num lugar: marca, código dos motoristas, comprovantes, dados fiscais, emissor de CT-e e contrato.
        </p>
      </div>

      {/* Logo e código lado a lado: eram um cartão estreito só, e a tela
          parecia minúscula ao lado da identidade fiscal, que usa a largura
          toda (o dono reparou em 23/09/2026). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div>
            <p className="text-sm font-medium">Logo</p>
            <p className="text-xs text-muted-foreground">
              Aparece no menu do painel de <strong>{conta?.nome ?? "—"}</strong>.
            </p>
          </div>
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed bg-muted/30 p-4">
            {conta?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API_URL}${conta.logoUrl}`}
                alt={conta.nome}
                className="max-h-20 object-contain"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma logo enviada — o painel mostra a marca padrão.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG ou WEBP, até 2 MB. Fundo transparente fica melhor: o menu muda de cor
            entre o tema claro e o escuro.
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                if (arquivo) void enviar(arquivo);
              }}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={enviando}>
              <Upload className="mr-2 h-4 w-4" />
              {enviando ? "Enviando…" : conta?.logoUrl ? "Trocar logo" : "Enviar logo"}
            </Button>
            {conta?.logoUrl && (
              <Button variant="outline" onClick={remover} disabled={enviando}>
                <Trash2 className="mr-2 h-4 w-4" />
                Remover
              </Button>
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <p className="text-sm font-medium">Código para os motoristas se cadastrarem</p>
            <p className="text-xs text-muted-foreground">
              Passe este código para os seus motoristas. Eles digitam no app ao criar a conta, e
              é assim que o cadastro chega até você — sem ele, ninguém entra. Ele só direciona:
              o motorista continua aparecendo aqui para você aprovar.
            </p>
          </div>
          <div className="flex min-h-28 items-center justify-center rounded-md border bg-muted/20 p-4">
            <p className="font-mono text-2xl tracking-widest">{conta?.codigoConvite ?? "—"}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Ao gerar um novo, o antigo para de funcionar na hora. Use se ele foi parar em quem
            não devia.
          </p>
          <Button variant="outline" onClick={trocarCodigo} disabled={enviando}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Gerar um código novo
          </Button>
        </Card>
      </div>

      <ComprovantesCard />
      <IdentidadeFiscalCard />
    </div>
  );
}

/**
 * Regras de comprovante da transportadora — política DELA, não da contraparte.
 *
 * Mora aqui e não em Cadastros → Empresas de propósito: "Empresa" ali é a
 * pedreira/obra que manda ou recebe planilha de fechamento. As duas se chamando
 * "empresa" já confundiu uma vez.
 */
function ComprovantesCard() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: [PATH_MINHA_EMPRESA],
    enabled: !!token,
    queryFn: () =>
      fetchApi<{ exigeFotoViagem: boolean; exigeFotoAbastecimento: boolean }>(
        PATH_MINHA_EMPRESA,
        { token },
      ),
  });

  const salvar = useMutation({
    mutationFn: (body: Record<string, boolean>) =>
      fetchApi(PATH_MINHA_EMPRESA, {
        method: "PATCH",
        token,
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [PATH_MINHA_EMPRESA] });
      toast.success("Regra salva.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui salvar."),
  });

  return (
    <Card className="space-y-4 p-5">
      <div>
        <p className="text-sm font-medium">Comprovantes</p>
        <p className="text-xs text-muted-foreground">
          Quando ligado, o app não deixa o motorista salvar sem a foto. Se ele não
          conseguir fotografar, precisa escrever o motivo — e o lançamento aparece na
          lista marcado como “sem foto”, pra você cobrar.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1 rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Foto do ticket na viagem</span>
            <StatusToggle
              active={config.data?.exigeFotoViagem ?? false}
              onChange={(next) => salvar.mutate({ exigeFotoViagem: next })}
              size="sm"
              disabled={config.isLoading || salvar.isPending}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Material marcado como “não gera comprovante” (ex.: concreto) e modo de
            serviço sem ticket ficam de fora sozinhos — não dá pra cobrar foto de
            papel que não existe.
          </p>
        </div>

        <div className="space-y-1 rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Foto do cupom no abastecimento</span>
            <StatusToggle
              active={config.data?.exigeFotoAbastecimento ?? false}
              onChange={(next) => salvar.mutate({ exigeFotoAbastecimento: next })}
              size="sm"
              disabled={config.isLoading || salvar.isPending}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            O cupom do posto, com litros e valor. Sem ele o abastecimento chega só com o
            que o motorista digitou.
          </p>
        </div>
      </div>
    </Card>
  );
}

type Fiscal = {
  cnpj: string | null;
  razaoSocial: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  crt: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  codigoMunicipioIbge: string | null;
  uf: string | null;
  telefoneFiscal: string | null;
  rntrc: string | null;
  tipoTransportador: string | null;
};

const CAMPOS: { chave: keyof Fiscal; rotulo: string; dica?: string; largura?: string }[] = [
  { chave: "cnpj", rotulo: "CNPJ", largura: "sm:col-span-2" },
  { chave: "razaoSocial", rotulo: "Razão social", largura: "sm:col-span-4" },
  { chave: "inscricaoEstadual", rotulo: "Inscrição estadual", largura: "sm:col-span-2" },
  { chave: "inscricaoMunicipal", rotulo: "Inscrição municipal", largura: "sm:col-span-2" },
  { chave: "rntrc", rotulo: "RNTRC", dica: "Registro na ANTT", largura: "sm:col-span-2" },
  { chave: "logradouro", rotulo: "Logradouro", largura: "sm:col-span-4" },
  { chave: "numero", rotulo: "Número", largura: "sm:col-span-1" },
  { chave: "complemento", rotulo: "Complemento", largura: "sm:col-span-1" },
  { chave: "bairro", rotulo: "Bairro", largura: "sm:col-span-2" },
  { chave: "cep", rotulo: "CEP", largura: "sm:col-span-2" },
  { chave: "municipio", rotulo: "Município", largura: "sm:col-span-2" },
  {
    chave: "codigoMunicipioIbge",
    rotulo: "Código IBGE do município",
    dica: "7 números. O CT-e não aceita município por nome.",
    largura: "sm:col-span-2",
  },
  { chave: "telefoneFiscal", rotulo: "Telefone", largura: "sm:col-span-2" },
];

/**
 * A identidade fiscal da empresa.
 *
 * Estes campos existiam no banco desde a fase 0 e nunca tiveram tela: dava pra
 * guardá-los e não dava pra preenchê-los. A tela de emissão de CT-e mandava o
 * usuário procurar aqui o que não estava aqui.
 *
 * Moram nesta tela, e não na do CT-e, porque são da EMPRESA — o CT-e é só o
 * primeiro a precisar deles; o MDF-e e o que vier depois usam os mesmos.
 */
function IdentidadeFiscalCard() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<Fiscal>>({});

  const dados = useQuery({
    queryKey: [PATH_MINHA_EMPRESA],
    enabled: !!token,
    queryFn: () => fetchApi<Fiscal>(PATH_MINHA_EMPRESA, { token }),
  });

  useEffect(() => {
    if (dados.data) setForm(dados.data);
  }, [dados.data]);

  const salvar = useMutation({
    mutationFn: (body: Partial<Fiscal>) =>
      fetchApi(PATH_MINHA_EMPRESA, { method: "PATCH", token, body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [PATH_MINHA_EMPRESA] });
      toast.success("Dados fiscais salvos.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui salvar."),
  });

  const v = { ...dados.data, ...form } as Fiscal;
  const set = (k: keyof Fiscal, valor: string) => setForm((f) => ({ ...f, [k]: valor }));

  return (
    <Card className="space-y-4 p-5">
      <div>
        <p className="text-sm font-medium">Identidade fiscal</p>
        <p className="max-w-prose text-xs text-muted-foreground">
          Quem a empresa é para o fisco. É daqui que saem os dados do emitente no CT-e —
          e, mais pra frente, no MDF-e. Só precisa preencher quem vai emitir documento
          fiscal pelo sistema.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {CAMPOS.map((c) => (
          <div key={c.chave} className={`space-y-1.5 ${c.largura ?? "sm:col-span-2"}`}>
            <Label htmlFor={c.chave}>{c.rotulo}</Label>
            <Input
              id={c.chave}
              // Sem isto o Chrome enfia e-mail e endereço salvos em campo de
              // texto livre — já aconteceu na tela do CT-e.
              autoComplete="off"
              value={v[c.chave] ?? ""}
              onChange={(e) => set(c.chave, e.target.value)}
            />
            {c.dica && <p className="text-xs text-muted-foreground">{c.dica}</p>}
          </div>
        ))}

        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="uf">UF</Label>
          <Input
            id="uf"
            autoComplete="off"
            maxLength={2}
            value={v.uf ?? ""}
            onChange={(e) => set("uf", e.target.value.toUpperCase())}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="crt">Regime tributário</Label>
          <Select id="crt" value={v.crt ?? ""} onChange={(e) => set("crt", e.target.value)}>
            <option value="">Selecione…</option>
            <option value="1">1 — Simples Nacional</option>
            <option value="2">2 — Simples, com excesso de sublimite</option>
            <option value="3">3 — Regime Normal</option>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="tipoTransp">Tipo</Label>
          <Select
            id="tipoTransp"
            value={v.tipoTransportador ?? ""}
            onChange={(e) => set("tipoTransportador", e.target.value)}
          >
            <option value="">Selecione…</option>
            <option value="ETC">ETC — empresa</option>
            <option value="CTC">CTC — cooperativa</option>
            <option value="TAC">TAC — autônomo</option>
          </Select>
        </div>
      </div>

      <Button
        onClick={() => salvar.mutate(form)}
        disabled={salvar.isPending || dados.isLoading}
        variant="success"
      >
        {salvar.isPending ? "Salvando…" : "Salvar dados fiscais"}
      </Button>
    </Card>
  );
}
