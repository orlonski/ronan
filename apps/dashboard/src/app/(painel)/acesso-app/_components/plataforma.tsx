"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CAPACIDADES_APP, type CamadaCorte } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusToggle } from "@/components/status-toggle";
import { fetchApi, useAuthToken } from "@/lib/client-api";
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
    efeito: "Viagem guiada e leitura de ticket exigem poder lançar viagem.",
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
