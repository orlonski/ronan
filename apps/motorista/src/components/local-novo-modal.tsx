import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { humanizeApiError } from "@/lib/api";
import { humanizeZodError } from "@/lib/validation";
import { useCriarLocal, type Local } from "@/lib/queries";
import { z } from "zod";

const LocalNovoInput = z.object({
  nome: z.string().min(2, "Nome muito curto").max(120),
  cidade: z.string().min(2, "Cidade obrigatória").max(80),
  uf: z.string().length(2, "UF: 2 letras"),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]),
  logradouro: z.string().min(2, "Endereço obrigatório").max(160),
  numero: z.string().max(20).optional(),
  bairro: z.string().max(60).optional(),
  cep: z.string().max(10).optional(),
  pontoReferencia: z.string().max(160).optional(),
});

const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA",
  "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN",
  "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

/**
 * Modal pra motorista cadastrar local novo direto do Nova Viagem
 * sem perder o que já preencheu. Espelha o local-novo-modal do nativo
 * simplificado pro PWA (sem busca via GPS).
 */
export function LocalNovoModal({
  open,
  tipo,
  clienteId,
  onClose,
  onCreated,
}: {
  open: boolean;
  tipo: "CARGA" | "DESCARGA" | "AMBOS";
  clienteId?: string;
  onClose: () => void;
  onCreated: (l: Local) => void;
}) {
  const criar = useCriarLocal();
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("SP");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [referencia, setReferencia] = useState("");

  useEffect(() => {
    if (!open) return;
    setErro(null);
    setNome("");
    setCidade("");
    setUf("SP");
    setLogradouro("");
    setNumero("");
    setBairro("");
    setReferencia("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const parsed = LocalNovoInput.safeParse({
      nome: nome.trim(),
      cidade: cidade.trim(),
      uf: uf.toUpperCase(),
      tipo,
      logradouro: logradouro.trim(),
      numero: numero.trim() || undefined,
      bairro: bairro.trim() || undefined,
      pontoReferencia: referencia.trim() || undefined,
    });
    if (!parsed.success) {
      setErro(humanizeZodError(parsed.error));
      return;
    }
    try {
      const novo = await criar.mutateAsync({
        ...parsed.data,
        clienteIds: clienteId ? [clienteId] : [],
      });
      onCreated(novo);
      onClose();
    } catch (err) {
      setErro(humanizeApiError(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="bg-brand px-4 pb-3 pt-safe">
        <div className="flex items-center gap-3 pt-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
          >
            <X size={22} color="white" />
          </button>
          <h2 className="flex-1 truncate text-2xl font-bold text-white">
            Cadastrar local de {tipo === "CARGA" ? "carga" : tipo === "DESCARGA" ? "descarga" : "carga/descarga"}
          </h2>
        </div>
      </div>

      <form onSubmit={salvar} className="flex-1 space-y-4 overflow-y-auto p-4 pb-32">
        <div className="space-y-2">
          <Label htmlFor="ln-nome">Nome do local</Label>
          <Input
            id="ln-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Pedreira Bom Jardim"
            maxLength={120}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ln-end">Endereço</Label>
          <Input
            id="ln-end"
            value={logradouro}
            onChange={(e) => setLogradouro(e.target.value)}
            placeholder="Rua ou rodovia"
            maxLength={160}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ln-num">Número</Label>
            <Input
              id="ln-num"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="opcional"
              maxLength={20}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ln-bairro">Bairro</Label>
            <Input
              id="ln-bairro"
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              placeholder="opcional"
              maxLength={60}
            />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div className="space-y-2">
            <Label htmlFor="ln-cidade">Cidade</Label>
            <Input
              id="ln-cidade"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              placeholder="Cidade"
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label>UF</Label>
            <Select
              value={uf}
              onChange={setUf}
              options={UFS.map((u) => ({ value: u, label: u }))}
              title="UF"
              placeholder="UF"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ln-ref">Ponto de referência</Label>
          <Input
            id="ln-ref"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="opcional — ajuda a identificar"
            maxLength={160}
          />
        </div>

        {erro && (
          <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
            <p className="text-base font-medium text-destructive whitespace-pre-line">{erro}</p>
          </div>
        )}
      </form>

      <div className="border-t border-border bg-background p-4 pb-safe">
        <Button
          onClick={salvar}
          size="xl"
          className="w-full"
          loading={criar.isPending}
        >
          {criar.isPending ? "Salvando..." : "Salvar local"}
        </Button>
      </div>
    </div>
  );
}
