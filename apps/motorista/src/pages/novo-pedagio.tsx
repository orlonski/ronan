import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCatalogos, useCriarPedagio, useMe } from "@/lib/queries";

const today = () => new Date().toISOString().slice(0, 10);

export default function NovoPedagioPage() {
  const navigate = useNavigate();
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarPedagio();

  const [veiculoId, setVeiculoId] = useState("");
  const [data, setData] = useState(today());
  const [pracaPedagio, setPraca] = useState("");
  const [valor, setValor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await criar.mutateAsync({
        clientId: crypto.randomUUID(),
        veiculoId,
        data,
        pracaPedagio: pracaPedagio.trim(),
        valor: parseFloat(valor.replace(",", ".")),
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message || "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-4">
      <header className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">Novo pedágio</h1>
      </header>

      {cat.isLoading && <p className="text-sm text-muted-foreground">Carregando dados...</p>}

      {cat.data && (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Placa</Label>
            <Select required value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
              <option value="">— escolha —</option>
              {cat.data.veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa}{v.modelo ? ` · ${v.modelo}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input type="date" required value={data} onChange={(e) => setData(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Praça de pedágio</Label>
            <Input
              required
              placeholder='ex: "BR-376 km 503"'
              value={pracaPedagio}
              onChange={(e) => setPraca(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input
              required inputMode="decimal" placeholder="0,00"
              value={valor} onChange={(e) => setValor(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            <Check className="h-5 w-5" /> {submitting ? "Salvando..." : "Salvar pedágio"}
          </Button>
        </form>
      )}
    </div>
  );
}
