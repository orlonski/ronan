"use client";

import { useCallback, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/loading";

type Variant = "destructive" | "default";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
};

type Estado = ConfirmOptions & {
  resolve: (ok: boolean) => void;
  pending: boolean;
};

/**
 * Hook de confirmação imperativo — substitui `window.confirm` por um dialog
 * estilizado. Uso:
 *
 *   const { confirmar, ConfirmDialog } = useConfirm();
 *   if (await confirmar({ title: "...", variant: "destructive" })) { ... }
 *
 *   return (
 *     <>
 *       ...
 *       <ConfirmDialog />
 *     </>
 *   );
 *
 * `confirmar` retorna `Promise<boolean>` — true se o usuário confirmou,
 * false se cancelou ou fechou. Mantém estado interno; basta renderizar o
 * <ConfirmDialog /> uma vez no componente que chama o hook.
 */
export function useConfirm() {
  const [estado, setEstado] = useState<Estado | null>(null);

  const confirmar = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setEstado({ ...opts, resolve, pending: false });
    });
  }, []);

  const fechar = useCallback(
    (ok: boolean) => {
      if (estado) {
        estado.resolve(ok);
        setEstado(null);
      }
    },
    [estado],
  );

  const ConfirmDialog = useCallback(() => {
    if (!estado) return null;
    const variant = estado.variant ?? "default";
    return (
      <Dialog open onOpenChange={(open) => !open && fechar(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-start gap-3">
              {variant === "destructive" && (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
              )}
              <div className="flex-1">
                <DialogTitle>{estado.title}</DialogTitle>
                {estado.description && (
                  <DialogDescription className="mt-1.5">
                    {estado.description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={estado.pending}
              onClick={() => fechar(false)}
            >
              {estado.cancelLabel ?? "Cancelar"}
            </Button>
            <Button
              type="button"
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={estado.pending}
              onClick={() => {
                setEstado((s) => (s ? { ...s, pending: true } : s));
                fechar(true);
              }}
            >
              {estado.pending && <Spinner />}
              {estado.confirmLabel ?? (variant === "destructive" ? "Excluir" : "Confirmar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }, [estado, fechar]);

  return { confirmar, ConfirmDialog };
}
