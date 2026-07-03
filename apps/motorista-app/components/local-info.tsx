import { Text, View } from "react-native";
import { MapPin, Smartphone } from "lucide-react-native";
import type { FonteGps } from "@ronan/shared-types";
import type { Local } from "@/lib/queries";

/**
 * Endereço resumido pra exibir embaixo do nome do local ("Rua X, 123 · Bairro").
 * Cruza com o catálogo (o LocalProximo da busca não traz logradouro/bairro, mas
 * o catálogo em cache sim). Retorna null quando não há endereço útil (local
 * recém-criado só com GPS, ou admin sem endereço).
 */
export function enderecoResumido(
  local: Pick<Local, "logradouro" | "numero" | "bairro"> | null | undefined,
): string | null {
  if (!local) return null;
  const rua = (local.logradouro ?? "").trim();
  const num = (local.numero ?? "").trim();
  const bairro = (local.bairro ?? "").trim();
  const linha1 = [rua, num].filter(Boolean).join(", ");
  const partes = [linha1, bairro].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

/**
 * Selo em linguagem de motorista avisando que a posição/local veio do cache do
 * celular (sem sinal no momento). Renderiza só quando faz sentido; caso
 * contrário, null (nada aparece com sinal bom).
 */
export function AvisoLocalCache({
  fonte,
  buscaOffline,
}: {
  fonte?: FonteGps | null;
  buscaOffline?: boolean | null;
}) {
  const posicaoDoCache = fonte === "CACHE";
  if (!posicaoDoCache && !buscaOffline) return null;
  // A posição do cache é o aviso mais forte (pode estar defasada); prioriza ele.
  const msg = posicaoDoCache
    ? "Você estava sem sinal — usei a última posição salva no seu celular. Confira se é aqui mesmo."
    : "Sem sinal agora — mostrei os lugares que já estavam salvos no seu celular.";
  return (
    <View className="mt-2 flex-row items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2">
      <Smartphone size={16} color="#b45309" style={{ marginTop: 1 }} />
      <Text className="flex-1 text-xs font-medium text-warning-foreground">{msg}</Text>
    </View>
  );
}

/** Linha de endereço + cidade/UF (ícone de pino). Some se não houver nada. */
export function LinhaEndereco({
  endereco,
  cidade,
  uf,
}: {
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
}) {
  const local = cidade && uf ? `${cidade}/${uf}` : cidade || null;
  const texto = [endereco, local].filter(Boolean).join(" · ");
  if (!texto) return null;
  return (
    <View className="mt-0.5 flex-row items-start gap-1">
      <MapPin size={13} color="#64748b" style={{ marginTop: 2 }} />
      <Text className="flex-1 text-xs text-muted-foreground">{texto}</Text>
    </View>
  );
}
