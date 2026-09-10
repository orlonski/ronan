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
  padrao,
  aberto,
  onFechar,
}: {
  conta: {
    id: string;
    nome: string;
    permissoesPermitidas?: string[];
    ehPlataforma?: boolean;
  } | null;
  /** true = editando o teto PADRÃO (vale pra toda empresa sem teto próprio). */
  padrao?: boolean;
  aberto: boolean;
  onFechar: (mudou: boolean) => void;
}) {
  const token = useAuthToken();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [usarPadrao, setUsarPadrao] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const catalogo = useQuery({
    queryKey: ["/admin/permissoes"],
    enabled: !!token && aberto,
    queryFn: () => fetchApi<PermissaoRow[]>("/admin/permissoes", { token }),
  });

  // O teto padrão da plataforma: só carregado quando é ele que está sendo
  // editado, e é a lista que o dialog mostra marcada.
  const tetoPadrao = useQuery({
    queryKey: ["/admin/permissoes/teto-padrao"],
    enabled: !!token && aberto && !!padrao,
    queryFn: () => fetchApi<{ permissoes: string[] }>("/admin/permissoes/teto-padrao", { token }),
  });

  useEffect(() => {
    if (!aberto) return;
    if (padrao) {
      // Editando a régua da casa não existe "usar o padrão" — ela É o padrão.
      setUsarPadrao(false);
      setMarcadas(new Set(tetoPadrao.data?.permissoes ?? []));
      return;
    }
    if (!conta) return;
    const atual = conta.permissoesPermitidas ?? [];
    setUsarPadrao(atual.length === 0);
    setMarcadas(new Set(atual));
  }, [aberto, conta, padrao, tetoPadrao.data]);

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
    if (!padrao && !conta) return;
    setSalvando(true);
    try {
      if (padrao) {
        await fetchApi("/admin/permissoes/teto-padrao", {
          method: "PUT",
          token,
          body: JSON.stringify({ permissoes: [...marcadas] }),
        });
        toast.success("Padrão atualizado. Vale para toda empresa sem ajuste próprio.");
      } else {
        await fetchApi(`/admin/contas/${conta!.id}/permissoes`, {
          method: "PATCH",
          token,
          // "Usar o padrão" = lista vazia. Quem traduz isso pro conjunto de
          // verdade é o backend, pra régua viver num lugar só.
          body: JSON.stringify({ permissoes: usarPadrao ? [] : [...marcadas] }),
        });
        toast.success(
          usarPadrao
            ? `${conta!.nome} voltou ao conjunto padrão de permissões.`
            : `Permissões de ${conta!.nome} atualizadas.`,
        );
      }
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
          <DialogTitle>
            {padrao ? "Permissões padrão das empresas" : `Permissões liberadas — ${conta?.nome}`}
          </DialogTitle>
          <DialogDescription>
            {padrao
              ? "O que uma empresa pode conceder quando não tem ajuste próprio. Vale para todas de uma vez, e você continua podendo abrir ou fechar caso a caso em cada empresa."
              : "O teto desta empresa: o que o administrador dela pode conceder aos papéis que criar. Apertar o teto também remove o que já tinha sido concedido acima dele."}
          </DialogDescription>
        </DialogHeader>

        {/* A casa não tem teto: `tetoDaConta` devolve o catálogo inteiro pra ela.
            Sem este aviso, mexer aqui e nada acontecer parece bug. */}
        {!padrao && conta?.ehPlataforma && (
          <p className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Esta é a empresa da plataforma. Ela sempre tem o catálogo inteiro, então o que você
            marcar aqui não muda nada.
          </p>
        )}

        {!padrao && (
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={usarPadrao}
            onChange={(e) => setUsarPadrao(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Usar o conjunto padrão</span>
            <span className="block text-xs text-muted-foreground">
              Tudo que não é exclusivo da plataforma. É como todas as empresas funcionam hoje.
            </span>
          </span>
        </label>
        )}

        {!usarPadrao && (
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
            {padrao ? "Salvar padrão" : "Salvar permissões"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
