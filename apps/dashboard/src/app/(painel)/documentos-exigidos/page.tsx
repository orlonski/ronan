"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ROTULO_DOCUMENTO_MOTORISTA,
  TIPOS_DOCUMENTO_MOTORISTA,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { RequerTela } from "@/components/requer-tela";
import { AbasMinhaEmpresa } from "@/components/abas-minha-empresa";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Exigido = {
  id: string;
  titulo: string;
  ajuda?: string | null;
  /** `MENSAL` é histórico (ver `publicoDe`). */
  publico?: "MENSAL" | "TODOS" | "REGISTRADOS";
  comoAssinar?: "NAO" | "NO_APP" | "JA_ASSINADO";
  tipo: TipoDocumentoMotorista;
  obrigatorio: boolean;
  exigeAssinatura: boolean;
  exigeIcpBrasil: boolean;
  ordem: number;
  ativo: boolean;
};

const PATH = "/admin/admissao/documentos-exigidos";

/** As duas respostas de "de quem se pede". */
type Publico = "REGISTRADOS" | "TODOS";
const PUBLICOS: Publico[] = ["REGISTRADOS", "TODOS"];
const ROTULO_PUBLICO: Record<Publico, string> = {
  REGISTRADOS: "Quem é registrado (CLT)",
  TODOS: "Todo mundo (motoristas também)",
};

/**
 * De quem se pede, lido do que a API devolve. `MENSAL` é o público antigo (a
 * obra/mensal, que saiu em 23/09/2026 e foi migrado pra REGISTRADOS): se ainda
 * aparecer, conta como de registrado — é assim que a API o cobra.
 */
function publicoDe(e: Exigido): Publico {
  return e.publico === "TODOS" ? "TODOS" : "REGISTRADOS";
}

