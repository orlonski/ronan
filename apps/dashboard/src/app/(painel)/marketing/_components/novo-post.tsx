"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuthToken } from "@/lib/client-api";

/**
 * Enfileira um post: a arte em JPEG, a legenda e a hora.
 *
 * A arte chega pronta — quem renderiza é `marketing/instagram/render.mjs`, na
 * máquina de quem produz, porque nenhum container do projeto tem Chromium. Aqui
 * é só o upload.
 */
export function NovoPost({ apiUrl }: { apiUrl: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const inputArte = useRef<HTMLInputElement>(null);
  const [arte, setArte] = useState<File | null>(null);
  const [peca, setPeca] = useState("");
  const [legenda, setLegenda] = useState("");
  const [publicarEm, setPublicarEm] = useState("");

  const enviar = useMutation({
    mutationFn: async () => {
      if (!arte) throw new Error("Escolha a arte em JPEG");
      const fd = new FormData();
      fd.append("arte", arte);
      fd.append("peca", peca.trim());
      fd.append("legenda", legenda);
      if (publicarEm) fd.append("publicarEm", new Date(publicarEm).toISOString());

      const r = await fetch(`${apiUrl}/admin/marketing/instagram`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        // O backend devolve { issues: [...] } quando o Zod barra.
        const detalhe =
          corpo?.issues?.map((i: { message: string }) => i.message).join(", ") ??
          corpo?.message ??
          `Erro ${r.status}`;
        throw new Error(Array.isArray(detalhe) ? detalhe.join(", ") : String(detalhe));
      }
      return r.json();
    },
    onSuccess: () => {
      setArte(null);
      setPeca("");
      setLegenda("");
      setPublicarEm("");
      if (inputArte.current) inputArte.current.value = "";
      qc.invalidateQueries({ queryKey: ["/admin/marketing/instagram"] });
    },
  });

  const restantes = 2200 - legenda.length;

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <ImagePlus className="h-4 w-4" />
        Agendar post
      </h2>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
        <label className="text-sm">
          <span className="text-muted-foreground">Arte (JPEG, até 8 MB)</span>
          <input
            ref={inputArte}
            id="arte-instagram"
            type="file"
            accept="image/jpeg"
            onChange={(e) => setArte(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full rounded-md border bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
          />
          {arte ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {arte.name} · {(arte.size / 1024).toFixed(0)} KB
            </span>
          ) : null}
        </label>

        <label className="text-sm">
          <span className="text-muted-foreground">Peça</span>
          <input
            id="peca-instagram"
            value={peca}
            onChange={(e) => setPeca(e.target.value)}
            placeholder="03-sem-sinal"
            className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            O nome do arquivo em marketing/instagram/posts, pra rastrear depois.
          </span>
        </label>
      </div>

      <label className="mt-4 block text-sm">
        <span className="text-muted-foreground">Legenda</span>
        <textarea
          id="legenda-instagram"
          value={legenda}
          onChange={(e) => setLegenda(e.target.value)}
          rows={6}
          placeholder="O gancho na primeira linha — é o que aparece antes do “mais”."
          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
        />
        <span
          className={`mt-1 block text-xs ${restantes < 0 ? "text-red-700" : "text-muted-foreground"}`}
        >
          {restantes} caracteres restantes
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="text-muted-foreground">Publicar em</span>
          <input
            id="publicar-em-instagram"
            type="datetime-local"
            value={publicarEm}
            onChange={(e) => setPublicarEm(e.target.value)}
            className="mt-1 block rounded-md border bg-background p-2 text-sm"
          />
        </label>

        <Button
          onClick={() => enviar.mutate()}
          disabled={enviar.isPending || !arte || !peca.trim() || !legenda.trim() || restantes < 0}
        >
          <Upload className="mr-2 h-4 w-4" />
          {enviar.isPending ? "Enviando…" : publicarEm ? "Agendar" : "Salvar como rascunho"}
        </Button>

        <span className="text-xs text-muted-foreground">
          Sem hora marcada o post fica em rascunho e o cron não pega.
        </span>
      </div>

      {enviar.isError ? (
        <p className="mt-3 text-sm text-red-700">{(enviar.error as Error).message}</p>
      ) : null}
    </Card>
  );
}
