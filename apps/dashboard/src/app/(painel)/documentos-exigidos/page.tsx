"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  TIPOS_DOCUMENTO_MOTORISTA,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Exigido = {
  id: string;
  titulo: string;
  ajuda?: string | null;
  publico?: "MENSAL" | "TODOS";
  tipo: TipoDocumentoMotorista;
  empresaId: string | null;
  obrigatorio: boolean;
  exigeAssinatura: boolean;
  exigeIcpBrasil: boolean;
  ordem: number;
  ativo: boolean;
};

const PATH = "/admin/admissao/documentos-exigidos";

/**
 * O que cada contratante exige antes do caminhão entrar na obra.
 *
 * É catálogo, não constante, porque são vários contratantes e cada um pede uma
 * coisa — o próximo cliente não pode precisar de deploy pra começar a operar.
 *
 * ⚠️ O TÍTULO É TEXTO LIVRE, e isso é decisão, não preguiça. O sistema não
 * nomeia o documento: quem escreve é você, copiando o que o contratante pede.
 * Ter "NR" ou "ordem de serviço" fixo em código faria a plataforma parecer
 * emissora de documento de segurança do trabalho, que é obrigação de
 * empregador — e estes motoristas são parceiros autônomos. Nós transportamos
 * o arquivo; o nome e o conteúdo são requisito de quem exige.
 *
 * A "gaveta" é onde o arquivo fica guardado no cadastro do motorista, e é o
 * que faz o documento sair no pacote que vai pro contratante.
 */
