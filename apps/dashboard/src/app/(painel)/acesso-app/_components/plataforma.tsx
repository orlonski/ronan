"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CAPACIDADES_APP, type CamadaCorte } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusToggle } from "@/components/status-toggle";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { ConfirmarMudanca } from "./simulacao";
import { CHAVE_PAINEL, type PainelAcessoApp, type Simulacao } from "./tipos";

const CAMADAS: { chave: CamadaCorte; label: string; efeito: string }[] = [
  {
    chave: "CONTRATO",
    label: "Módulo contratado",
    efeito: "Sem o módulo, a capacidade some do app (chat sem Comunicação, diária sem Obra e diária…).",
  },
  {
    chave: "REGIME",
    label: "Regime (CLT × parceiro)",
    efeito: "Quem é registrado em carteira não recebe diária, obra nem acertos.",
  },
  {
    chave: "PLATAFORMA",
    label: "Liberação da plataforma",
    efeito: "Recurso em liberação gradual só vale se estiver liberado nesta empresa (lista abaixo).",
  },
  {
    chave: "DEPENDENCIA",
    label: "Dependências",
    efeito: "Começar viagem e leitura de ticket exigem Lançar viagem feita.",
  },
  {
    chave: "APROVACAO",
    label: "Aprovação do cadastro",
    efeito: "Cadastro em análise ou inativo não usa o app. Já vale hoje.",
  },
];

/**
 * SÓ A PLATAFORMA: quais travas CORTAM nesta empresa, e o que está liberado.
 *
 * ⚠️ A regra do dono: empresa em produção não perde funcionalidade sem ele
 * autorizar, vendo antes quem perde. Toda trava nasce "só avisando"; ligar é
 * aqui, empresa por empresa, e o botão mostra a lista nominal antes.
 */
