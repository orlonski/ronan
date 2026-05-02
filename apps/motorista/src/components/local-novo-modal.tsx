import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AddressAutocomplete } from "./address-autocomplete";
import { useCriarLocal, type Local, type SugestaoEndereco } from "@/lib/queries";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";

export function LocalNovoModal({
  open,
  onClose,
  onCreated,
  obraId,
  tipoSugerido = "AMBOS",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: Local) => void;
  obraId?: string;
  tipoSugerido?: Tipo;
}) {
  const criar = useCriarLocal();
  const [nome, setNome] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("PR");
  const [cep, setCep] = useState("");
  const [pontoReferencia, setPontoReferencia] = useState("");
  const [tipo, setTipo] = useState<Tipo>(tipoSugerido);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setNome(""); setLogradouro(""); setNumero(""); setBairro("");
    setCidade(""); setUf("PR"); setCep(""); setPontoReferencia("");
    setTipo(tipoSugerido); setLat(null); setLng(null); setErro(null);
  }

  function aplicarSugestao(s: SugestaoEndereco) {
    if (!nome && s.nome) setNome(s.nome);
    setLogradouro(s.logradouro ?? s.nome ?? "");
    setNumero(s.numero ?? "");
    setBairro(s.bairro ?? "");
    setCidade(s.cidade);
    setUf(s.uf);
    setCep(s.cep ?? "");
    setLat(s.lat ?? null);
    setLng(s.lng ?? null);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!nome.trim() || !logradouro.trim() || !cidade.trim() || !uf.trim()) {
      setErro("Preencha nome, endereço e cidade.");
      return;
    }
    try {
      const novo = await criar.mutateAsync({
        nome: nome.trim(),
        logradouro: logradouro.trim(),
        numero: numero.trim() || undefined,
        bairro: bairro.trim() || undefined,
        cidade: cidade.trim(),
        uf: uf.trim().toUpperCase(),
        cep: cep ? cep.replace(/\D/g, "") : undefined,
        pontoReferencia: pontoReferencia.trim() || undefined,
        tipo,
        obraId,
        lat: lat ?? undefined,
        lng: lng ?? undefined,
      });
      onCreated(novo);
      reset();
      onClose();
    } catch (err) {
      setErro((err as Error).message || "Erro ao salvar local");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-background p-4 sm:max-w-md sm:rounded-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cadastrar local novo</h2>
          <Button variant="ghost" size="icon" onClick={() => { reset(); onClose(); }}>
            <X className="h-5 w-5" />
          </Button>
        </header>

        <form onSubmit={salvar} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do local *</Label>
            <Input
              required
              placeholder='ex: "Pedreira Souza Naves — balança 2"'
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Nome específico ajuda na conferência depois.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Buscar endereço</Label>
            <AddressAutocomplete
              value={logradouro}
              onChange={setLogradouro}
              onSelect={aplicarSugestao}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label>Número</Label>
              <Input value={numero} onChange={(e) => setNumero(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Bairro</Label>
              <Input value={bairro} onChange={(e) => setBairro(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Cidade *</Label>
              <Input required value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>UF *</Label>
              <Input
                required
                maxLength={2}
                value={uf}
                onChange={(e) => setUf(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Ponto de referência</Label>
            <Input
              value={pontoReferencia}
              onChange={(e) => setPontoReferencia(e.target.value)}
              placeholder='ex: "portaria fundos"'
            />
          </div>

          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
              <option value="AMBOS">Carga e descarga</option>
              <option value="CARGA">Apenas carga</option>
              <option value="DESCARGA">Apenas descarga</option>
            </Select>
          </div>

          {erro && <p className="text-sm text-red-600">{erro}</p>}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => { reset(); onClose(); }}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={criar.isPending}>
              {criar.isPending ? "Salvando..." : "Salvar local"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
