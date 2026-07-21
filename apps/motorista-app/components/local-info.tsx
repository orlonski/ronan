import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { ImageOff, MapPin, WifiOff } from "lucide-react-native";
import type { FonteGps } from "@ronan/shared-types";
import type { Local } from "@/lib/queries";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";

/**
 * Foto do ponto (Street View onde existe; satélite onde não há cobertura) pra o
 * motorista RECONHECER o lugar — o nome e a distância não dizem se é ali mesmo.
 * Vem do backend (a chave do Google não vai ao app) e é cacheada por coordenada.
 *
 * Precisa de rede: offline/erro cai num placeholder neutro. O `<Image>` só monta
 * com o token pronto — sem isso o Fresco (Android) cacheia o 401 e a foto fica
 * preta pra sempre.
 */
export function FotoLocal({
  lat,
  lng,
  altura = 120,
  redondo = false,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  altura?: number;
  /** Miniatura quadrada (ex: no lugar do avatar do card selecionado). */
  redondo?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    void loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);

  if (lat == null || lng == null) return null;

  const estilo = redondo
    ? { width: altura, height: altura, borderRadius: 12 }
    : { width: "100%" as const, height: altura, borderRadius: 12 };

  if (!token || falhou) {
    return (
      <View
        style={estilo}
        className="items-center justify-center border border-dashed border-border bg-muted/40"
      >
        <ImageOff size={redondo ? 18 : 22} color="#94a3b8" />
        {!redondo && (
          <Text className="mt-1 text-xs text-muted-foreground">
            Foto indisponível sem internet
          </Text>
        )}
      </View>
    );
  }

  return (
    <Image
      source={{
        uri: `${API_URL}/m/locais/imagem?lat=${lat}&lng=${lng}`,
        headers: { Authorization: `Bearer ${token}` },
      }}
      style={estilo}
      resizeMode="cover"
      onError={() => setFalhou(true)}
    />
  );
}

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
 * Banner de IMPACTO "sem sinal". Pensado pro motorista de idade / cansado: ícone
 * grande, título forte em negrito e a explicação embaixo — não um textinho que
 * passa batido. `mt` controla o espaçamento superior conforme o contexto.
 */
function BannerSemSinal({
  titulo,
  sub,
  mt = "mt-2",
}: {
  titulo: string;
  sub: string;
  mt?: string;
}) {
  return (
    <View
      className={`${mt} flex-row items-center gap-3 rounded-2xl border-2 border-warning/60 bg-warning/15 p-4`}
    >
      <WifiOff size={30} color="#b45309" strokeWidth={2.5} />
      <View className="flex-1">
        <Text className="text-lg font-extrabold text-foreground">{titulo}</Text>
        <Text className="mt-0.5 text-sm font-semibold text-warning-foreground">{sub}</Text>
      </View>
    </View>
  );
}

/**
 * Aviso (no card do local selecionado) de que a posição/local veio do cache do
 * celular por falta de sinal. Renderiza só quando faz sentido; null com sinal bom.
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
  // Posição do cache é o aviso mais forte (pode estar defasada); prioriza ele.
  return posicaoDoCache ? (
    <BannerSemSinal
      titulo="Você estava sem internet"
      sub="Peguei a última posição salva no seu celular. Olhe no mapa e confirme se é aqui mesmo."
    />
  ) : (
    <BannerSemSinal
      titulo="Você está sem internet"
      sub="Mostrei os lugares que já estavam salvos no seu celular. Pode ter faltado algum novo."
    />
  );
}

/** Banner "sem sinal" pro topo da lista "achei X perto". */
export function AvisoListaCache() {
  return (
    <BannerSemSinal
      titulo="Você está sem internet"
      sub="Mostrando só os lugares já salvos no seu celular. Se não achar o certo, cadastre um novo."
      mt="mt-0"
    />
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
