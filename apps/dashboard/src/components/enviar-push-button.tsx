"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { EnviarPushInput, type EnviarPushResultado } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type FormValues = { titulo: string; corpo: string };

/**
 * Dispara push notification pro app do motorista. Disabled enquanto motorista
 * ainda não tiver aberto o app (sem token registrado). O backend devolve
 * `{ enviado, motivo? }` — toast warning explica o motivo quando falha.
 */
export function EnviarPushButton({
  motoristaId,
  motoristaNome,
  temPushToken,
}: {
  motoristaId: string;
  motoristaNome: string;
  temPushToken: boolean;
}) {
  const token = useAuthToken();
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(EnviarPushInput.pick({ titulo: true, corpo: true })),
    defaultValues: { titulo: "", corpo: "" },
  });

  const enviar = useMutation({
    mutationFn: (body: FormValues) =>
      fetchApi<EnviarPushResultado>(`/admin/motoristas/${motoristaId}/push`, {
        method: "POST",
        token,
        body: JSON.stringify({ ...body, dados: { kind: "mensagem-admin" } }),
      }),
    onSuccess: (res) => {
      if (res.enviado) {
        toast.success(`Notificação enviada pra ${motoristaNome}`);
        form.reset();
        setOpen(false);
      } else {
        toast.warning("Não foi enviado", { description: res.motivo });
      }
    },
    onError: (err: Error) => {
      toast.error("Erro ao enviar", { description: err.message });
    },
  });

  const title = temPushToken
    ? "Enviar notificação push"
    : "Motorista ainda não abriu o app (sem token de push)";

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={title}
        disabled={!temPushToken}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-orange-50 hover:text-orange-700 disabled:opacity-40"
      >
        <Bell className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <form onSubmit={form.handleSubmit((v) => enviar.mutate(v))}>
            <DialogHeader>
              <DialogTitle>Notificação · {motoristaNome}</DialogTitle>
              <DialogDescription>
                Chega no celular do motorista mesmo com o app fechado.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              <div className="space-y-1">
                <Label htmlFor="push-titulo">Título</Label>
                <Input
                  id="push-titulo"
                  maxLength={60}
                  placeholder="Ex: Nova carga disponível"
                  {...form.register("titulo")}
                />
                {form.formState.errors.titulo && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.titulo.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="push-corpo">Mensagem</Label>
                <Textarea
                  id="push-corpo"
                  rows={3}
                  maxLength={250}
                  placeholder="Detalhes que aparecem na notificação"
                  {...form.register("corpo")}
                />
                {form.formState.errors.corpo && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.corpo.message}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviar.isPending}>
                {enviar.isPending ? <Spinner /> : "Enviar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
