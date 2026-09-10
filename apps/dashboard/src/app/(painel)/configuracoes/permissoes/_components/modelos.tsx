"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LayoutTemplate, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

const PATH_PAPEIS = "/admin/papeis";
const PATH_MODELOS = "/admin/papeis-modelo";
const PATH_DISPONIVEIS = "/admin/papeis/modelos";

/** O que a empresa enxerga: já filtrado pelo teto dela. */
type ModeloDisponivel = {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  /** Chaves do modelo que ESTA empresa não pode receber. */
  foraDoTeto: number;
};

/** O que a plataforma administra. */
type Modelo = {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  ativo: boolean;
  copias: number;
};

/**
 * "Usar um modelo": a empresa escolhe um papel-modelo publicado pela plataforma
 * e recebe uma CÓPIA dele.
 *
 * A cópia nasce filtrada pelo teto da empresa, e é por isso que a lista mostra
 * quantas chaves ficam de fora: prometer o que o modelo diz e entregar menos
 * depois de copiar seria pior do que avisar antes.
 */
export function UsarModelo({ onCopiado }: { onCopiado: (papelId: string) => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string>>({});

  const modelos = useQuery({
    queryKey: [PATH_DISPONIVEIS],
    enabled: !!token && aberto,
    queryFn: () => fetchApi<ModeloDisponivel[]>(PATH_DISPONIVEIS, { token }),
  });

  const copiar = useMutation({
    mutationFn: (m: ModeloDisponivel) =>
      fetchApi<{ id: string }>(`${PATH_PAPEIS}/do-modelo`, {
        method: "POST",
        token,
        body: JSON.stringify({
          modeloId: m.id,
          nome: nomes[m.id]?.trim() || undefined,
        }),
      }),
    onSuccess: (papel) => {
      toast.success("Papel criado a partir do modelo.");
      void qc.invalidateQueries({ queryKey: [PATH_PAPEIS] });
      setAberto(false);
      onCopiado(papel.id);
    },
    onError: (e: Error) => toast.error("Não foi possível copiar", { description: e.message }),
  });

  return (
    <>
      <Button onClick={() => setAberto(true)} variant="outline" className="w-full justify-start">
        <LayoutTemplate className="h-4 w-4" /> Usar um modelo
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modelos de papel</DialogTitle>
            <DialogDescription>
              Pontos de partida prontos. Você recebe uma cópia e edita como quiser — mexer nela
              depois não afeta o modelo.
            </DialogDescription>
          </DialogHeader>

          {modelos.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {modelos.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              A plataforma ainda não publicou nenhum modelo.
            </p>
          )}

          <div className="space-y-3">
            {modelos.data?.map((m) => (
              <div key={m.id} className="rounded-md border p-3">
                <p className="font-medium">{m.nome}</p>
                {m.descricao && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{m.descricao}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.permissoes.length} permissão(ões)
                  {m.foraDoTeto > 0 && (
                    <span className="text-amber-700 dark:text-amber-400">
                      {" "}
                      · {m.foraDoTeto} não liberada(s) para esta empresa ficam de fora
                    </span>
                  )}
                </p>
                <div className="mt-3 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`nome-${m.id}`} className="text-xs">
                      Nome da cópia
                    </Label>
                    <Input
                      id={`nome-${m.id}`}
                      value={nomes[m.id] ?? ""}
                      placeholder={m.nome}
                      onChange={(e) => setNomes((n) => ({ ...n, [m.id]: e.target.value }))}
                    />
                  </div>
                  <Button
                    onClick={() => copiar.mutate(m)}
                    disabled={copiar.isPending}
                    className="shrink-0"
                  >
                    <Copy className="h-4 w-4" /> Copiar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Publicar e despublicar modelos — só pra equipe da plataforma.
 *
 * Publica a partir de um papel que já existe, em vez de ter uma matriz própria:
 * você monta o papel aqui mesmo, confere, e publica. Uma segunda tela com o
 * mesmo grid de permissões seria a mesma coisa duas vezes.
 */
export function PublicarModelo({
  papel,
}: {
  papel: { id: string; nome: string; descricao: string | null; permissoes: string[] } | null;
}) {
  const { plataforma } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();

  const modelos = useQuery({
    queryKey: [PATH_MODELOS],
    enabled: !!token && plataforma,
    queryFn: () => fetchApi<Modelo[]>(PATH_MODELOS, { token }),
  });

  const publicar = useMutation({
    mutationFn: () =>
      fetchApi<Modelo>(PATH_MODELOS, {
        method: "POST",
        token,
        body: JSON.stringify({
          nome: papel!.nome,
          descricao: papel!.descricao ?? undefined,
          permissoes: papel!.permissoes,
        }),
      }),
    onSuccess: () => {
      toast.success("Modelo publicado para todas as empresas.");
      void qc.invalidateQueries({ queryKey: [PATH_MODELOS] });
    },
    onError: (e: Error) => toast.error("Não foi possível publicar", { description: e.message }),
  });

  const remover = useMutation({
    mutationFn: (id: string) => fetchApi<void>(`${PATH_MODELOS}/${id}`, { method: "DELETE", token }),
    onSuccess: () => {
      toast.success("Modelo removido. Quem já copiou não é afetado.");
      void qc.invalidateQueries({ queryKey: [PATH_MODELOS] });
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  if (!plataforma) return null;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-4">
      <div>
        <h3 className="text-sm font-semibold">Modelos da plataforma</h3>
        <p className="text-xs text-muted-foreground">
          Publique um papel como modelo e todas as empresas poderão copiá-lo. Cada empresa recebe
          só as permissões que estão liberadas para ela.
        </p>
      </div>

      {/* Nome do papel FORA do rótulo do botão: a coluna é estreita e o nome
          entrava cortado no meio, deixando dúvida sobre o que ia ser publicado. */}
      <div className="space-y-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={!papel || publicar.isPending}
          onClick={() => publicar.mutate()}
        >
          <Upload className="h-4 w-4" /> Publicar como modelo
        </Button>
        <p className="truncate text-xs text-muted-foreground">
          {papel ? `Publicando: ${papel.nome}` : "Selecione um papel ao lado"}
        </p>
      </div>

      {modelos.data && modelos.data.length > 0 && (
        <ul className="space-y-1">
          {modelos.data.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.nome}</span>
                <span className="block text-xs text-muted-foreground">
                  {m.permissoes.length} permissões · {m.copias} cópia(s)
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive"
                onClick={() => remover.mutate(m.id)}
                disabled={remover.isPending}
                aria-label={`Remover o modelo ${m.nome}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
