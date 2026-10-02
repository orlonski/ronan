"use client";

import { STATUS_SOLICITACAO_OBRA_LABEL, UNIDADE_PEDIDO_LABEL, type PortalObraResumo } from "@ronan/shared-types";
import { diaCurto, numeroBR, reais } from "./api";
import { Botao, Cartao, Selo, Vazio } from "./ui";

/** Resumo da obra: o combinado (pedidos) e o que a obra pediu por aqui. */
export function AbaResumo({ resumo, onPedir }: { resumo: PortalObraResumo; onPedir: () => void }) {
  return (
    <div className="space-y-5">
      <p className="text-slate-600">
        Olá, <span className="font-semibold text-slate-900">{resumo.encarregado.nome.split(" ")[0]}</span>. Aqui está o
        andamento da obra.
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">O que foi combinado</h2>
        {resumo.pedidos.length === 0 ? (
          <Vazio titulo="Nenhum pedido em andamento">
            Quando a transportadora registrar o que foi combinado com a obra, aparece aqui.
          </Vazio>
        ) : (
          resumo.pedidos.map((p) => <CartaoPedido key={p.numero} p={p} />)
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">Seus pedidos de caminhão</h2>
          {resumo.encarregado.podePedirCaminhao && (
            <Botao tom="azul" className="min-h-10 px-3 text-sm" onClick={onPedir}>
              Pedir caminhão
            </Botao>
          )}
        </div>
        {resumo.solicitacoes.length === 0 ? (
          <Vazio titulo="Nenhum pedido feito por aqui ainda" />
        ) : (
          <ul className="space-y-2">
            {resumo.solicitacoes.map((s) => (
              <li key={s.id}>
                <Cartao className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      {numeroBR(s.quantidade, s.unidade === "TONELADAS" ? 1 : 0)} {UNIDADE_PEDIDO_LABEL[s.unidade]}
                      {s.material ? ` de ${s.material}` : ""}
                    </p>
                    <Selo tom={s.status === "CONFIRMADA" ? "verde" : s.status === "RECUSADA" ? "vermelho" : "ambar"}>
                      {STATUS_SOLICITACAO_OBRA_LABEL[s.status]}
                    </Selo>
                  </div>
                  <p className="text-sm text-slate-600">Pra {diaCurto(s.data)}</p>
                  {s.status === "CONFIRMADA" && s.viagensProgramadas != null && (
                    <p className="text-sm text-emerald-700">
                      {s.viagensProgramadas === 1
                        ? "1 viagem programada."
                        : `${s.viagensProgramadas} viagens programadas.`}{" "}
                      Veja na Programação.
                    </p>
                  )}
                  {s.status === "RECUSADA" && s.recusaMotivo && (
                    <p className="text-sm text-red-700">Motivo: {s.recusaMotivo}</p>
                  )}
                  {s.observacao && <p className="text-sm text-slate-500">“{s.observacao}”</p>}
                </Cartao>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CartaoPedido({ p }: { p: PortalObraResumo["pedidos"][number] }) {
  const casas = p.unidade === "TONELADAS" ? 1 : 0;
  const unidade = UNIDADE_PEDIDO_LABEL[p.unidade];
  const tom =
    p.situacao === "Cumprido"
      ? "verde"
      : p.situacao === "Passou do prazo"
        ? "vermelho"
        : p.situacao.startsWith("Ritmo")
          ? "ambar"
          : "cinza";
  return (
    <Cartao className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{p.material ?? "Material a combinar"}</p>
          <p className="text-xs text-slate-500">
            Pedido nº {p.numero}
            {p.prazoEm ? ` · até ${diaCurto(p.prazoEm)}` : ""}
          </p>
        </div>
        <Selo tom={tom}>{p.situacao}</Selo>
      </div>

      <div>
        <div
          className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={p.percentual}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Quanto já foi entregue"
        >
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.percentual}%` }} />
        </div>
        <p className="mt-1 text-right text-xs text-slate-500">{p.percentual}% entregue</p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Numero rotulo="Combinado" valor={`${numeroBR(p.contratado, casas)}`} unidade={unidade} />
        <Numero rotulo="Entregue" valor={`${numeroBR(p.entregue, casas)}`} unidade={unidade} destaque />
        <Numero rotulo="Falta" valor={`${numeroBR(p.saldo, casas)}`} unidade={unidade} />
      </dl>
      {p.valorEntregue != null && (
        <p className="text-sm text-slate-600">
          Valor do que já foi entregue: <span className="font-semibold text-slate-900">{reais(p.valorEntregue)}</span>
        </p>
      )}
    </Cartao>
  );
}

function Numero({ rotulo, valor, unidade, destaque }: { rotulo: string; valor: string; unidade: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl px-1 py-2 ${destaque ? "bg-emerald-50" : "bg-slate-50"}`}>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="text-lg font-bold tabular-nums text-slate-900">{valor}</dd>
      <dd className="text-[11px] text-slate-500">{unidade}</dd>
    </div>
  );
}
