"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { ReciboAceite, StatusAceite } from "@ronan/shared-types";
import { Card } from "@/components/ui/card";
import { fetchApi } from "@/lib/client-api";

/**
 * O contrato do cliente, do ponto de vista dele.
 *
 * Existe porque o texto dos Termos diz que o valor é "o combinado por escrito",
 * e até aqui esse "por escrito" só existia numa linha de `Assinatura` que o
 * cliente não tinha como ver — a gestão de mensalidade está atrás do
 * `PlataformaGuard`, e continua: quanto a Movatruck cobra não é configuração de
 * empresa nenhuma.
 *
 * Esta tela é a contrapartida: ele lê a própria condição e o próprio recibo,
 * sem precisar pedir. Um cliente que consegue conferir sozinho o que combinou
 * é um cliente que não abre chamado pra perguntar — e é uma contestação a menos.
 */
export default function ContratoPage() {
  const [status, setStatus] = useState<StatusAceite | null>(null);
  const [recibos, setRecibos] = useState<ReciboAceite[] | null>(null);

  useEffect(() => {
    fetchApi<StatusAceite>("/termos/status").then(setStatus).catch(() => setStatus(null));
    fetchApi<ReciboAceite[]>("/termos/recibos").then(setRecibos).catch(() => setRecibos([]));
  }, []);

  const reais = (centavos: number) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contrato</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O que você contratou e o registro do seu aceite.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Sua condição comercial</h2>
        {status?.condicaoComercial ? (
          <>
            <p className="mt-3 text-2xl font-semibold">
              {reais(status.condicaoComercial.valorCentavos)}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                por {status.condicaoComercial.ciclo === "ANUAL" ? "ano" : "mês"}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Vencimento todo dia {status.condicaoComercial.diaVencimento}.
            </p>
            {/* A promessa da cláusula 4 dita em voz alta, porque é o que o
                cliente mais teme ao ver um preço numa tela. */}
            <p className="mt-3 text-sm text-muted-foreground">
              Este valor é o que foi combinado e não muda sozinho. Reajuste exige aviso
              com pelo menos 30 dias, e vale só para as competências seguintes.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Não há cobrança ativa para esta empresa.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Seu aceite</h2>
        {recibos === null ? (
          <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
        ) : recibos.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum aceite registrado ainda.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {recibos.map((r, i) => (
              <li key={i} className="border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <a
                    href={`/termos/${r.versao}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-2"
                  >
                    {r.tipo === "USO" ? "Termos de Uso" : "Política de Privacidade"} — versão{" "}
                    {r.versao}
                  </a>
                  <span className="text-sm text-muted-foreground">
                    aceito em{" "}
                    {new Date(r.aceitoEm).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Por {r.nomeQuemAceitou} ({r.emailQuemAceitou})
                  {r.valorCentavosNoAceite !== null
                    ? ` · condição vigente: ${reais(r.valorCentavosNoAceite)}`
                    : ""}
                </p>
                {/* O hash à mostra é o que permite ao cliente conferir que o
                    texto na tela pública é o mesmo que ele aceitou. Sem ele,
                    "aceitei a 1.0" é um número sem documento por trás. */}
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground/70">
                  {r.sha256}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-start gap-x-2 text-sm text-muted-foreground">
        <FileText className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          O texto em vigor está sempre em{" "}
          <a href="/termos" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            movatruck.com.br/termos
          </a>
          .
        </span>
      </p>
    </div>
  );
}
