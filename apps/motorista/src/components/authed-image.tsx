import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * `<img>` que busca a foto autenticando com Bearer token. Browser não permite
 * setar headers em `<img src>` direto, então fazemos fetch → blob → object URL.
 *
 * Revoga o object URL ao desmontar pra não vazar memória.
 */
export function AuthedImage({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let revoke: string | null = null;
    setErro(null);
    setSrc(null);
    void (async () => {
      try {
        const tokens = loadTokens();
        const res = await fetch(`${API_URL}${path}`, {
          headers: tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        revoke = url;
        setSrc(url);
      } catch (e) {
        if (alive) setErro((e as Error).message ?? "Erro ao carregar foto");
      }
    })();
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);

  if (erro) {
    return (
      <div className={cn("flex h-48 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground", className)}>
        {erro}
      </div>
    );
  }

  if (!src) {
    return <div className={cn("skeleton-pulse h-48 rounded-lg bg-muted", className)} />;
  }

  return <img src={src} alt={alt} className={cn("w-full rounded-lg object-cover", className)} />;
}
