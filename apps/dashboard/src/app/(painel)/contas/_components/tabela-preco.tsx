"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Faixa = {
  deVeiculos: number;
  ateVeiculos: number | null;
  valorCentavos: number;
  rotulo: string | null;
};

const PATH = "/admin/precos";

/** Centavos → "1.890,00", que é como a pessoa digita e lê. */
function paraReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

/** "1.890,00" ou "1890" → centavos. Aceita os dois jeitos de digitar. */
function paraCentavos(texto: string): number {
  const limpo = texto.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  return Math.round((Number(limpo) || 0) * 100);
}

/**
 * Quanto o Movatruck cobra, por tamanho de frota.
 *
 * A tabela inteira é salva de uma vez, e não faixa a faixa, porque preço é um
 * conjunto: faixa com buraco ou sobreposta responde errado, e isso só dá pra
 * ver olhando todas juntas. O backend recusa as duas coisas.
 */
export function TabelaPreco() {
  const token = useAuthToken();
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Faixa[]>(PATH, { token }),
  });

  useEffect(() => {
    if (data) setFaixas(data);
  }, [data]);

  function mudar(i: number, campo: keyof Faixa, valor: string) {
    setFaixas((atual) =>
      atual.map((f, idx) => {
        if (idx !== i) return f;
        if (campo === "rotulo") return { ...f, rotulo: valor || null };
        if (campo === "valorCentavos") return { ...f, valorCentavos: paraCentavos(valor) };
        const n = Number(valor.replace(/\D/g, ""));
        if (campo === "ateVeiculos") return { ...f, ateVeiculos: valor.trim() === "" ? null : n };
        return { ...f, deVeiculos: n };
      }),
    );
  }

  function adicionar() {
    setFaixas((atual) => {
      const ultima = atual[atual.length - 1];
      const comeco = ultima?.ateVeiculos != null ? ultima.ateVeiculos + 1 : (ultima?.deVeiculos ?? 0) + 1;
      // A nova entra aberta e fecha a anterior: é o formato que o backend
      // aceita, então a tela já entrega assim em vez de deixar a pessoa
      // descobrir na mensagem de erro.
      const anteriores = atual.map((f, i) =>
        i === atual.length - 1 && f.ateVeiculos === null ? { ...f, ateVeiculos: comeco - 1 } : f,
      );
      return [...anteriores, { deVeiculos: comeco, ateVeiculos: null, valorCentavos: 0, rotulo: null }];
    });
  }

  function remover(i: number) {
    setFaixas((atual) => {
      const restantes = atual.filter((_, idx) => idx !== i);
      if (restantes.length === 0) return restantes;
      // A última sempre aberta, senão frota grande fica sem preço.
      return restantes.map((f, idx) =>
        idx === restantes.length - 1 ? { ...f, ateVeiculos: null } : f,
      );
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      await fetchApi(PATH, { method: "PUT", token, body: JSON.stringify({ faixas }) });
      toast.success("Tabela de preço atualizada.");
      void refetch();
    } catch (e) {
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  }

  if (!data) return null;

  return (
    <Card className="p-4">
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setAberto((v) => !v)}
      >
        <Tag className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Tabela de preço</p>
          <p className="text-sm text-muted-foreground">
            {data.length} faixa(s) por tamanho de frota ·{" "}
            {data.map((f) => `R$ ${paraReais(f.valorCentavos)}`).join(" · ")}
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{aberto ? "Fechar" : "Editar"}</span>
      </button>

      {aberto && (
        <div className="mt-4 space-y-3 border-t pt-4">
          {faixas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="w-20">
                <Label className="text-xs">De</Label>
                <Input
                  inputMode="numeric"
                  value={String(f.deVeiculos)}
                  onChange={(e) => mudar(i, "deVeiculos", e.target.value)}
                />
              </div>
              <div className="w-20">
                <Label className="text-xs">Até</Label>
                <Input
                  inputMode="numeric"
                  placeholder="∞"
                  value={f.ateVeiculos === null ? "" : String(f.ateVeiculos)}
                  onChange={(e) => mudar(i, "ateVeiculos", e.target.value)}
                />
              </div>
              <div className="w-32">
                <Label className="text-xs">R$ por mês</Label>
                <Input
                  inputMode="decimal"
                  value={paraReais(f.valorCentavos)}
                  onChange={(e) => mudar(i, "valorCentavos", e.target.value)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Label className="text-xs">Como você chama essa faixa</Label>
                <Input
                  placeholder="ex: frota média"
                  value={f.rotulo ?? ""}
                  onChange={(e) => mudar(i, "rotulo", e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                aria-label="Remover faixa"
                onClick={() => remover(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            As faixas precisam ser contínuas e a última fica aberta — assim toda frota tem um
            preço, e nenhuma cai em duas faixas.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={adicionar}>
              <Plus className="h-4 w-4" /> Faixa
            </Button>
            <Button onClick={() => void salvar()} disabled={salvando}>
              Salvar tabela
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
