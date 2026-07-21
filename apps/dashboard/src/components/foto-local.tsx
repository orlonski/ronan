"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { useAuthToken } from "@/lib/client-api";

/**
 * Foto do ponto pra responder "o pin caiu no lugar certo?" — o lat/lng num mapa
 * não responde isso. Street View quando existe; satélite quando não há cobertura
 * (comum em pedreira/obra rural). Vem do backend (a chave do Google nunca vai ao
 * cliente) e é cacheada por coordenada. Sem imagem → placeholder discreto.
 */
export function FotoLocal({
  lat,
  lng,
  className = "h-[280px]",
}: {
  lat: number;
  lng: number;
  className?: string;
}) {
  const token = useAuthToken();

  const q = useQuery({
    queryKey: ["local-foto", lat.toFixed(5), lng.toFixed(5)],
    enabled: !!token,
    staleTime: 30 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(
        `${apiUrl}/admin/locais/imagem?lat=${lat}&lng=${lng}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Header exposto via CORS (exposedHeaders no main.ts da API).
      const tipo = res.headers.get("X-Imagem-Tipo") ?? "";
      const blob = await res.blob();
      return { url: URL.createObjectURL(blob), tipo };
    },
  });

  if (q.isLoading) {
    return <div className={`w-full animate-pulse rounded-md border bg-muted ${className}`} />;
  }

  if (q.error || !q.data) {
    return (
      <div
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground ${className}`}
      >
        <ImageOff className="h-6 w-6 opacity-40" />
        <span>Sem imagem deste ponto</span>
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden rounded-md border ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={q.data.url}
        alt="Imagem do local"
        className="h-full w-full object-cover"
      />
      <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
        {q.data.tipo === "SATELITE" ? "Satélite" : "Street View"}
      </span>
    </div>
  );
}