/**
 * Os documentos que a transportadora pede — UMA lista, UMA regra.
 *
 * Cada exigência diz só DE QUEM se pede: de quem é registrado (CLT, o padrão)
 * ou de todo mundo, motoristas parceiros também. O recorte por cliente e o
 * público "só de quem é contratado" saíram em 23/09/2026: o motorista nunca
 * escolhe cliente no app, e na prática papel se pede de quem é CLT.
 *
 * Não confundir com os documentos do próprio motorista (CNH etc., na ficha
 * dele): aquilo é outra coisa e não passa por aqui.
 *
 * ⚠️ O TÍTULO É TEXTO LIVRE, e isso é decisão, não preguiça. O sistema não
 * nomeia o documento: quem escreve é você. Ter "NR" ou "ordem de serviço"
 * fixo em código faria a plataforma parecer emissora de documento de
 * segurança do trabalho, que é obrigação de empregador — e os motoristas
 * parceiros são autônomos. Nós transportamos o arquivo.
 *
 * A "gaveta" é onde o arquivo fica guardado no cadastro da pessoa.
 *
 * É a aba "Documentos que pedimos" de Minha empresa. Quem bate ponto chega
 * aqui com `?publico=REGISTRADOS`; `?novo=1` já abre o formulário.
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
  const params = useSearchParams();
  const publicoDaUrl = params.get("publico");
  const [publico, setPublico] = useState<Publico | "">(
    PUBLICOS.includes(publicoDaUrl as Publico) ? (publicoDaUrl as Publico) : "",
  );
  const [criando, setCriando] = useState(params.get("novo") === "1");

  const lista = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Exigido[]>(PATH, { token }),
  });

  const todosAtivos = (lista.data ?? []).filter((e) => e.ativo);
  const ativos = todosAtivos.filter((e) => !publico || publicoDe(e) === publico);

  return (
    <div className="space-y-4">
      <AbasMinhaEmpresa />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileCheck2 className="h-6 w-6 text-muted-foreground" />
            Documentos que pedimos
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Os papéis que a transportadora pede — de quem é registrado em carteira ou de todo
            mundo. Quem precisa mandar vê a lista no app, e é ela que o link de coleta mostra.
          </p>
        </div>
        {temPermissao("documentos-exigidos.editar") && (
          <Button onClick={() => setCriando(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Exigir um documento
          </Button>
        )}
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="w-full sm:w-72">
          <Label>De quem se pede</Label>
          <Select value={publico} onChange={(e) => setPublico(e.target.value as Publico | "")}>
            <option value="">Todos</option>
            {PUBLICOS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PUBLICO[p]}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {ativos.length === 0 && !lista.isLoading ? (
        <Card className="p-4">
          {publico && todosAtivos.length > 0 ? (
            <EstadoVazio
              titulo="Nada com esse filtro"
              descricao="Mude o filtro acima (ou escolha Todos) pra ver o resto do que é pedido."
            />
          ) : (
            <EstadoVazio
              titulo="Nada exigido ainda"
              descricao="Enquanto essa lista estiver vazia, ninguém é cobrado de documento nenhum."
            />
          )}
        </Card>
      ) : (
        <Lista itens={ativos} onMudou={() => void qc.invalidateQueries({ queryKey: [PATH] })} />
      )}

      {/* A permissão é checada aqui, e não no estado inicial: `?novo=1` chega
          antes de as permissões carregarem. */}
      {criando && temPermissao("documentos-exigidos.editar") && (
        <DialogNovo
          inicial={{ publico: publico || undefined }}
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

function Lista({ itens, onMudou }: { itens: Exigido[]; onMudou: () => void }) {
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
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum.</p>
      ) : (
        <div className="space-y-2">
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
                  {/* De quem se pede. Fica visível na lista porque é a
                      diferença entre cobrar só o CLT e cobrar também o
                      motorista parceiro. */}
                  {publicoDe(e) === "TODOS" ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      todo mundo
                    </span>
                  ) : (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-normal text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                      registrados (CLT)
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  guardado em {ROTULO_DOCUMENTO_MOTORISTA[e.tipo] ?? e.tipo}
                  {e.comoAssinar === "JA_ASSINADO"
                    ? e.exigeIcpBrasil
                      ? " · chega assinado (só digital)"
                      : " · chega assinado (cartório ou gov.br)"
                    : e.comoAssinar === "NO_APP" || e.exigeAssinatura
                      ? " · assina no app"
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

function DialogNovo({
  inicial,
  onFechar,
  onCriado,
}: {
  /** Chega preenchido com o filtro da tela. */
  inicial?: { publico?: Publico };
  onFechar: () => void;
  onCriado: () => void;
}) {
  const token = useAuthToken();
  const [titulo, setTitulo] = useState("");
  const [ajuda, setAjuda] = useState("");
  // Padrão: de quem é registrado. Pedir de todo mundo cobra o motorista
  // parceiro, e isso tem que ser escolha, não esquecimento.
  const [publico, setPublico] = useState<Publico>(inicial?.publico ?? "REGISTRADOS");
  const [tipo, setTipo] = useState<string>("CNH");
  const [obrigatorio, setObrigatorio] = useState(true);
  const [comoAssinar, setComoAssinar] = useState<"NAO" | "NO_APP" | "JA_ASSINADO">("NAO");
  const [exigeIcpBrasil, setExigeIcpBrasil] = useState(false);

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
          obrigatorio,
          comoAssinar,
          exigeAssinatura: comoAssinar !== "NAO",
          exigeIcpBrasil: comoAssinar === "JA_ASSINADO" && exigeIcpBrasil,
          ordem: 0,
        }),
      }),
    onSuccess: () => {
      toast.success("Passou a ser exigido.", {
        description: "Quem precisa mandar já vê esse documento na lista dele.",
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
            Escreva o nome do jeito que o papel é pedido. O sistema não inventa nome de
            documento.
          </p>
        </div>

        <div>
          <Label>Como o papel se chama</Label>
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
            É onde o arquivo fica no cadastro da pessoa. Pode repetir a gaveta em mais de um
            documento — cada um guarda o arquivo dele.
          </p>
        </div>

        <div>
          <Label>De quem se pede</Label>
          <Select value={publico} onChange={(e) => setPublico(e.target.value as Publico)}>
            {PUBLICOS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PUBLICO[p]}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {publico === "REGISTRADOS"
              ? "Todo registrado em carteira, tenha ele cadastro de motorista ou não (o mecânico, o escritório). Ele manda pelo app, e você confere em Quem bate ponto."
              : "Todo mundo: os motoristas parceiros também passam a ver esse documento como pendência no app. Use só pro que a transportadora pede de todos."}
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
            depende da obra. Por isso é escolha por documento.

            ⚠️ Três opções, e não uma caixinha: o par de booleanos que existia
            antes não conseguia dizer "ele assina no papel e manda a foto" —
            marcar "exige certificado" fazia o sistema RECUSAR a foto do
            cartório, e não marcar aceitava o contrato em branco. */}
        <div>
          <Label>Como esse papel é assinado</Label>
          <Select
            value={comoAssinar}
            onChange={(e) => {
              const v = e.target.value as "NAO" | "NO_APP" | "JA_ASSINADO";
              setComoAssinar(v);
              if (v !== "JA_ASSINADO") setExigeIcpBrasil(false);
            }}
          >
            <option value="NAO">Não precisa assinar</option>
            <option value="NO_APP">Assina aqui — no app ou na página</option>
            <option value="JA_ASSINADO">Chega já assinado (cartório ou gov.br)</option>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {comoAssinar === "NAO"
              ? "Só mandar o arquivo. É o caso de cópia de documento."
              : comoAssinar === "NO_APP"
                ? "Aceite eletrônico: o motorista lê o papel na tela e confirma. Fica gravado quem, quando, de onde e o hash do arquivo. Não substitui firma reconhecida quando o cliente exige."
                : "Ele assina fora e manda o papel assinado — foto do cartório ou PDF do gov.br. O sistema registra qual dos dois chegou."}
          </p>
        </div>

        {comoAssinar === "JA_ASSINADO" && (
          <div className="ml-6 space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={exigeIcpBrasil}
                onChange={(e) => setExigeIcpBrasil(e.target.checked)}
              />
              Só vale assinatura digital
            </label>
            <p className="text-xs text-muted-foreground">
              {exigeIcpBrasil
                ? "Só aceita arquivo com assinatura digital dentro (gov.br ou certificado A1/A3). A foto do papel com firma reconhecida é RECUSADA na hora do envio — marque só se o cliente exigir isso mesmo."
                : "Aceita os dois: a foto do papel com firma reconhecida e o PDF assinado pelo gov.br. Quando vier digital, o sistema detecta sozinho; quando vier foto, ela fica marcada pra conferência de vocês."}
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
