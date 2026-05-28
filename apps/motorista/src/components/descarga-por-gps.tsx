import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { haversineMetros, pegarCoords, RAIO_ALERTA_CARGA_M } from "@/lib/geo";
import {
  buscarLocaisProximos,
  useCriarLocalRapido,
  type LocalProximo,
} from "@/lib/queries";

type Estado =
  | { tipo: "vazio" }
  | { tipo: "capturando" }
  | {
      tipo: "selecionado";
      local: { id: string; nome: string };
      distanciaMetros?: number;
      vezesUsado?: number;
    }
  | { tipo: "escolha"; matches: LocalProximo[]; coords: { lat: number; lng: number } }
  | { tipo: "sem_match"; coords: { lat: number; lng: number } };

/**
 * Botão "Estou no local de descarga": pega GPS pontual via Geolocation API,
 * busca matches no catálogo via /m/locais/proximos e:
 *  - 0 matches: pede nome rápido → cria via /m/locais/rapido (backend faz reverse geocode)
 *  - 1 match: usa direto
 *  - N matches: mostra lista pra motorista escolher
 *
 * Alerta se o GPS atual está dentro de RAIO_ALERTA_CARGA_M do local de carga
 * já selecionado — evita motorista lançar descarga no próprio carregamento.
 */
