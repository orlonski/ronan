"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { ChevronLeft, ChevronRight, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useAuthToken } from "@/lib/client-api";

export type FotoVisualizavel = {
  id: string;
  /** Caminho na API da foto INTEIRA, ex.: `/admin/abastecimentos/<id>/fotos/<fotoId>`. */
  caminho: string;
  rotacao: number;
  /** Blob URL que a tela já tem (miniatura ou a própria foto): aparece na hora. */
  previa?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** A foto inteira, autenticada, em blob URL — guardada pra reabrir sem esperar. */
function useFotoInteira(caminho: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["foto-inteira", caminho],
    enabled: !!token && !!caminho,
    staleTime: 30 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    queryFn: () => baixar(caminho!, token),
  });
}

async function baixar(caminho: string, token: string | undefined): Promise<string> {
  const res = await fetch(`${API_URL}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Ver a foto de perto, NA PRÓPRIA TELA.
 *
 * ⚠️ Nunca aba nova: quem confere comprovante abre várias fotos seguidas, e
 * aba nova tira a pessoa da tela de trabalho — o dono foi taxativo. Aqui abre
 * por cima, fecha com Esc/X/clique no fundo, e volta pro mesmo lugar.
 *
 * - Abre JÁ com a prévia que a tela tem; a foto inteira (1–2s, servidor na
 *   Europa) troca por cima quando chega, e a próxima é baixada adiantado.
 * - Zoom é o motivo de existir (ler litro, peso, odômetro): roda do mouse no
 *   ponto do cursor, duplo clique, pinça no celular, e botões pra quem não usa
 *   roda. Ampliada, arrasta.
 * - Girar considera a foto DEITADA: largura e altura trocam antes de caber na
 *   tela. O overlay antigo girava por CSS depois de medir, e foto de lado
 *   estourava a tela.
 * - Remover e recortar ficam fora, na miniatura: quem está lendo número não
 *   pode apagar foto sem querer.
 */
export function VisualizadorFotos({
  fotos,
  indice,
  onIndice,
  onFechar,
  onGirar,
  titulo = "Foto",
}: {
  fotos: FotoVisualizavel[];
  indice: number | null;
  onIndice: (i: number) => void;
  onFechar: () => void;
  /** Salva a nova rotação. Sem isso, o botão de girar não aparece. */
  onGirar?: (foto: FotoVisualizavel, rotacao: number) => void;
  titulo?: string;
}) {
  const aberto = indice !== null && indice >= 0 && indice < fotos.length;
  const foto = aberto ? fotos[indice] : undefined;
  const total = fotos.length;
  const token = useAuthToken();
  const qc = useQueryClient();

  // Giro mostrado na hora; o salvo chega depois pelo `fotos` da tela.
  const [giro, setGiro] = useState<Record<string, number>>({});
  const rotacao = foto ? (giro[foto.id] ?? foto.rotacao) : 0;
  // Zera quando a rotação SALVA muda (a tela recarregou), não a cada render:
  // `fotos` é um array novo toda vez.
  const salvas = fotos.map((f) => `${f.id}:${f.rotacao}`).join("|");
  useEffect(() => setGiro({}), [salvas]);

  const inteira = useFotoInteira(foto?.caminho);
  const src = inteira.data ?? foto?.previa;

  // Adianta a próxima: passar de foto não pode ser esperar de novo.
  useEffect(() => {
    if (!aberto || total < 2 || !token) return;
    const prox = fotos[(indice + 1) % total];
    if (!prox) return;
    void qc.prefetchQuery({
      queryKey: ["foto-inteira", prox.caminho],
      queryFn: () => baixar(prox.caminho, token),
      staleTime: 30 * 60_000,
    });
  }, [aberto, indice, total, fotos, token, qc]);

  const ir = useCallback(
    (passo: number) => {
      if (!aberto || total < 2) return;
      onIndice((indice + passo + total) % total);
    },
    [aberto, indice, total, onIndice],
  );

  const girar = useCallback(() => {
    if (!foto || !onGirar) return;
    const nova = (rotacao + 90) % 360;
    setGiro((g) => ({ ...g, [foto.id]: nova }));
    onGirar(foto, nova);
  }, [foto, onGirar, rotacao]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") ir(1);
      else if (e.key === "ArrowLeft") ir(-1);
      else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) girar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, ir, girar]);

  // Área útil e tamanho natural da foto, pra caber já girada.
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  // Foto nova: esquece o tamanho da anterior, senão ela aparece distorcida
  // até carregar.
  useEffect(() => setNatural({ w: 0, h: 0 }), [foto?.id]);
  useLayoutEffect(() => {
    if (!aberto) return;
    const el = areaRef.current;
    if (!el) return;
    const medir = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aberto]);

  const deitada = rotacao === 90 || rotacao === 270;
  const bw = deitada ? natural.h : natural.w;
  const bh = deitada ? natural.w : natural.h;
  const escala = bw && bh && area.w && area.h ? Math.min(area.w / bw, area.h / bh) : 0;
  const caixa = { w: bw * escala, h: bh * escala };
  const img = { w: natural.w * escala, h: natural.h * escala };

  // Clique no fundo fecha — mas não o clique que terminou um arraste.
  const inicio = useRef<{ x: number; y: number } | null>(null);

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{titulo}</DialogPrimitive.Title>
          {foto && (
            <TransformWrapper
              // Remonta ao trocar de foto, girar, ou quando o tamanho fica conhecido:
              // é o que recentraliza e volta o zoom pra "caber na tela".
              key={`${foto.id}-${rotacao}-${escala > 0}`}
              minScale={1}
              maxScale={8}
              centerOnInit
              centerZoomedOut
              doubleClick={{ mode: "toggle", step: 1.5 }}
              wheel={{ step: 0.15 }}
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <div className="flex items-center gap-1 px-3 py-2 sm:px-4">
                    <p className="min-w-0 flex-1 truncate text-sm text-white/80">
                      {titulo}
                      {total > 1 && ` · ${indice! + 1} de ${total}`}
                      {inteira.isLoading && foto.previa && (
                        <span className="ml-2 text-white/50">carregando a foto inteira…</span>
                      )}
                    </p>
                    <BotaoIcone rotulo="Diminuir" onClick={() => zoomOut()}>
                      <ZoomOut className="h-5 w-5" />
                    </BotaoIcone>
                    <BotaoIcone rotulo="Ampliar" onClick={() => zoomIn()}>
                      <ZoomIn className="h-5 w-5" />
                    </BotaoIcone>
                    <BotaoIcone rotulo="Ajustar à tela" onClick={() => resetTransform()}>
                      <Maximize2 className="h-5 w-5" />
                    </BotaoIcone>
                    {onGirar && (
                      <BotaoIcone rotulo="Girar 90° (R)" onClick={girar}>
                        <RotateCw className="h-5 w-5" />
                      </BotaoIcone>
                    )}
                    <DialogPrimitive.Close asChild>
                      <BotaoIcone rotulo="Fechar foto (Esc)">
                        <X className="h-6 w-6" />
                      </BotaoIcone>
                    </DialogPrimitive.Close>
                  </div>

                  <div
                    ref={areaRef}
                    className="relative min-h-0 flex-1"
                    onPointerDown={(e) => (inicio.current = { x: e.clientX, y: e.clientY })}
                    onClick={(e) => {
                      const i = inicio.current;
                      const parado = !i || Math.hypot(e.clientX - i.x, e.clientY - i.y) < 5;
                      const naFoto = (e.target as HTMLElement).closest("[data-foto]");
                      if (parado && !naFoto) onFechar();
                    }}
                  >
                    <TransformComponent
                      wrapperStyle={{ width: "100%", height: "100%" }}
                      contentStyle={{ width: caixa.w || "auto", height: caixa.h || "auto" }}
                    >
                      <div data-foto className="relative" style={{ width: caixa.w, height: caixa.h }}>
                        {src && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={src}
                            alt={titulo}
                            draggable={false}
                            onLoad={(e) =>
                              setNatural({
                                w: e.currentTarget.naturalWidth,
                                h: e.currentTarget.naturalHeight,
                              })
                            }
                            className="absolute left-1/2 top-1/2 max-w-none select-none"
                            style={{
                              width: img.w || undefined,
                              height: img.h || undefined,
                              transform: `translate(-50%, -50%) rotate(${rotacao}deg)`,
                              visibility: escala ? "visible" : "hidden",
                            }}
                          />
                        )}
                      </div>
                    </TransformComponent>
                    {!src && !inteira.isError && (
                      <p className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
                        Carregando a foto…
                      </p>
                    )}
                    {inteira.isError && !src && (
                      <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                        Não deu pra carregar a foto.
                      </p>
                    )}
                    {total > 1 && (
                      <>
                        <BotaoIcone
                          rotulo="Foto anterior (←)"
                          onClick={() => ir(-1)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50"
                        >
                          <ChevronLeft className="h-7 w-7" />
                        </BotaoIcone>
                        <BotaoIcone
                          rotulo="Próxima foto (→)"
                          onClick={() => ir(1)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50"
                        >
                          <ChevronRight className="h-7 w-7" />
                        </BotaoIcone>
                      </>
                    )}
                  </div>
                  <p className="hidden px-4 py-2 text-center text-xs text-white/40 sm:block">
                    Roda do mouse ou duplo clique pra ampliar · arraste pra mover
                    {total > 1 && " · ← → troca de foto"}
                  </p>
                </>
              )}
            </TransformWrapper>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function BotaoIcone({
  rotulo,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      className={`rounded-full p-2 text-white/90 transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${className}`}
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
