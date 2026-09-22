"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  CAPACIDADES_APP,
  GRUPOS_CAPACIDADE_APP,
  type CapacidadeApp,
  type CapacidadeAppDef,
} from "@ronan/shared-types";
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
import { Textarea } from "@/components/ui/textarea";
import { AppPreview } from "@/components/app-preview";
import { usePermissoes } from "@/lib/permissoes";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { RevogarExcecao, type ExcecaoApp } from "../../acesso-app/_components/excecoes";

type Corte = { camada: string; sombra: boolean; detalhe: string };
type Explicacao = {
  ligado: boolean;
  ligadoSombra: boolean;
  origem:
    | { tipo: "PERFIL"; vinculo: string; perfilId: string }
    | { tipo: "EXCECAO"; excecaoId: string; motivo: string }
    | null;
  negadaPor?: { excecaoId: string; motivo: string };
  cortes: Corte[];
};
type Base = { perfilId: string; perfilNome: string; via: "FIXADO" | "REGRA" | "PADRAO"; regraNome?: string } | null;
export type AcessoDaPessoa = {
  cpf: string;
  nome: string;
  fonte: "COLUNAS" | "REGRAS";
  regime: "PARCEIRO" | "EMPREGADO" | null;
  efetivo: string[];
  base: { motorista: Base; funcionario: Base };
  explicacao: Record<string, Explicacao>;
  excecoes: ExcecaoApp[];
};

function porque(b: Base) {
  if (!b) return "sem perfil";
  if (b.via === "FIXADO") return "fixado à mão";
  if (b.via === "REGRA") return `pela regra "${b.regraNome}"`;
  return "nenhuma regra alcança — é o padrão da empresa";
}

/**
 * De quem é a ficha. O acesso é da PESSOA (CPF), mas a exceção nasce pelo
 * vínculo que o escritório está olhando — e cada vínculo só mexe no que mora
 * nele: pela ficha do motorista não se mexe no ponto, e vice-versa.
 */
export type AlvoAcesso = { motoristaId: string } | { funcionarioId: string };

function urlDoAlvo(alvo: AlvoAcesso) {
  return "motoristaId" in alvo
    ? `/admin/acesso-app/motoristas/${alvo.motoristaId}`
    : `/admin/acesso-app/funcionarios/${alvo.funcionarioId}`;
}

/**
 * O ACESSO DESTA PESSOA, com o porquê de cada item.
 *
 * ⚠️ Vem de `GET /admin/acesso-app/{motoristas|funcionarios}/:id`, que roda o MESMO resolvedor
 * que decide de verdade — não há um segundo cálculo "pra tela" que possa
 * divergir. É o que o dono pediu: parar de configurar por cadastro, e o
 * cadastro só mostrar o resultado e explicar.
 */
