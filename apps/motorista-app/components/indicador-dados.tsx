import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { forcarAtualizarDados, useUltimaAtualizacaoDados } from "@/lib/queries";
import { showAlert } from "@/lib/alert";

// > 24h sem baixar dados = pode estar desatualizado (motorista offline o dia todo).
const LIMITE_STALE_MS = 24 * 60 * 60 * 1000;

function haQuanto(ts: number, agora: number): string {
  const min = Math.floor((agora - ts) / 60_000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

/**
 * "Dados atualizados há X" no cabeçalho — mostra quão fresco está o catálogo
 * (locais/clientes/materiais) que o motorista usa pra lançar viagem, inclusive
 * offline. Toca pra forçar a atualização (bate na rede). Fica âmbar quando passa
 * de 24h (provável dado velho de quem ficou sem sinal).
 */
export function IndicadorDados() {
  const ts = useUltimaAtualizacaoDados();
  const qc = useQueryClient();
  const [atualizando, setAtualizando] = useState(false);
  // Bump por minuto pra o "há X" não congelar com a home aberta.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function atualizar() {
    if (atualizando) return;
    setAtualizando(true);
    try {
      await forcarAtualizarDados(qc);
    } catch {
      void showAlert({
        title: "Sem conexão",
        message:
          "Não deu pra atualizar os dados agora. Assim que pegar sinal, o app atualiza sozinho.",
      });
    } finally {
      setAtualizando(false);
    }
  }

  const stale = ts != null && Date.now() - ts > LIMITE_STALE_MS;
  const cor = ts == null || stale ? "text-amber-200" : "text-white/60";

  const texto = atualizando
    ? "Atualizando dados…"
    : ts == null
      ? "Dados ainda não baixados"
      : `Dados atualizados ${haQuanto(ts, Date.now())}`;

  return (
    <Pressable
      onPress={atualizar}
      disabled={atualizando}
      className="mt-2 flex-row items-center gap-1.5 active:opacity-70"
      hitSlop={8}
    >
      {atualizando ? (
        <ActivityIndicator size="small" color="#fde68a" />
      ) : (
        <RefreshCw size={12} color={stale || ts == null ? "#fde68a" : "#ffffff99"} />
      )}
      <Text className={`text-xs font-medium ${cor}`}>{texto}</Text>
    </Pressable>
  );
}
