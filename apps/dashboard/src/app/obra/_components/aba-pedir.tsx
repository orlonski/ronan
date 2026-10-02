"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import type { PortalObraSolicitacao, UnidadePedidoTipo } from "@ronan/shared-types";
import { chamar, hojeBR, somarDias } from "./api";
import { Aviso, Botao, Campo, Cartao, CLASSE_CAMPO } from "./ui";

/**
 * "Preciso de caminhão": vai pro escritório da transportadora, que confirma e
 * programa (ou explica por que não dá). A obra acompanha a resposta no resumo.
 */
export function AbaPedir({
  token,
  materiais,
  onEnviado,
}: {
  token: string;
  materiais: { id: string; nome: string }[];
  onEnviado: () => void;
}) {
  const hoje = hojeBR();
  const [data, setData] = React.useState(() => somarDias(hoje, 1));
  const [quantidade, setQuantidade] = React.useState("");
  const [unidade, setUnidade] = React.useState<UnidadePedidoTipo>("VIAGENS");
  const [materialId, setMaterialId] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  const enviar = useMutation({
    mutationFn: () =>
      chamar<PortalObraSolicitacao>("/pedidos-caminhao", {
        method: "POST",
        token,
        body: {
          data,
          quantidade: Number(quantidade.replace(",", ".")),
          unidade,
          materialId: materialId || null,
          observacao: observacao.trim() || null,
        },
      }),
    meta: { erroTratado: true },
    onSuccess: onEnviado,
    onError: (e) => setErro((e as Error).message),
  });

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = Number(quantidade.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setErro(unidade === "VIAGENS" ? "Diga quantas viagens." : unidade === "M3" ? "Diga quantos m³." : "Diga quantas toneladas.");
      return;
    }
    if (!data || data < hoje) {
      setErro("Escolha hoje ou um dia pra frente.");
      return;
    }
    enviar.mutate();
  }

  return (
    <Cartao>
      <form onSubmit={submeter} className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Pedir caminhão</h2>
          <p className="text-sm text-slate-600">
            O pedido vai pro escritório da transportadora. A resposta aparece na aba Obra.
          </p>
        </div>

        <Campo rotulo="Pra quando" id="pedir-data">
          <input
            id="pedir-data"
            type="date"
            min={hoje}
            value={data}
            onChange={(e) => setData(e.target.value)}
            className={CLASSE_CAMPO}
          />
        </Campo>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Campo rotulo="Quanto" id="pedir-quantidade">
            <input
              id="pedir-quantidade"
              inputMode="decimal"
              placeholder={unidade === "VIAGENS" ? "Ex.: 4" : "Ex.: 60"}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value.replace(/[^\d,.]/g, ""))}
              className={CLASSE_CAMPO}
            />
          </Campo>
          <Campo rotulo="Em" id="pedir-unidade">
            <select
              id="pedir-unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value as UnidadePedidoTipo)}
              className={`${CLASSE_CAMPO} w-36`}
            >
              <option value="VIAGENS">viagens</option>
              <option value="TONELADAS">toneladas</option>
              <option value="M3">m³</option>
            </select>
          </Campo>
        </div>

        {materiais.length > 0 && (
          <Campo rotulo="Material" id="pedir-material" dica="Se não souber, deixe em branco e explique embaixo.">
            <select
              id="pedir-material"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Escolha o material</option>
              {materiais.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo rotulo="Recado pro escritório (opcional)" id="pedir-obs">
          <textarea
            id="pedir-obs"
            rows={3}
            maxLength={500}
            placeholder="Ex.: entrar pelo portão 2, a partir das 7h."
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className={`${CLASSE_CAMPO} py-2.5`}
          />
        </Campo>

        {erro && <Aviso>{erro}</Aviso>}

        <Botao type="submit" tom="verde" className="w-full" carregando={enviar.isPending}>
          Enviar pedido
        </Botao>
      </form>
    </Cartao>
  );
}
