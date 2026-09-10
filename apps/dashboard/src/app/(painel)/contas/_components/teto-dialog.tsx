"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RECURSOS_LABEL } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type PermissaoRow = { chave: string; modulo: string; titulo: string };

/**
 * O teto de uma empresa: o que o administrador dela pode conceder aos papéis que
 * criar.
 *
 * Mora aqui, na tela da plataforma, e não na matriz de papéis: é a decisão de o
 * que o cliente contratou, não algo que ele ajusta sozinho. Deixar vazio devolve
 * ao padrão — que é como toda empresa nasce, e o que a maioria vai continuar
 * usando.
 */
export function TetoDialog({
  conta,
  aberto,
  onFechar,
}: {
  conta: {
    id: string;
    nome: string;
    permissoesPermitidas?: string[];
    ehPlataforma?: boolean;
  } | null;
  aberto: boolean;
  onFechar: (mudou: boolean) => void;
}) {
  const token = useAuthToken();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [padrao, setPadrao] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const catalogo = useQuery({
    queryKey: ["/admin/permissoes"],
    enabled: !!token && aberto,
    queryFn: () => fetchApi<PermissaoRow[]>("/admin/permissoes", { token }),
  });

  useEffect(() => {
    if (!aberto || !conta) return;
    const atual = conta.permissoesPermitidas ?? [];
    setPadrao(atual.length === 0);
    setMarcadas(new Set(atual));
  }, [aberto, conta]);

  const grupos = useMemo(() => {
    const map = new Map<string, PermissaoRow[]>();
    for (const p of catalogo.data ?? []) {
      const arr = map.get(p.modulo) ?? [];
      arr.push(p);
      map.set(p.modulo, arr);
    }
    return [...map.entries()];
  }, [catalogo.data]);

  async function salvar() {
    if (!conta) return;
    setSalvando(true);
    try {
      await fetchApi(`/admin/contas/${conta.id}/permissoes`, {
        method: "PATCH",
        token,
        // Padrão = lista vazia. É o backend que traduz isso pro conjunto
        // `PERMISSOES_ADMIN_EMPRESA`, pra regra viver num lugar só.
        body: JSON.stringify({ permissoes: padrao ? [] : [...marcadas] }),
      });
      toast.success(
        padrao
          ? `${conta.nome} voltou ao conjunto padrão de permissões.`
          : `Permissões de ${conta.nome} atualizadas.`,
      );
      onFechar(true);
    } catch (e) {
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar(false)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permissões liberadas — {conta?.nome}</DialogTitle>
          <DialogDescription>
            O teto desta empresa: o que o administrador dela pode conceder aos papéis que criar.
            Apertar o teto também remove o que já tinha sido concedido acima dele.
          </DialogDescription>
        </DialogHeader>

        {/* A casa não tem teto: `tetoDaConta` devolve o catálogo inteiro pra ela.
            Sem este aviso, mexer aqui e nada acontecer parece bug. */}
        {conta?.ehPlataforma && (
          <p className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Esta é a empresa da plataforma. Ela sempre tem o catálogo inteiro, então o que você
            marcar aqui não muda nada.
          </p>
        )}

        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={padrao}
            onChange={(e) => setPadrao(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Usar o conjunto padrão</span>
            <span className="block text-xs text-muted-foreground">
              Tudo que não é exclusivo da plataforma. É como todas as empresas funcionam hoje.
            </span>
          </span>
        </label>

        {!padrao && (
          <div className="space-y-4">
            {catalogo.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {grupos.map(([modulo, itens]) => (
              <div key={modulo}>
                <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  {modulo}
                </p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {itens.map((p) => {
                    const recurso = p.chave.split(".")[0] ?? p.chave;
                    return (
                      <label key={p.chave} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={marcadas.has(p.chave)}
                          onChange={() =>
                            setMarcadas((s) => {
                              const novo = new Set(s);
                              if (novo.has(p.chave)) novo.delete(p.chave);
                              else novo.add(p.chave);
                              return novo;
                            })
                          }
                        />
                        <span className="min-w-0 truncate">
                          <span className="text-muted-foreground">
                            {RECURSOS_LABEL[recurso] ?? recurso} ·{" "}
                          </span>
                          {p.titulo}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onFechar(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando}>
            Salvar permissões
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
