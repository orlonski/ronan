"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

// Modelos rápidos: {nome} vira o primeiro nome do motorista ao aplicar.
const MODELOS: { rotulo: string; texto: string }[] = [
  {
    rotulo: "Atualizar app",
    texto:
      "Oi {nome}! Saiu uma atualização importante do app da Schaba. Abre a Play Store, procura por Schaba e toque em Atualizar. Qualquer dúvida, me chama por aqui. 👍",
  },
  {
    rotulo: "Documento pendente",
    texto:
      "Oi {nome}, está faltando um documento seu no cadastro. Quando puder, dá uma olhada no app. Obrigado!",
  },
  { rotulo: "Bom dia", texto: "Bom dia, {nome}! Tudo certo por aí?" },
];

type EnviarWhatsappResultado = { enviado: boolean; motivo?: string };

/**
 * Manda uma mensagem de WhatsApp personalizada pro motorista (via Evolution).
 * Modelos rápidos preenchem o texto (com o nome) e o admin ajusta à vontade.
 * Desabilitado quando o motorista não tem telefone. Backend devolve
 * `{ enviado, motivo? }` — toast explica quando não dá.
 */
export function EnviarWhatsappButton({
  motoristaId,
  motoristaNome,
  temTelefone,
}: {
  motoristaId: string;
  motoristaNome: string;
  temTelefone: boolean;
}) {
  const token = useAuthToken();
  const [open, setOpen] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const primeiroNome = motoristaNome.trim().split(/\s+/)[0] || motoristaNome;

  const enviar = useMutation({
    mutationFn: () =>
      fetchApi<EnviarWhatsappResultado>(`/admin/motoristas/${motoristaId}/whatsapp`, {
        method: "POST",
        token,
        body: JSON.stringify({ mensagem }),
      }),
    onSuccess: (res) => {
      if (res.enviado) {
        toast.success(`WhatsApp enviado pra ${primeiroNome}`);
        setMensagem("");
        setOpen(false);
      } else {
        toast.warning("Não foi enviado", { description: res.motivo });
      }
    },
    onError: (err: Error) => {
      toast.error("Erro ao enviar", { description: err.message });
    },
  });

  const aplicarModelo = (texto: string) =>
    setMensagem(texto.split("{nome}").join(primeiroNome));

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={temTelefone ? "Mandar WhatsApp" : "Motorista sem telefone cadastrado"}
        disabled={!temTelefone}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-green-50 hover:text-green-700 disabled:opacity-40"
      >
        <MessageCircle className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>WhatsApp · {motoristaNome}</DialogTitle>
            <DialogDescription>
              Vai direto pro WhatsApp do motorista, pelo número da Schaba.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="flex flex-wrap gap-2">
              {MODELOS.map((m) => (
                <Button
                  key={m.rotulo}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => aplicarModelo(m.texto)}
                >
                  {m.rotulo}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="wa-msg">Mensagem</Label>
              <Textarea
                id="wa-msg"
                rows={5}
                maxLength={4096}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder={`Oi ${primeiroNome}, ...`}
              />
              <p className="text-xs text-muted-foreground">
                Os modelos já colocam o nome — edite como quiser antes de enviar.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={enviar.isPending || !mensagem.trim()}
              onClick={() => enviar.mutate()}
            >
              {enviar.isPending ? <Spinner /> : "Enviar WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
