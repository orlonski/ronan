"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FornecedorCombobox } from "@/components/fk-comboboxes";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { decimal, inteiro, type Manutencao } from "./tipos";

/**
 * CONCLUIR CONSERTO — um formulário só, e tudo o mais acontece sozinho.
 *
 * Padrão do mercado (Fleetio, squad de 24/09/2026): concluir a ordem de serviço
 * fecha tudo em cascata. Aqui: a revisão ligada zera (com o odômetro da saída),
 * a conta vai pra Contas a pagar se tiver valor, a nota fica anexada e o
 * motorista que avisou recebe "Conserto concluído" pra conferir. Antes eram
 * três lugares pra dar baixa — e ninguém dava.
 */
export function ConcluirConserto({
  manutencao,
  aberto,
  onFechar,
}: {
  manutencao: Manutencao | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [odometro, setOdometro] = React.useState("");
  const [pecas, setPecas] = React.useState("");
  const [mao, setMao] = React.useState("");
  const [fornecedorId, setFornecedorId] = React.useState<string | undefined>(undefined);
  const [novaOficina, setNovaOficina] = React.useState<string | null>(null);
  const [lancarConta, setLancarConta] = React.useState(true);
  const [nota, setNota] = React.useState<File | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  React.useEffect(() => {
    if (!aberto || !manutencao) return;
    setOdometro(manutencao.odometro != null ? String(manutencao.odometro) : "");
    setPecas(manutencao.valorPecas ? String(manutencao.valorPecas).replace(".", ",") : "");
    setMao(manutencao.valorMaoObra ? String(manutencao.valorMaoObra).replace(".", ",") : "");
    setFornecedorId(manutencao.fornecedor?.id);
    setNovaOficina(null);
    setLancarConta(true);
    setNota(null);
    setErro(null);
  }, [aberto, manutencao]);

  const vPecas = decimal(pecas);
  const vMao = decimal(mao);
  const total = (vPecas ?? 0) + (vMao ?? 0);

  async function concluir() {
    if (!token || !manutencao) return;
    if (lancarConta && total <= 0) {
      return setErro("Informe o valor pra lançar em Contas a pagar, ou desmarque a opção.");
    }
    setErro(null);
    setEnviando(true);
    try {
      // Oficina nova digitada na hora: cadastra antes, com o mínimo (nome).
      let oficinaId = fornecedorId ?? null;
      if (novaOficina && novaOficina.trim().length >= 2) {
        const f = await fetchApi<{ id: string }>("/admin/fornecedores", {
          token,
          method: "POST",
          body: JSON.stringify({ nome: novaOficina.trim(), tipo: "OFICINA" }),
        });
        oficinaId = f.id;
      }
      await fetchApi(`/admin/manutencao/${manutencao.id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({
          status: "CONCLUIDA",
          odometro: inteiro(odometro),
          valorPecas: vPecas,
          valorMaoObra: vMao,
          fornecedorId: oficinaId,
          gerarContaPagar: lancarConta,
        }),
      });
      if (nota) {
        const fd = new FormData();
        fd.append("arquivo", nota);
        try {
          await fetchApi(`/admin/manutencao/${manutencao.id}/anexos`, { token, method: "POST", body: fd });
        } catch (e) {
          // O conserto já está concluído: a nota que falhou não desfaz isso.
          toast.error("Conserto concluído, mas a nota não subiu", {
            description: e instanceof Error ? e.message : undefined,
          });
        }
      }
      toast.success("Conserto concluído.");
      for (const k of ["manutencoes", "frota-alertas", "planos-manutencao", "problemas-veiculo", "prontuario"]) {
        void queryClient.invalidateQueries({ queryKey: [k] });
      }
      onFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Concluir conserto</DialogTitle>
          <DialogDescription>
            {manutencao ? `${manutencao.veiculo.placa} · ${manutencao.descricao}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cc-odo">Odômetro na saída</Label>
            <Input id="cc-odo" inputMode="numeric" value={odometro} onChange={(e) => setOdometro(e.target.value)} />
            {manutencao?.planoId && (
              <p className="text-xs text-muted-foreground">
                Este conserto cumpre uma revisão programada: ela recomeça a contar daqui.
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="cc-pecas">Peças (R$)</Label>
              <Input id="cc-pecas" inputMode="decimal" value={pecas} onChange={(e) => setPecas(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-mao">Mão de obra (R$)</Label>
              <Input id="cc-mao" inputMode="decimal" value={mao} onChange={(e) => setMao(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Total</Label>
              <p className="flex h-9 items-center text-sm font-semibold tabular-nums">
                {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </div>
          </div>

          {temPermissao("fornecedores.ver") && (
            <div className="space-y-1">
              <Label>Oficina</Label>
              {novaOficina === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <FornecedorCombobox triggerClassName="sm:w-72" value={fornecedorId} onChange={setFornecedorId} />
                  {temPermissao("fornecedores.criar") && (
                    <button
                      type="button"
                      className="text-sm text-blue-700 hover:underline"
                      onClick={() => setNovaOficina("")}
                    >
                      Cadastrar oficina nova
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Nome da oficina nova"
                    className="max-w-xs"
                    placeholder="Nome da oficina"
                    value={novaOficina}
                    onChange={(e) => setNovaOficina(e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:underline"
                    onClick={() => setNovaOficina(null)}
                  >
                    Escolher da lista
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="cc-nota">Nota da oficina (foto ou PDF, opcional)</Label>
            <Input
              id="cc-nota"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setNota(e.target.files?.[0] ?? null)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lancarConta} onChange={(e) => setLancarConta(e.target.checked)} />
            Lançar o valor em Contas a pagar
          </label>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Voltar
          </Button>
          <Button variant="success" onClick={() => void concluir()} disabled={enviando}>
            Concluir conserto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