export function DescargaPorGps({
  clienteId,
  value,
  onChange,
  nomeSelecionadoFallback,
  localCargaCoords,
}: {
  clienteId: string | null;
  value: string;
  onChange: (id: string) => void;
  nomeSelecionadoFallback?: string;
  localCargaCoords?: { lat: number; lng: number; nome: string } | null;
}) {
  const [estado, setEstado] = useState<Estado>(() =>
    value && nomeSelecionadoFallback
      ? { tipo: "selecionado", local: { id: value, nome: nomeSelecionadoFallback } }
      : { tipo: "vazio" },
  );
  const [erro, setErro] = useState<string | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  const criar = useCriarLocalRapido();

  // Quando o value externo zera (ex: modo edit reset), reflete no estado
  useEffect(() => {
    if (!value && estado.tipo === "selecionado") {
      setEstado({ tipo: "vazio" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Bloqueia scroll do body quando modal "sem_match" aberto
  useEffect(() => {
    if (estado.tipo !== "sem_match") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [estado.tipo]);

  async function capturarEBuscar() {
    setErro(null);
    setEstado({ tipo: "capturando" });
    const coords = await pegarCoords();
    if (!coords) {
      setEstado({ tipo: "vazio" });
      setErro("Não consegui pegar o GPS. Verifique a permissão do navegador e tente de novo.");
      return;
    }

    if (localCargaCoords) {
      const distCarga = haversineMetros(
        coords.lat,
        coords.lng,
        localCargaCoords.lat,
        localCargaCoords.lng,
      );
      if (distCarga <= RAIO_ALERTA_CARGA_M) {
        const continua = window.confirm(
          `Você está a ${Math.round(distCarga)}m de "${localCargaCoords.nome}" (local de carga). A viagem deve ser lançada na descarga, não no carregamento. Continuar mesmo assim?`,
        );
        if (!continua) {
          setEstado({ tipo: "vazio" });
          return;
        }
      }
    }

    try {
      const matches = await buscarLocaisProximos({
        lat: coords.lat,
        lng: coords.lng,
        tipoUso: "descarga",
        raioM: 500,
        limit: 5,
      });
      if (matches.length === 0) {
        setEstado({ tipo: "sem_match", coords });
        setNomeNovo("");
      } else if (matches.length === 1) {
        const m = matches[0]!;
        onChange(m.id);
        setEstado({
          tipo: "selecionado",
          local: { id: m.id, nome: m.nome },
          distanciaMetros: m.distanciaMetros,
          vezesUsado: m.vezesUsadoMotorista,
        });
      } else {
        setEstado({ tipo: "escolha", matches, coords });
      }
    } catch (err) {
      setErro((err as Error).message || "Erro ao buscar locais próximos");
      setEstado({ tipo: "vazio" });
    }
  }

  function escolherMatch(m: LocalProximo) {
    onChange(m.id);
    setEstado({
      tipo: "selecionado",
      local: { id: m.id, nome: m.nome },
      distanciaMetros: m.distanciaMetros,
      vezesUsado: m.vezesUsadoMotorista,
    });
  }

  function abrirSemMatch() {
    if (estado.tipo === "escolha") {
      setEstado({ tipo: "sem_match", coords: estado.coords });
      setNomeNovo("");
    }
  }

  async function salvarNomeNovo(e?: React.FormEvent) {
    e?.preventDefault();
    if (estado.tipo !== "sem_match") return;
    const nome = nomeNovo.trim();
    if (nome.length < 2) {
      setErro("Digite um nome de pelo menos 2 letras.");
      return;
    }
    setErro(null);
    try {
      const novo = await criar.mutateAsync({
        nome,
        lat: estado.coords.lat,
        lng: estado.coords.lng,
        tipo: "DESCARGA",
        clienteIds: clienteId ? [clienteId] : undefined,
      });
      onChange(novo.id);
      setEstado({ tipo: "selecionado", local: { id: novo.id, nome: novo.nome } });
    } catch (err) {
      setErro((err as Error).message || "Erro ao criar o local");
    }
  }

  function trocar() {
    onChange("");
    setEstado({ tipo: "vazio" });
    setErro(null);
  }

  return (
    <div className="space-y-2">
      <Label>Local de descarga</Label>

      {estado.tipo === "vazio" && (
        <Button onClick={capturarEBuscar} size="lg" className="h-16 w-full">
          <MapPin size={22} />
          Estou no local de descarga
        </Button>
      )}

      {estado.tipo === "capturando" && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-border bg-muted/30 p-4">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-r-transparent" />
          <p className="text-base font-medium text-muted-foreground">Pegando localização...</p>
        </div>
      )}

      {estado.tipo === "selecionado" && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success">
            <CheckCircle2 size={20} color="white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-foreground line-clamp-2">{estado.local.nome}</p>
            {(estado.distanciaMetros != null || estado.vezesUsado != null) && (
              <p className="mt-0.5 text-sm text-muted-foreground tabular">
                {estado.distanciaMetros != null && `${estado.distanciaMetros}m do GPS`}
                {estado.distanciaMetros != null && estado.vezesUsado ? " · " : ""}
                {estado.vezesUsado ? `usado ${estado.vezesUsado}x em 90d` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={trocar}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground active:opacity-75"
          >
            Trocar
          </button>
        </div>
      )}

      {estado.tipo === "escolha" && (
        <div className="space-y-2 rounded-2xl border-2 border-border bg-card p-3">
          <p className="text-sm font-medium text-foreground">
            Achei {estado.matches.length} perto. Qual é?
          </p>
          {estado.matches.map((m, i) => (
            <button
              type="button"
              key={m.id}
              onClick={() => escolherMatch(m)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left active:opacity-70"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-base font-bold text-primary">{i + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-base font-semibold text-foreground">{m.nome}</p>
                <p className="text-xs text-muted-foreground tabular">
                  {m.distanciaMetros}m · {m.cidade}/{m.uf}
                  {m.vezesUsadoMotorista > 0 ? ` · usado ${m.vezesUsadoMotorista}x` : ""}
                </p>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={abrirSemMatch}
            className="mt-1 block w-full p-2 text-center text-sm font-medium text-primary active:opacity-70"
          >
            Nenhum desses — criar novo
          </button>
        </div>
      )}

      {erro && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {estado.tipo === "sem_match" && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border p-4 pt-safe">
            <h2 className="text-lg font-bold text-foreground">Como chama esse lugar?</h2>
            <button
              type="button"
              onClick={() => setEstado({ tipo: "vazio" })}
              aria-label="Fechar"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-muted"
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={salvarNomeNovo} className="flex-1 space-y-4 p-5">
            <p className="text-sm text-muted-foreground">
              Não conheço esse lugar aqui — me ajuda dando um nome rápido.
            </p>

            <div className="space-y-2">
              <Label htmlFor="novo-nome">Nome do local</Label>
              <Input
                id="novo-nome"
                value={nomeNovo}
                onChange={(e) => setNomeNovo(e.target.value)}
                placeholder='ex: "Obra do shopping", "Construtora X"'
                autoFocus
                maxLength={120}
              />
              <p className="text-xs text-muted-foreground">
                Gravamos o GPS aqui. Endereço completo o escritório completa depois.
              </p>
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </form>

          <div className="flex gap-3 border-t border-border p-4 pb-safe">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setEstado({ tipo: "vazio" })}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => void salvarNomeNovo()}
              loading={criar.isPending}
            >
              Salvar local
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