export function AcessoAppCard(alvo: AlvoAcesso) {
  const acesso = useApiQuery<AcessoDaPessoa>(urlDoAlvo(alvo));
  // O vínculo que esta ficha NÃO alcança: a capacidade que mora nele fica de fora.
  const outroVinculo = "motoristaId" in alvo ? "FUNCIONARIO" : "MOTORISTA";
  const { temPermissao } = usePermissoes();
  const [vendo, setVendo] = useState(false);
  const [abrindo, setAbrindo] = useState<CapacidadeAppDef | null>(null);
  const [revogando, setRevogando] = useState<ExcecaoApp | null>(null);

  const a = acesso.data;
  if (!a) return null;
  const regras = a.fonte === "REGRAS";
  const podeExcecao = regras && temPermissao("perfis-acesso.aplicar");
  const excecaoDe = (cap: string) => a.excecoes.find((e) => e.capacidade === cap);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Acesso ao app</h2>
          <p className="text-sm text-muted-foreground">
            {outroVinculo === "MOTORISTA" ? (
              // Ficha de quem só é registrado: o perfil que importa é o dele.
              a.base.funcionario ? (
                <>
                  <strong className="text-foreground">{a.base.funcionario.perfilNome}</strong>,{" "}
                  {porque(a.base.funcionario)}.
                  {a.base.motorista && <> Como motorista: <strong className="text-foreground">{a.base.motorista.perfilNome}</strong>.</>}
                </>
              ) : (
                "Sem perfil."
              )
            ) : a.base.motorista ? (
              <>
                <strong className="text-foreground">{a.base.motorista.perfilNome}</strong>,{" "}
                {porque(a.base.motorista)}.
              </>
            ) : (
              "Sem perfil."
            )}
            {outroVinculo === "FUNCIONARIO" && a.base.funcionario && (
              <>
                {" "}
                Como registrado: <strong className="text-foreground">{a.base.funcionario.perfilNome}</strong>.
              </>
            )}
          </p>
          {!regras && (
            <p className="mt-1 text-xs text-muted-foreground">
              {outroVinculo === "FUNCIONARIO"
                ? "Esta empresa ainda segue a ficha: os interruptores lá embaixo mandam."
                : "Esta empresa ainda segue a ficha do motorista; quem só é registrado recebe o ponto."}{" "}
              Pra configurar por perfil, veja{" "}
              <Link href="/acesso-app" className="underline">
                Acesso ao app
              </Link>
              .
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setVendo(true)}>
          <Smartphone className="mr-2 h-4 w-4" />
          Ver como ele vê
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {GRUPOS_CAPACIDADE_APP.map((grupo) => {
          const doGrupo = CAPACIDADES_APP.filter((c) => c.grupo === grupo);
          const relevantes = doGrupo.filter(
            (c) =>
              a.explicacao[c.chave]?.origem ||
              a.explicacao[c.chave]?.negadaPor ||
              c.vinculo !== outroVinculo ||
              (outroVinculo === "FUNCIONARIO" ? a.base.funcionario : a.base.motorista),
          );
          if (!relevantes.length) return null;
          return (
            <div key={grupo}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{grupo}</p>
              <div className="mt-1 divide-y divide-border">
                {relevantes.map((c) => {
                  const e = a.explicacao[c.chave]!;
                  const exc = excecaoDe(c.chave);
                  const cortesReais = e.cortes.filter((x) => !x.sombra);
                  const cortesAviso = e.cortes.filter((x) => x.sombra);
                  return (
                    <div key={c.chave} className="flex items-start justify-between gap-2 py-1.5">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm">
                          {e.ligado ? (
                            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className={e.ligado ? "" : "text-muted-foreground"}>{c.label}</span>
                        </p>
                        <p className="pl-5 text-xs text-muted-foreground">
                          {exc
                            ? `${exc.efeito === "CONCEDER" ? "Só pra ele" : "Tirado só dele"}: “${exc.motivo}”${exc.expiraEm ? ` · até ${new Date(exc.expiraEm).toLocaleDateString("pt-BR")}` : ""}`
                            : cortesReais.length
                              ? cortesReais[0]!.detalhe
                              : e.origem?.tipo === "PERFIL"
                                ? "Vem do perfil"
                                : null}
                          {cortesAviso.length > 0 && (
                            <span className="text-amber-700"> · Se a trava valesse: {cortesAviso[0]!.detalhe}</span>
                          )}
                        </p>
                      </div>
                      {/* Ferramenta da plataforma (telemetria) não é da empresa conceder. */}
                      {podeExcecao && c.vinculo !== outroVinculo && c.tipo !== "PLATAFORMA" && (
                        exc ? (
                          <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={() => setRevogando({ ...exc, pessoa: { nome: a.nome } })}>
                            Voltar ao perfil
                          </Button>
                        ) : (
                          cortesReais.length === 0 && (
                            <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={() => setAbrindo(c)}>
                              {e.ligado ? "Tirar só dele" : "Dar só pra ele"}
                            </Button>
                          )
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {vendo && (
        <Dialog open onOpenChange={(o) => !o && setVendo(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>O app de {a.nome}</DialogTitle>
            </DialogHeader>
            <AppPreview capacidades={a.efetivo} nome={a.nome} />
          </DialogContent>
        </Dialog>
      )}
      {abrindo && (
        <AbrirExcecao
          alvo={alvo}
          nome={a.nome}
          def={abrindo}
          concede={!a.explicacao[abrindo.chave]!.ligado}
          onFechar={() => setAbrindo(null)}
        />
      )}
      {revogando && <RevogarExcecao excecao={revogando} onFechar={() => setRevogando(null)} />}
    </Card>
  );
}

function AbrirExcecao({
  alvo,
  nome,
  def,
  concede,
  onFechar,
}: {
  alvo: AlvoAcesso;
  nome: string;
  def: CapacidadeAppDef;
  concede: boolean;
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  // Custa por uso: sugere prazo, pra ninguém esquecer um custo ligado pra sempre.
  const [ate, setAte] = useState(() =>
    concede && def.custa ? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) : "",
  );
  const [salvando, setSalvando] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {concede ? "Dar só pra" : "Tirar só de"} {nome}: {def.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{def.efeito}</p>
          <div>
            <Label>Motivo</Label>
            <Textarea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Quem ler daqui a seis meses precisa entender por que ele é diferente"
            />
          </div>
          <div>
            <Label>Vale até (opcional)</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">
              Sem data, vale até alguém tirar. No fim do prazo ele volta ao perfil sozinho.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={concede ? "default" : "warning"}
            disabled={salvando || motivo.trim().length < 10}
            onClick={async () => {
              setSalvando(true);
              try {
                await fetchApi("/admin/acesso-app/excecoes", {
                  method: "POST",
                  token,
                  body: JSON.stringify({
                    ...alvo,
                    capacidade: def.chave as CapacidadeApp,
                    efeito: concede ? "CONCEDER" : "NEGAR",
                    motivo,
                    expiraEm: ate ? new Date(`${ate}T23:59:59-03:00`).toISOString() : null,
                  }),
                });
                toast.success("Pronto. Chega no app dele na próxima vez que ele abrir com sinal.");
                void qc.invalidateQueries();
                onFechar();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}
          >
            {concede ? "Dar só pra ele" : "Tirar só dele"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
