"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cpfDigits, formatCpf } from "@ronan/shared-types";
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
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Encontrado = {
  encontrado: true;
  nome: string;
  telefoneMascarado: string | null;
  jaVinculado: { motoristaId: string; aceite: "PENDENTE" | "ACEITO" | "RECUSADO"; ativo: boolean } | null;
};
type Resultado = { encontrado: false } | Encontrado;

function mascarar(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Convida pelo CPF alguém que já usa a plataforma.
 *
 * A busca é por CPF inteiro e exato — não existe listar nem procurar por nome:
 * o motorista é de quem ele escolher ser, e a plataforma não é um catálogo de
 * gente pra transportadora garimpar. O que volta é o nome (pra conferir que é a
 * pessoa certa) e o celular mascarado.
 *
 * O convite não coloca ninguém na equipe: ele nasce esperando o SIM do
 * motorista, no app dele.
 */
export function ConvidarMotoristaDialog() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cpf, setCpf] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const digitos = cpfDigits(cpf);
  const completo = digitos.length === 11;

  function fechar() {
    setOpen(false);
    setCpf("");
    setResultado(null);
  }

  const procurar = useMutation({
    mutationFn: () =>
      fetchApi<Resultado>(`/admin/motoristas/procurar-cpf?cpf=${digitos}`, { token }),
    onSuccess: setResultado,
    onError: (err: Error) => toast.error("Não deu pra procurar", { description: err.message }),
  });

  const convidar = useMutation({
    mutationFn: () =>
      fetchApi<{ nome: string }>("/admin/motoristas/convidar", {
        method: "POST",
        token,
        body: JSON.stringify({ cpf: digitos }),
      }),
    onSuccess: (m) => {
      toast.success(`Convite enviado pra ${m.nome}`, {
        description: "Ele entra na sua lista assim que aceitar no app.",
      });
      void queryClient.invalidateQueries({ queryKey: ["/admin/motoristas"] });
      fechar();
    },
    onError: (err: Error) => toast.error("Não deu pra convidar", { description: err.message }),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Convidar por CPF
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && fechar()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar motorista</DialogTitle>
            <DialogDescription>
              Pra quem já usa o app. Digite o CPF completo — ele recebe o convite no
              WhatsApp e no app, e entra na sua equipe quando aceitar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="convite-cpf">CPF</Label>
              <div className="flex gap-2">
                <Input
                  id="convite-cpf"
                  value={cpf}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  autoFocus
                  onChange={(e) => {
                    setCpf(mascarar(e.target.value));
                    setResultado(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && completo && !procurar.isPending) procurar.mutate();
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!completo || procurar.isPending}
                  onClick={() => procurar.mutate()}
                >
                  <Search className="h-4 w-4" />
                  {procurar.isPending ? "Procurando…" : "Procurar"}
                </Button>
              </div>
            </div>

            {resultado && !resultado.encontrado && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  Ninguém com esse CPF na plataforma.
                </p>
                <p className="mt-1 text-amber-800">
                  Se ele ainda não usa o app, cadastre você mesmo — ele assume o cadastro
                  quando baixar.
                </p>
                <Link href={`/motoristas/novo?cpf=${digitos}`} onClick={fechar}>
                  <Button variant="outline" size="sm" className="mt-2">
                    Cadastrar {formatCpf(digitos)}
                  </Button>
                </Link>
              </div>
            )}

            {resultado?.encontrado && (
              <div className="rounded-lg border p-3">
                <p className="text-base font-semibold">{resultado.nome}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {formatCpf(digitos)}
                  {resultado.telefoneMascarado ? ` · ${resultado.telefoneMascarado}` : ""}
                </p>
                {resultado.jaVinculado?.aceite === "PENDENTE" && (
                  <p className="mt-2 text-sm text-amber-700">
                    Você já convidou esse motorista. Ele ainda não respondeu.
                  </p>
                )}
                {resultado.jaVinculado?.aceite === "ACEITO" && resultado.jaVinculado.ativo && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Já está na sua equipe.
                  </p>
                )}
                {resultado.jaVinculado?.aceite === "RECUSADO" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ele recusou um convite antes. Dá pra convidar de novo.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={fechar}>
              Cancelar
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              disabled={
                !resultado?.encontrado ||
                convidar.isPending ||
                resultado.jaVinculado?.aceite === "PENDENTE" ||
                (resultado.jaVinculado?.aceite === "ACEITO" && resultado.jaVinculado.ativo)
              }
              onClick={() => convidar.mutate()}
            >
              {convidar.isPending ? "Enviando…" : "Enviar convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
