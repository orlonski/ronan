import { useEffect, useState } from "react";
import { Plus } from "lucide-react-native";
import { Image, Text, View } from "react-native";
import { cn } from "@/lib/utils";

/** Iniciais do nome (1ª + última palavra), tipo fallback de avatar do Instagram. */
export function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

type Ring = "none" | "unseen" | "seen";

/**
 * Avatar de motorista com iniciais em círculo + anel de story (estilo IG):
 * - unseen: anel laranja (tem story não visto)
 * - seen:   anel cinza (já viu tudo)
 * - none:   sem anel
 * `plus` sobrepõe o "+" (item "Seu story" pra postar).
 */
export function StoryAvatar({
  nome,
  size = 64,
  ring = "none",
  plus = false,
  fotoUri,
  fotoHeaders,
}: {
  nome: string;
  size?: number;
  ring?: Ring;
  plus?: boolean;
  /** Se presente, mostra a foto no círculo em vez das iniciais (prévia do story). */
  fotoUri?: string;
  /** Headers (ex: Authorization) quando a foto é remota e protegida. */
  fotoHeaders?: Record<string, string>;
}) {
  // Se a foto falhar (rede ruim, sem retry no <Image>), cai nas iniciais em vez
  // de ficar em branco. Reseta a cada nova URL.
  const [erroFoto, setErroFoto] = useState(false);
  useEffect(() => setErroFoto(false), [fotoUri]);

  const anelCor =
    ring === "unseen" ? "bg-primary" : ring === "seen" ? "bg-border" : "bg-transparent";
  const gap = ring === "none" ? 0 : 3;
  const interno = size - gap * 2 - (ring === "none" ? 0 : 4);

  return (
    <View style={{ width: size, height: size }}>
      <View
        className={cn("items-center justify-center rounded-full", anelCor)}
        style={{ width: size, height: size, padding: gap }}
      >
        <View
          className="items-center justify-center rounded-full bg-background"
          style={{ width: size - gap * 2, height: size - gap * 2, padding: ring === "none" ? 0 : 2 }}
        >
          {fotoUri && !erroFoto ? (
            <Image
              source={{ uri: fotoUri, headers: fotoHeaders }}
              onError={() => setErroFoto(true)}
              style={{
                width: interno,
                height: interno,
                borderRadius: interno / 2,
                backgroundColor: "#13316b",
              }}
            />
          ) : (
            <View
              className="items-center justify-center rounded-full bg-brand"
              style={{ width: interno, height: interno }}
            >
              <Text
                className="font-bold text-white"
                style={{ fontSize: Math.round(interno * 0.36) }}
              >
                {iniciaisDoNome(nome)}
              </Text>
            </View>
          )}
        </View>
      </View>
      {plus && (
        <View
          className="absolute items-center justify-center rounded-full border-2 border-background bg-primary"
          style={{ width: 22, height: 22, right: -1, bottom: -1 }}
        >
          <Plus size={14} color="white" strokeWidth={3} />
        </View>
      )}
    </View>
  );
}
