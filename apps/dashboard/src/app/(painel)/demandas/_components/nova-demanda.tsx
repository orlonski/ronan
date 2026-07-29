"use client";

import { useState } from "react";
import { Lightbulb, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePermissoes } from "@/lib/permissoes";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResource } from "@/lib/client-api";

/**
 * Dicas tiradas de erro real: na primeira execução em produção, "adicionar a
 * data de criação" virou "substituir a coluna de data" — o agente compila
 * qualquer troca, então quem escreve a demanda precisa dizer o que NÃO mexer.
 */
const DICAS = [
  "Diga **adicionar** ou **substituir** — sem isso ele pode trocar o que já existe.",
  "Aponte o arquivo ou a tela quando souber: corta minutos de exploração.",
  "Liste o que **não** deve mudar, se houver algo perto que precisa ficar como está.",
  "Peça uma coisa por demanda. Duas coisas juntas viram um PR difícil de revisar.",
];

const EXEMPLO = {
  titulo: "Mostrar a data de criação na lista de materiais",
  descricao:
    "Na tela de Materiais (tabela e cards), adicionar uma coluna/linha com a data de criação " +
    "do registro. Manter todas as colunas que já existem — é pra somar, não substituir. " +
    "Use o mesmo formato de data das outras telas.",
};

export function NovaDemanda({ onCriada }: { onCriada: () => void }) {
  // Criar demanda enfileira execução do agente — segue `demandas.criar`.
  const { temPermissao } = usePermissoes();
  const podeCriar = temPermissao("demandas.criar");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const criar = useCreateResource<
    { titulo: string; descricao: string },
    { id: string; taskId: string }
  >("/admin/demandas", "/admin/demandas");

  const podeEnviar =
    titulo.trim().length >= 5 && descricao.trim().length >= 20 && !criar.isPending;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeEnviar) return;
    try {
      const criada = await criar.mutateAsync({ titulo, descricao });
      toast.success("Demanda na fila", {
        description: `O agente pega em instantes (${criada.taskId}).`,
      });
      setTitulo("");
      setDescricao("");
      onCriada();
    } catch (err) {
      toast.error("Não deu pra enviar", { description: (err as Error).message });
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={enviar} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="titulo">O que você quer</Label>
          <Input
            id="titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Mostrar a data de criação na lista de materiais"
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="descricao">Detalhes</Label>
            <span className="text-xs text-muted-foreground">
              {descricao.trim().length < 20
                ? `faltam ${20 - descricao.trim().length} caracteres`
                : `${descricao.length} caracteres`}
            </span>
          </div>
          <textarea
            id="descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={6}
            placeholder="Explique como explicaria pra uma pessoa que conhece o sistema mas não estava na conversa."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => {
              setTitulo(EXEMPLO.titulo);
              setDescricao(EXEMPLO.descricao);
            }}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            preencher com um exemplo
          </button>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <Lightbulb className="h-3.5 w-3.5" /> Como escrever pra ele acertar
          </p>
          <ul className="space-y-0.5 text-xs text-amber-900/90 dark:text-amber-200/80">
            {DICAS.map((d) => (
              <li key={d}>
                •{" "}
                <span
                  dangerouslySetInnerHTML={{
                    __html: d.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                  }}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={!podeEnviar}>
            <Send className="mr-2 h-4 w-4" />
            {criar.isPending ? "Enviando…" : "Mandar pro agente"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
