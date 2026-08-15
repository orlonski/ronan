"use client";

import { useRef, useState } from "react";
import { Building2, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RequerTela } from "@/components/requer-tela";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { StatusToggle } from "@/components/status-toggle";

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
    if (!confirm("Gerar um código novo? O atual para de funcionar imediatamente.")) return;
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
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Building2 className="h-5 w-5" />
          Minha empresa
        </h1>
        <p className="text-sm text-muted-foreground">
          A logo aparece no menu do painel, pra quem trabalha aqui dentro.
        </p>
      </div>

      <Card className="max-w-xl space-y-4 p-5">
        <div>
          <p className="text-sm font-medium">{conta?.nome ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Nome exibido no painel.</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Logo</p>
          <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed bg-muted/30 p-4">
            {conta?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API_URL}${conta.logoUrl}`}
                alt={conta.nome}
                className="max-h-16 object-contain"
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
        </div>

        <div className="space-y-2 rounded-md border bg-muted/20 p-4">
          <p className="text-sm font-medium">Código para os motoristas se cadastrarem</p>
          <p className="font-mono text-lg tracking-wider">{conta?.codigoConvite ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            Passe este código para os seus motoristas. Eles digitam no app ao criar a conta, e é
            assim que o cadastro chega até você — sem ele, ninguém entra. Ele só direciona: o
            motorista continua aparecendo aqui para você aprovar.
          </p>
          <Button variant="outline" size="sm" onClick={trocarCodigo} disabled={enviando}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Gerar um código novo
          </Button>
          <p className="text-xs text-muted-foreground">
            Ao gerar um novo, o antigo para de funcionar na hora. Use se ele foi parar em quem não
            devia.
          </p>
        </div>

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

      <ComprovantesCard />
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
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <p className="text-sm font-medium">Comprovantes</p>
        <p className="text-xs text-muted-foreground">
          Quando ligado, o app não deixa o motorista salvar sem a foto. Se ele não
          conseguir fotografar, precisa escrever o motivo — e o lançamento aparece na
          lista marcado como “sem foto”, pra você cobrar.
        </p>
      </div>

      <div className="space-y-1">
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
          Material marcado como “não gera comprovante” (ex.: concreto) e diária ficam de
          fora sozinhos — não dá pra cobrar foto de papel que não existe.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Foto do cupom no abastecimento</span>
        <StatusToggle
          active={config.data?.exigeFotoAbastecimento ?? false}
          onChange={(next) => salvar.mutate({ exigeFotoAbastecimento: next })}
          size="sm"
          disabled={config.isLoading || salvar.isPending}
        />
      </div>
    </Card>
  );
}
