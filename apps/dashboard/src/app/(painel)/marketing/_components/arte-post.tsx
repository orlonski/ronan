"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Layers } from "lucide-react";
import { useAuthToken, apiBaseUrl } from "@/lib/client-api";

/**
 * A arte do post na tela da fila. Carrossel vira um visualizador com setas.
 *
 * Busca por fetch e vira blob em vez de apontar um `<img src>` direto pro
 * endpoint: a rota exige Bearer token, e tag de imagem não manda header — o
 * `<img>` receberia 401 e mostraria quadrado quebrado. (O mesmo motivo pelo
 * qual a imagem autenticada ficava preta no app Android.)
 *
 * Carrega slide sob demanda e guarda o que já baixou. Revisar um carrossel de 8
 * telas não pode custar 8 downloads antes de aparecer a capa — e o que importa
 * pra decidir "gostei" é a capa.
 */
export function ArtePost({
  postId,
  peca,
  slides = 1,
}: {
  postId: string;
  peca: string;
  slides?: number;
}) {
  const token = useAuthToken();
  const [indice, setIndice] = useState(0);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [falhou, setFalhou] = useState(false);

  // O token entra por ref, não por dependência do efeito.
  //
  // O access token gira a cada 15 minutos, e a tela recarrega sozinha a cada 30
  // segundos. Com o token no array de dependências, TODA rotação rebaixava
  // todas as miniaturas da fila de uma vez — piscada geral e download à toa,
  // num carrossel multiplicado por slide.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token ?? null;
  const temToken = Boolean(token);

  // Os object URLs criados, pra revogar no unmount. Sem isso cada render vaza
  // memória do navegador numa tela que se atualiza sozinha.
  const criadas = useRef<string[]>([]);
  useEffect(() => {
    const lista = criadas.current;
    return () => lista.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const baixar = useCallback(
    async (slide: number) => {
      const atual = tokenRef.current;
      if (!atual) return;
      try {
        const r = await fetch(
          `${apiBaseUrl}/admin/marketing/instagram/${postId}/arte?slide=${slide}`,
          { headers: { Authorization: `Bearer ${atual}` } },
        );
        if (!r.ok) throw new Error(String(r.status));
        const url = URL.createObjectURL(await r.blob());
        criadas.current.push(url);
        setUrls((antes) => (antes[slide] ? antes : { ...antes, [slide]: url }));
      } catch {
        // Só a capa marca a arte como quebrada. Um slide do meio que não veio é
        // problema daquele slide, e dizer "sem arte" esconderia o resto.
        if (slide === 0) setFalhou(true);
      }
    },
    [postId],
  );

  useEffect(() => {
    if (!temToken || urls[indice]) return;
    void baixar(indice);
  }, [temToken, indice, urls, baixar]);

  const url = urls[indice];
  const carrossel = slides > 1;
  const ir = (passo: number) => setIndice((i) => Math.min(slides - 1, Math.max(0, i + passo)));

  if (falhou) {
    return (
      <div className="flex h-[180px] w-[144px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border bg-muted/30 text-muted-foreground">
        <ImageOff className="h-5 w-5" />
        <span className="text-xs">sem arte</span>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div className="relative h-[180px] w-[144px]">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              src={url}
              alt={
                carrossel
                  ? `Slide ${indice + 1} de ${slides} do post ${peca}`
                  : `Arte do post ${peca}`
              }
              title="Abrir em tamanho real"
              className="h-[180px] w-[144px] rounded-md border object-cover object-top transition-opacity hover:opacity-90"
            />
          </a>
        ) : (
          <div className="h-[180px] w-[144px] animate-pulse rounded-md bg-muted" />
        )}

        {carrossel ? (
          <span className="absolute right-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <Layers className="h-3 w-3" />
            {indice + 1}/{slides}
          </span>
        ) : null}
      </div>

      {carrossel ? (
        <div className="mt-1 flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => ir(-1)}
            disabled={indice === 0}
            aria-label="Slide anterior"
            className="rounded border p-1 text-muted-foreground enabled:hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {/* Os pontinhos também são o aviso de que há mais tela do que a capa. */}
          <span className="flex gap-1">
            {Array.from({ length: slides }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === indice ? "bg-foreground" : "bg-muted-foreground/30"}`}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={() => ir(1)}
            disabled={indice === slides - 1}
            aria-label="Próximo slide"
            className="rounded border p-1 text-muted-foreground enabled:hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
