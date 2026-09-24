"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { CAPACIDADES_APP, type CapacidadeApp, type CapacidadeAppDef } from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AppPreview } from "@/components/app-preview";
import { usePermissoes } from "@/lib/permissoes";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import {
  RevogarExcecao,
  fraseDaDiferenca,
  type ExcecaoApp,
} from "../../acesso-app/_components/excecoes";
import { DialogFixar, type PerfilOpcao } from "../_components/acesso-em-lote";

type Base = { perfilId: string; perfilNome: string; via: "FIXADO" | "REGRA" | "PADRAO"; regraNome?: string } | null;
export type AcessoDaPessoa = {
  cpf: string;
  nome: string;
  fonte: "COLUNAS" | "REGRAS";
  regime: "PARCEIRO" | "EMPREGADO" | null;
  efetivo: string[];
  base: { motorista: Base; funcionario: Base };
  excecoes: ExcecaoApp[];
};

/**
 * De quem é a ficha. O acesso é da PESSOA (CPF), mas a diferença nasce pelo
 * cadastro que o escritório está olhando: pela ficha do motorista não se mexe
 * no ponto, e vice-versa.
 */
export type AlvoAcesso = { motoristaId: string } | { funcionarioId: string };

function urlDoAlvo(alvo: AlvoAcesso) {
  return "motoristaId" in alvo
    ? `/admin/acesso-app/motoristas/${alvo.motoristaId}`
    : `/admin/acesso-app/funcionarios/${alvo.funcionarioId}`;
}

/**
 * O ACESSO AO APP DESTA PESSOA, em três linhas: o grupo dela, o que ela vê no
 * celular, e o que é só dela.
 *
 * ⚠️ A versão anterior listava as 23 capacidades com a origem e o "se a trava
 * valesse" de cada uma — o motor à mostra — e o dono, vendo em produção, não
 * entendeu. Os dados vêm do mesmo lugar (o resolvedor que decide de verdade);
 * só a tela ficou do tamanho da pergunta.
 */