export default function DocumentosExigidosPage() {
  return (
    <RequerTela chave="documentos-exigidos.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [criando, setCriando] = useState(false);

  const lista = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Exigido[]>(PATH, { token }),
  });

  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas");
  const nomeEmpresa = useMemo(() => {
    const m = new Map((empresas.data ?? []).map((e) => [e.id, e.nome]));
    return (id: string | null) => (id ? (m.get(id) ?? "Contratante") : "Todas as obras");
  }, [empresas.data]);

  const ativos = (lista.data ?? []).filter((e) => e.ativo);
  const gerais = ativos.filter((e) => !e.empresaId);
  const porContratante = ativos.filter((e) => e.empresaId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileCheck2 className="h-6 w-6 text-muted-foreground" />
            Documentos exigidos pela obra
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            O que o contratante pede antes do caminhão entrar. É essa lista que o link de coleta
            mostra pro motorista ou pro dono do caminhão.
          </p>
        </div>
        {temPermissao("documentos-exigidos.editar") && (
          <Button onClick={() => setCriando(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Exigir um documento
          </Button>
        )}
      </div>

      {ativos.length === 0 && !lista.isLoading ? (
        <Card className="p-4">
          <EstadoVazio
            titulo="Nada exigido ainda"
            descricao="Enquanto essa lista estiver vazia, o link de coleta abre sem pedir documento nenhum."
          />
        </Card>
      ) : (
        <>
          <Grupo
            titulo="Vale pra todas as obras"
            descricao="Exigência da transportadora, independente de quem é o contratante."
            itens={gerais}
            nomeEmpresa={nomeEmpresa}
            onMudou={() => void qc.invalidateQueries({ queryKey: [PATH] })}
          />
          {porContratante.length > 0 && (
            <Grupo
              titulo="Por contratante"
              descricao="Só é pedido de quem está alocado numa obra desse contratante."
              itens={porContratante}
              nomeEmpresa={nomeEmpresa}
              onMudou={() => void qc.invalidateQueries({ queryKey: [PATH] })}
            />
          )}
        </>
      )}

      {criando && (
        <DialogNovo
          onFechar={() => setCriando(false)}
          onCriado={() => {
            setCriando(false);
            void qc.invalidateQueries({ queryKey: [PATH] });
          }}
        />
      )}
    </div>
  );
}

function Grupo({
  titulo,
  descricao,
  itens,
  nomeEmpresa,
  onMudou,
}: {
  titulo: string;
  descricao: string;
  itens: Exigido[];
  nomeEmpresa: (id: string | null) => string;
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();

  const remover = useMutation({
    mutationFn: (id: string) => fetchApi(`${PATH}/${id}`, { token, method: "DELETE" }),
    onSuccess: () => {
      toast.success("Não é mais exigido.", {
        description: "As coletas antigas continuam registrando o que era pedido na época.",
      });
      onMudou();
    },
    onError: (e: Error) => toast.error("Não consegui remover", { description: e.message }),
  });

  return (
    <Card className="p-4">
      <p className="font-medium">{titulo}</p>
      <p className="text-sm text-muted-foreground">{descricao}</p>

      {itens.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {itens.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {e.titulo}
                  {!e.obrigatorio && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      opcional
                    </span>
                  )}
                  {/* De quem se cobra. Fica visível na lista porque é a
                      diferença entre pedir papelada de obra só de quem está
                      na obra e pedir dela da frota inteira. */}
                  {e.publico === "TODOS" && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      toda a frota
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  guardado em {ROTULO_DOCUMENTO_MOTORISTA[e.tipo] ?? e.tipo}
                  {e.empresaId ? ` · ${nomeEmpresa(e.empresaId)}` : ""}
                  {e.exigeAssinatura
                    ? e.exigeIcpBrasil
                      ? " · exige certificado digital"
                      : " · exige assinatura"
                    : ""}
                </p>
              </div>
              {temPermissao("documentos-exigidos.editar") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remover.isPending}
                  onClick={() => remover.mutate(e.id)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Não exigir mais
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DialogNovo({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const token = useAuthToken();
  const [titulo, setTitulo] = useState("");
  const [ajuda, setAjuda] = useState("");
  const [publico, setPublico] = useState<"MENSAL" | "TODOS">("MENSAL");
  const [tipo, setTipo] = useState<string>("CNH");
  const [empresaId, setEmpresaId] = useState<string>();
  const [obrigatorio, setObrigatorio] = useState(true);
  const [exigeAssinatura, setExigeAssinatura] = useState(false);
  const [exigeIcpBrasil, setExigeIcpBrasil] = useState(false);
  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas");

  const criar = useMutation({
    mutationFn: () =>
      fetchApi(PATH, {
        token,
        method: "POST",
        body: JSON.stringify({
          titulo: titulo.trim(),
          ajuda: ajuda.trim() || undefined,
          publico,
          tipo,
          empresaId,
          obrigatorio,
          exigeAssinatura,
          exigeIcpBrasil: exigeAssinatura && exigeIcpBrasil,
          ordem: 0,
        }),
      }),
    onSuccess: () => {
      toast.success("Passou a ser exigido.", {
        description: "Quem abrir um link de coleta já vai ver esse documento na lista.",
      });
      onCriado();
    },
    onError: (e: Error) => toast.error("Não consegui salvar", { description: e.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg space-y-3 p-5">
        <div>
          <p className="text-lg font-semibold">Exigir um documento</p>
          <p className="text-sm text-muted-foreground">
            Escreva o nome do jeito que o contratante pede. O sistema não inventa nome de
            documento.
          </p>
        </div>

        <div>
          <Label>Como o contratante chama</Label>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Ordem de serviço assinada"
          />
        </div>

        <div>
          <Label>Explica pro motorista o que é (opcional)</Label>
          <Input
            value={ajuda}
            onChange={(e) => setAjuda(e.target.value)}
            maxLength={200}
            placeholder="Ex.: é a conta de luz ou de água, com seu nome e endereço"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Aparece embaixo do nome, no app dele. Escreva do jeito que você explicaria por
            telefone — o app não inventa explicação, e sem esta linha muita gente trava em
            documento que não sabe qual é.
          </p>
        </div>

        <div>
          <Label>Guardar na gaveta</Label>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_DOCUMENTO_MOTORISTA.map((t) => (
              <option key={t} value={t}>
                {ROTULO_DOCUMENTO_MOTORISTA[t]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            É onde o arquivo fica no cadastro do motorista, e o que faz ele sair no pacote do
            contratante. Pode repetir a gaveta em mais de um documento — cada um guarda o
            arquivo dele.
          </p>
        </div>

        <div>
          <Label>De qual contratante</Label>
          <Combobox
            value={empresaId}
            onChange={setEmpresaId}
            placeholder="Todas as obras"
            options={(empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome }))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Vazio = vale em qualquer obra. Com contratante, só na obra dele.
          </p>
        </div>

        <div>
          <Label>De quem se pede</Label>
          <Select
            value={publico}
            onChange={(e) => setPublico(e.target.value as "MENSAL" | "TODOS")}
          >
            <option value="MENSAL">Só de quem está em obra mensal</option>
            <option value="TODOS">De todo motorista da frota</option>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Papelada de admissão é cobrança de mensalista. Marcando &quot;toda a frota&quot;,
            quem só roda frete comum passa a ver esse documento como pendência no app dele —
            use só pro que a transportadora pede de todo mundo, como CNH.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={obrigatorio}
            onChange={(e) => setObrigatorio(e.target.checked)}
          />
          Obrigatório
        </label>

        {/* Assinatura é decisão do contratante, não do sistema: cópia de CNH
            ninguém assina, contrato todo mundo assina, ordem de serviço
            depende da obra. Por isso é interruptor por documento. */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={exigeAssinatura}
            onChange={(e) => {
              setExigeAssinatura(e.target.checked);
              if (!e.target.checked) setExigeIcpBrasil(false);
            }}
          />
          Precisa ser assinado
        </label>

        {exigeAssinatura && (
          <div className="ml-6 space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exigeIcpBrasil}
                onChange={(e) => setExigeIcpBrasil(e.target.checked)}
              />
              Exige certificado digital (ICP-Brasil)
            </label>
            <p className="text-xs text-muted-foreground">
              {exigeIcpBrasil
                ? "O arquivo tem que chegar já assinado (gov.br ou certificado A1/A3). Foto e PDF escaneado são recusados na hora do envio."
                : "Aceite eletrônico na própria página: a pessoa digita nome e CPF, e fica gravado quem, quando, de onde e o hash do arquivo."}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={titulo.trim().length < 2 || criar.isPending}
            onClick={() => criar.mutate()}
          >
            {criar.isPending ? "Salvando…" : "Exigir"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
