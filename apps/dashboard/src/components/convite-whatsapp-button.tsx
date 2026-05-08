"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
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
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Tipo = "motorista" | "user";

/**
 * Botão pra gerar convite WhatsApp pra um motorista ou user. Abre dialog
 * com código de 6 chars + botão copiar. Dura 24h.
 */
export function ConviteWhatsappButton({
  tipo,
  id,
  nome,
}: {
  tipo: Tipo;
  id: string;
  nome: string;
}) {
  const token = useAuthToken();
  const [open, setOpen] = useState(false);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [expiraEm, setExpiraEm] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const gerar = useMutation({
    mutationFn: () =>
      fetchApi<{ codigo: string; expiraEm: string }>(
        `/admin/${tipo === "motorista" ? "motoristas" : "users"}/${id}/convite-whatsapp`,
        { method: "POST", token },
      ),
    onSuccess: (res) => {
      setCodigo(res.codigo);
      setExpiraEm(res.expiraEm);
      setOpen(true);
    },
    onError: (err: Error) => {
      toast.error("Não foi possível gerar convite", { description: err.message });
    },
  });

  function copiar() {
    if (!codigo) return;
    void navigator.clipboard.writeText(codigo);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  function fechar() {
    setOpen(false);
    setCodigo(null);
    setExpiraEm(null);
    setCopiado(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Gerar convite WhatsApp"
        disabled={gerar.isPending}
        onClick={() => gerar.mutate()}
        className="text-muted-foreground hover:bg-green-50 hover:text-green-700"
      >
        {gerar.isPending ? <Spinner /> : <MessageCircle className="h-4 w-4" />}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && fechar()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convite WhatsApp · {nome}</DialogTitle>
            <DialogDescription>
              Manda essa mensagem pra {tipo === "motorista" ? "o motorista" : "o usuário"} pelo
              WhatsApp:
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/30 p-4 text-sm">
            <p>
              Olá! Pra ativar o WhatsApp, manda essa mensagem pro nosso número:
            </p>
            <div className="my-3 flex items-center justify-between gap-3 rounded-md border-2 border-dashed bg-background p-3">
              <code className="text-2xl font-bold tracking-widest">{codigo}</code>
              <Button variant="outline" size="sm" onClick={copiar}>
                {copiado ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            {expiraEm && (
              <p className="text-xs text-muted-foreground">
                Válido até {new Date(expiraEm).toLocaleString("pt-BR")}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={fechar}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