export function AcessoAppCard(alvo: AlvoAcesso) {
  const acesso = useApiQuery<AcessoDaPessoa>(urlDoAlvo(alvo));
  const { temPermissao } = usePermissoes();
  const [vendo, setVendo] = useState(false);
  const [mudando, setMudando] = useState(false);
  const [mudandoGrupo, setMudandoGrupo] = useState(false);
  const [desfazendo, setDesfazendo] = useState<ExcecaoApp | null>(null);
  const painel = useApiQuery<{ perfis: PerfilOpcao[] }>(mudandoGrupo ? "/admin/acesso-app" : undefined);

  const a = acesso.data;
  if (!a) return null;
  const porGrupos = a.fonte === "REGRAS";
  const podeMudar = porGrupos && temPermissao("perfis-acesso.aplicar");
  const ehMotorista = "motoristaId" in alvo;
  const grupos = [a.base.motorista, a.base.funcionario].filter((b): b is NonNullable<Base> => !!b);
  const efetivo = new Set(a.efetivo);
  const vistos = CAPACIDADES_APP.filter((c) => efetivo.has(c.chave) && c.tipo !== "PLATAFORMA");

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Acesso ao app</h2>
          <p className="text-sm">
            {grupos.length === 0 ? (
              <span className="text-muted-foreground">Sem grupo: só o básico do app.</span>
            ) : (
              <>
                Tipo:{" "}
                {[...new Map(grupos.map((g) => [g.perfilId, g])).values()].map((g, i) => (
                  <span key={g.perfilId}>
                    {i > 0 && " + "}
                    <strong>{g.perfilNome}</strong>
                    {g.via === "FIXADO" && <span className="text-muted-foreground"> (escolhido na mão)</span>}
                  </span>
                ))}
                <span className="block text-xs text-muted-foreground">
                  {ehMotorista
                    ? "O tipo vem da modalidade dele (no cadastro, mais abaixo)."
                    : "Quem não tem cadastro de motorista é “Só bate ponto”."}
                </span>
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setVendo(true)}>
          <Smartphone className="mr-2 h-4 w-4" />
          Ver o celular dele
        </Button>
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Vê no app</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {vistos.map((c) => (
          <Badge key={c.chave} className="border-border text-muted-foreground">
            {c.label}
          </Badge>
        ))}
        {vistos.length === 0 && <span className="text-sm text-muted-foreground">Só o básico.</span>}
      </div>

      {a.excecoes.length > 0 && (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Só dele</p>
          <div className="mt-1 divide-y divide-border">
            {a.excecoes.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                <p className="min-w-0 text-sm">
                  {fraseDaDiferenca(e).replace(/^./, (l) => l.toUpperCase())}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · “{e.motivo}”
                    {e.expiraEm ? ` · até ${new Date(e.expiraEm).toLocaleDateString("pt-BR")}` : ""}
                  </span>
                </p>
                {podeMudar && (
                  <Button variant="ghost" size="sm" onClick={() => setDesfazendo({ ...e, pessoa: { nome: a.nome } })}>
                    Desfazer
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {porGrupos ? (
        podeMudar && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setMudando(true)}>
              Dar ou tirar algo só dele
            </Button>
            {/* Escolher o tipo na mão não existe mais na tela: o tipo sai do
                cadastro. Quem já foi posto num grupo na mão pode voltar. */}
            {ehMotorista && grupos.some((g) => g.via === "FIXADO") && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setMudandoGrupo(true)}
              >
                Voltar ao automático
              </button>
            )}
          </div>
        )
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          {ehMotorista
            ? "Nesta empresa os acessos ainda são ligados na ficha: são as chavinhas mais abaixo."
            : "Nesta empresa quem é registrado recebe o ponto."}
        </p>
      )}

      {vendo && (
        <Dialog open onOpenChange={(o) => !o && setVendo(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>O celular de {a.nome}</DialogTitle>
            </DialogHeader>
            <AppPreview capacidades={a.efetivo} nome={a.nome} />
          </DialogContent>
        </Dialog>
      )}
      {mudando && (
        <DarOuTirar alvo={alvo} nome={a.nome} efetivo={efetivo} onFechar={() => setMudando(false)} />
      )}
      {mudandoGrupo && "motoristaId" in alvo && (
        <DialogFixar
          ids={[alvo.motoristaId]}
          perfis={painel.data?.perfis ?? []}
          titulo={`Grupo de ${a.nome}`}
          onFechar={() => setMudandoGrupo(false)}
          onFeito={() => undefined}
        />
      )}
      {desfazendo && <RevogarExcecao excecao={desfazendo} onFechar={() => setDesfazendo(null)} />}
    </Card>
  );
}

/**
 * Dar ou tirar UM item só desta pessoa. Escolhe-se o item; se ele já vê, a
 * ação é tirar, senão é dar — sem uma segunda pergunta que pode sair errada.
 */
function DarOuTirar({
  alvo,
  nome,
  efetivo,
  onFechar,
}: {
  alvo: AlvoAcesso;
  nome: string;
  efetivo: Set<string>;
  onFechar: () => void;
}) {
  const { plataforma } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();
  const ehMotorista = "motoristaId" in alvo;
  // Pela ficha do motorista não se mexe no ponto; pela do registrado, só no
  // que é do registrado. O que é da plataforma não é da empresa dar.
  const itens = CAPACIDADES_APP.filter(
    (c) => c.tipo !== "PLATAFORMA" && (ehMotorista ? c.vinculo !== "FUNCIONARIO" : c.vinculo !== "MOTORISTA"),
  );
  const [chave, setChave] = useState<CapacidadeApp | "">("");
  const [motivo, setMotivo] = useState("");
  const [ate, setAte] = useState("");
  const [salvando, setSalvando] = useState(false);
  const def: CapacidadeAppDef | undefined = itens.find((c) => c.chave === chave);
  const tem = chave ? efetivo.has(chave) : false;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Só pra {nome}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>O quê</Label>
            <Select value={chave} onChange={(e) => setChave(e.target.value as CapacidadeApp)}>
              <option value="">Escolha…</option>
              {itens.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {efetivo.has(c.chave) ? "Tirar: " : "Dar: "}
                  {c.label}
                  {plataforma && c.custa ? " (custa)" : ""}
                </option>
              ))}
            </Select>
            {def && <p className="mt-1 text-xs text-muted-foreground">{def.efeito}</p>}
          </div>
          <div>
            <Label>Por quê</Label>
            <Textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Fica registrado, pra quem ler depois entender"
            />
          </div>
          <div>
            <Label>Até quando (opcional)</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Sem data, vale até alguém desfazer.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={tem ? "warning" : "default"}
            disabled={salvando || !chave || motivo.trim().length < 10}
            onClick={async () => {
              setSalvando(true);
              try {
                await fetchApi("/admin/acesso-app/excecoes", {
                  method: "POST",
                  token,
                  body: JSON.stringify({
                    ...alvo,
                    capacidade: chave,
                    efeito: tem ? "NEGAR" : "CONCEDER",
                    motivo,
                    expiraEm: ate ? new Date(`${ate}T23:59:59-03:00`).toISOString() : null,
                  }),
                });
                toast.success("Pronto. Chega no celular dele na próxima vez que abrir o app com sinal.");
                void qc.invalidateQueries();
                onFechar();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}
          >
            {!chave ? "Salvar" : tem ? "Tirar só dele" : "Dar só pra ele"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