export function AbaPlataforma({ painel }: { painel: PainelAcessoApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [sombra, setSombra] = useState(new Set(painel.camadasEmSombra));
  const [rollouts, setRollouts] = useState(new Set(painel.rolloutsApp));
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);

  const corpo = { camadasEmSombra: [...sombra], rolloutsApp: [...rollouts] };
  const alterado =
    JSON.stringify([...sombra].sort()) !== JSON.stringify([...painel.camadasEmSombra].sort()) ||
    JSON.stringify([...rollouts].sort()) !== JSON.stringify([...painel.rolloutsApp].sort());

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold">Travas desta empresa</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          “Valendo” corta de verdade. “Só avisa” calcula e mostra quem perderia, sem tirar nada de
          ninguém.
          {painel.fonte === "COLUNAS" &&
            " Enquanto a empresa segue a ficha, a trava ligada só passa a cortar quando o app ler o acesso novo."}
        </p>
        <div className="space-y-3">
          {CAMADAS.map((c) => (
            <div key={c.chave} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.efeito}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {sombra.has(c.chave) ? "Só avisa" : "Valendo"}
                <StatusToggle
                  size="sm"
                  active={!sombra.has(c.chave)}
                  onChange={(v: boolean) =>
                    setSombra((prev) => {
                      const n = new Set(prev);
                      if (v) n.delete(c.chave);
                      else n.add(c.chave);
                      return n;
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold">Liberado nesta empresa</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Recursos em liberação gradual ou de diagnóstico da plataforma.
        </p>
        <div className="space-y-3">
          {CAPACIDADES_APP.filter((c) => c.tipo !== "EMPRESA").map((c) => (
            <div key={c.chave} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.efeito}</p>
              </div>
              <StatusToggle
                size="sm"
                active={rollouts.has(c.chave)}
                onChange={(v: boolean) =>
                  setRollouts((prev) => {
                    const n = new Set(prev);
                    if (v) n.add(c.chave);
                    else n.delete(c.chave);
                    return n;
                  })
                }
              />
            </div>
          ))}
        </div>
      </Card>

      <TravasDoServidor painel={painel} />

      <div className="flex justify-end gap-2">
        {alterado && (
          <Button
            variant="outline"
            onClick={() => {
              setSombra(new Set(painel.camadasEmSombra));
              setRollouts(new Set(painel.rolloutsApp));
            }}
          >
            Desfazer
          </Button>
        )}
        <Button
          disabled={!alterado}
          onClick={async () => {
            try {
              setSimulacao(
                await fetchApi<Simulacao>("/admin/acesso-app/simular", {
                  method: "POST",
                  token,
                  body: JSON.stringify(corpo),
                }),
              );
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Ver quem muda
        </Button>
      </div>

      {simulacao && (
        <ConfirmarMudanca
          titulo="Travas e liberações desta empresa"
          simulacao={simulacao}
          onCancelar={() => setSimulacao(null)}
          onConfirmar={async () => {
            try {
              await fetchApi("/admin/acesso-app/plataforma", {
                method: "PUT",
                token,
                body: JSON.stringify(corpo),
              });
              toast.success("Salvo.");
              setSimulacao(null);
              void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

type SombraServidor = {
  capacidade: string;
  pessoas: { cpf: string; nome: string; vezes: number; ultima: string; rotas: string[] }[];
}[];

/**
 * O QUE O SERVIDOR BARRA NO APP desta empresa (F4).
 *
 * Tudo nasce "só registra": o servidor anota quem ele barraria e deixa passar.
 * Travar uma capacidade é o momento em que alguém passa a ouvir "isso não está
 * no seu app" — por isso o botão abre, ANTES, a lista de quem a sombra pegou.
 */
function TravasDoServidor({ painel }: { painel: PainelAcessoApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const sombra = useApiQuery<SombraServidor>("/admin/acesso-app/plataforma/sombra-servidor");
  const [aberta, setAberta] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const travadas = new Set(painel.capacidadesTravadas);
  const porCap = new Map((sombra.data ?? []).map((s) => [s.capacidade, s.pessoas]));

  async function salvar(novas: Set<string>, msg: string) {
    setSalvando(true);
    try {
      await fetchApi("/admin/acesso-app/plataforma/travas-servidor", {
        method: "PUT",
        token,
        body: JSON.stringify({ capacidadesTravadas: [...novas] }),
      });
      toast.success(msg);
      setConfirmando(null);
      void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const def = (chave: string) => CAPACIDADES_APP.find((c) => c.chave === chave);
  const pessoasDe = (chave: string) => porCap.get(chave) ?? [];

  return (
    <Card className="p-5">
      <h3 className="font-semibold">O servidor barra no app</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Hoje o servidor só <strong>registra</strong> quem ele barraria e deixa passar. Travar faz
        ele recusar de verdade, só nesta empresa. O que alguém lançar sem sinal depois disso não se
        perde: vai pro escritório conferir.
      </p>
      <div className="divide-y divide-border">
        {CAPACIDADES_APP.filter((c) => c.tipo !== "PLATAFORMA").map((c) => {
          const pessoas = pessoasDe(c.chave);
          const travada = travadas.has(c.chave);
          return (
            <div key={c.chave} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {c.label}
                    {travada && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        barrando
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline"
                    disabled={pessoas.length === 0}
                    onClick={() => setAberta(aberta === c.chave ? null : c.chave)}
                  >
                    {sombra.isLoading
                      ? "…"
                      : pessoas.length === 0
                        ? "Ninguém teria sido barrado nos últimos 14 dias"
                        : `${pessoas.length === 1 ? "1 pessoa teria sido barrada" : `${pessoas.length} pessoas teriam sido barradas`} nos últimos 14 dias`}
                  </button>
                </div>
                {travada ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={salvando}
                    onClick={() => {
                      const n = new Set(travadas);
                      n.delete(c.chave);
                      void salvar(n, `O servidor parou de barrar "${c.label}".`);
                    }}
                  >
                    Soltar
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={salvando} onClick={() => setConfirmando(c.chave)}>
                    Travar
                  </Button>
                )}
              </div>
              {aberta === c.chave && pessoas.length > 0 && (
                <ul className="mt-2 space-y-0.5 pl-3 text-xs text-muted-foreground">
                  {pessoas.map((p) => (
                    <li key={p.cpf}>
                      <span className="text-foreground">{p.nome}</span> · {p.vezes}x · última em{" "}
                      {new Date(p.ultima).toLocaleDateString("pt-BR")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Travar “{def(confirmando)?.label}” nesta empresa?</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{def(confirmando)?.efeito}</p>
              {pessoasDe(confirmando).length === 0 ? (
                <p>Nos últimos 14 dias, ninguém sem esse acesso tentou usar isso.</p>
              ) : (
                <>
                  <p>
                    Nos últimos 14 dias, o servidor teria barrado{" "}
                    <strong>{pessoasDe(confirmando).length}</strong> pessoa(s). Depois de travar, elas
                    passam a ver “isso não está no seu app nesta empresa”:
                  </p>
                  <ul className="max-h-48 overflow-y-auto rounded border border-border p-2 text-xs">
                    {pessoasDe(confirmando).map((p) => (
                      <li key={p.cpf}>
                        {p.nome} · {p.vezes}x
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmando(null)}>
                Cancelar
              </Button>
              <Button
                variant="warning"
                disabled={salvando}
                onClick={() => {
                  const n = new Set(travadas);
                  n.add(confirmando);
                  void salvar(n, `O servidor passou a barrar "${def(confirmando)?.label}" nesta empresa.`);
                }}
              >
                Travar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
