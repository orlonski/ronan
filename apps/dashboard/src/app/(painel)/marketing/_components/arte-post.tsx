"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useAuthToken, apiBaseUrl } from "@/lib/client-api";

/**
 * A arte do post na tela da fila.
 *
 * Busca por fetch e vira blob em vez de apontar um `<img src>` direto pro
 * endpoint: a rota exige Bearer token, e tag de imagem não manda header — o
 * `<img>` receberia 401 e mostraria quadrado quebrado. (O mesmo motivo pelo
 * qual a imagem autenticada ficava preta no app Android.)
 *
 * Revoga o object URL ao desmontar; sem isso, cada render vaza memória do
 * navegador numa tela que atualiza sozinha a cada 30 segundos.
 */
export function ArtePost({ postId, peca }: { postId: string; peca: string }) {
  const token = useAuthToken();
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    let criada: string | null = null;

    fetch(`${apiBaseUrl}/admin/marketing/instagram/${postId}/arte`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        if (!vivo) return;
        criada = URL.createObjectURL(blob);
        setUrl(criada);
      })
      .catch(() => vivo && setFalhou(true));

    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [postId, token]);

  if (falhou) {
    return (
      <div className="flex h-[180px] w-[144px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border bg-muted/30 text-muted-foreground">
        <ImageOff className="h-5 w-5" />
        <span className="text-xs">sem arte</span>
      </div>
    );
  }

  if (!url) {
    return <div className="h-[180px] w-[144px] shrink-0 animate-pulse rounded-md bg-muted" />;
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
      <img
        src={url}
        alt={`Arte do post ${peca}`}
        title="Abrir em tamanho real"
        className="h-[180px] w-[144px] rounded-md border object-cover object-top transition-opacity hover:opacity-90"
      />
    </a>
  );
}
