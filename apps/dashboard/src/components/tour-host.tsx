"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import {
  aoEncerrarTour,
  avancarTour,
  comecarTour,
  encerrarTour,
  limparPedidoTour,
  medirAlvo,
  pedidoDeTour,
  useTour,
  voltarTour,
  type PassoTour,
} from "@/lib/tour";

type TourDaRota = {
  chave: string;
  automatico: boolean;
  visto: boolean;
  passos: PassoTour[];
};

const FOLGA = 10; // respiro entre o furo e a borda do elemento
const GAP = 14; // distância do balão até o furo
const BALAO_ALTURA = 190; // estimativa pra decidir se o balão cabe embaixo

/**
 * O foco de luz sobre a tela.
 *
 * Montado UMA vez no shell, irmão do `<AceiteTermos/>` — e sempre perdendo
 * para ele: o aceite é bloqueante e cobre o painel inteiro, então um tour por
 * baixo apontaria para coisas que ninguém consegue ver nem clicar.
 *
 * Por que não Radix Dialog: ele põe `pointer-events: none` no body e prende o
 * foco. Isso mata o recorte (o furo precisa deixar o fundo visível) e briga
 * com o modal dos Termos. Aqui é um `position: fixed` na raiz e um `<svg>` com
 * `<mask>` — que ainda dá o canto arredondado de graça, coisa que os quatro
 * painéis escuros do app do motorista não davam.
 */
export function TourHost() {
  const pathname = usePathname();
  const token = useAuthToken();
  const qc = useQueryClient();
  const { assumida } = usePermissoes();
  const tour = useTour();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const jaAbriu = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["tour", pathname],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: () =>
      fetchApi<TourDaRota | null>(`/admin/onboarding/tour?rota=${encodeURIComponent(pathname)}`, {
        token,
      }),
  });

  // Avisar o servidor é best-effort: o tour já acabou na tela, e um erro de
  // rede não pode virar um alerta sobre algo que a pessoa nem pediu.
  useEffect(() => {
    aoEncerrarTour((chave) => {
      void fetchApi<void>("/admin/onboarding/tour/visto", {
        method: "POST",
        token,
        body: JSON.stringify({ chave }),
      })
        .then(() => qc.invalidateQueries({ queryKey: ["tour"] }))
        .catch(() => {});
    });
  }, [token, qc]);

  /**
   * Abre sozinho só onde faz sentido.
   *
   * - `automatico`: tour de tela interna interrompe quem navegou de propósito —
   *   e, desde a queixa do cliente veterano, o servidor só manda `true` pra
   *   quem entrou depois de o tour existir. Holofote é pra quem está chegando.
   * - `visto`: uma vez é uma vez, e isso está no banco, não no navegador.
   * - `assumida`: operador da plataforma visitando cliente não leva tour na
   *   cara — e, pior, marcaria como visto no lugar do dono.
   * - termo pendente: o modal de aceite ganha sempre.
   *
   * O PEDIDO vence tudo isso menos o aceite: quem clicou em "Rever o passo a
   * passo" está pedindo com o dedo. Sem essa porta, a mesma regra que poupa o
   * veterano do holofote calaria o botão que existe pra ele.
   */
  useEffect(() => {
    if (!data || assumida) return;
    const pedido = pedidoDeTour() === data.chave;
    if (!pedido && jaAbriu.current === data.chave) return;
    if (document.querySelector("[data-aceite-termos]")) return;
    if (!pedido && (!data.automatico || data.visto)) return;
    limparPedidoTour();
    jaAbriu.current = data.chave;
    comecarTour(data.chave, data.passos);
  }, [data, assumida]);

  const passo = tour ? tour.passos[tour.indice] : null;

  /**
   * Medir o alvo e continuar medindo.
   *
   * O scroll do painel é do `<main>` (`overflow-y-auto`), não da janela, então
   * `window.onscroll` não basta — daí o listener em captura, que pega o evento
   * de qualquer elemento que role. Sem isso o furo descola do botão quando a
   * página se mexe.
   */
  const remedir = useCallback(() => {
    if (!passo?.alvo) {
      setRect(null);
      return;
    }
    setRect(medirAlvo(passo.alvo));
  }, [passo]);

  useEffect(() => {
    if (!tour || !passo) return;

    // O alvo pode montar depois dos dados (tudo aqui é React Query). Em vez de
    // desistir na primeira medida, tenta por alguns quadros.
    let vivo = true;
    let tentativas = 0;
    const tentar = () => {
      if (!vivo) return;
      if (passo.alvo) {
        const r = medirAlvo(passo.alvo);
        if (r) {
          r.height && setRect(r);
          return;
        }
        if (tentativas++ < 20) {
          requestAnimationFrame(tentar);
          return;
        }
      }
      setRect(null); // sem alvo (ou não achou): balão no centro
    };
    tentar();

    window.addEventListener("resize", remedir);
    window.addEventListener("scroll", remedir, true);
    const ro = new ResizeObserver(remedir);
    ro.observe(document.body);
    return () => {
      vivo = false;
      window.removeEventListener("resize", remedir);
      window.removeEventListener("scroll", remedir, true);
      ro.disconnect();
    };
  }, [tour, passo, remedir]);

  // Esc sai. Sempre — um overlay sem saída de teclado é uma armadilha.
  useEffect(() => {
    if (!tour) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        encerrarTour(false);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [tour]);

  if (!tour || !passo) return null;

  const total = tour.passos.length;
  const ultimo = tour.indice === total - 1;
  const furo = rect
    ? {
        x: rect.left - FOLGA,
        y: rect.top - FOLGA,
        w: rect.width + FOLGA * 2,
        h: rect.height + FOLGA * 2,
      }
    : null;

  // Cabe embaixo do furo? Senão vai pra cima. Sem alvo, centraliza.
  const abaixo = furo ? furo.y + furo.h + GAP + BALAO_ALTURA < window.innerHeight : true;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Passo a passo">
      {/* O recorte. `pointer-events-none` no SVG: quem captura o clique é a
          camada de baixo, pra não disparar o botão real no meio da explicação. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="tour-recorte">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {furo && (
              <rect x={furo.x} y={furo.y} width={furo.w} height={furo.h} rx="10" fill="black" />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgb(12 15 28 / 0.62)"
          mask="url(#tour-recorte)"
        />
        {furo && (
          <rect
            x={furo.x}
            y={furo.y}
            width={furo.w}
            height={furo.h}
            rx="10"
            fill="none"
            stroke="white"
            strokeWidth="2"
          />
        )}
      </svg>

      {/* Clicar fora avança — e nunca fecha por engano: sair é no "Pular". */}
      <button
        type="button"
        aria-label="Próximo passo"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={() => avancarTour()}
      />

      <div
        className="absolute w-[min(320px,calc(100vw-32px))] rounded-lg border bg-background p-4 shadow-xl"
        style={
          furo
            ? {
                left: Math.min(Math.max(12, furo.x), window.innerWidth - 332),
                top: abaixo ? furo.y + furo.h + GAP : Math.max(12, furo.y - GAP - BALAO_ALTURA),
              }
            : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
        }
      >
        <p className="text-sm font-semibold">{passo.titulo}</p>
        <p className="mt-1 text-sm text-muted-foreground">{passo.corpo}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {tour.passos.map((p, i) => (
              <span
                key={p.id}
                className={
                  i === tour.indice
                    ? "h-1.5 w-4 rounded-full bg-primary"
                    : "h-1.5 w-1.5 rounded-full bg-muted-foreground/30"
                }
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {/* Contorno = voltar/cancelar, pelo padrão do semáforo. */}
            {tour.indice > 0 && (
              <Button variant="outline" size="sm" onClick={() => voltarTour()}>
                Voltar
              </Button>
            )}
            {!ultimo && (
              <Button variant="outline" size="sm" onClick={() => encerrarTour(false)}>
                Pular
              </Button>
            )}
            <Button size="sm" onClick={() => (ultimo ? encerrarTour(true) : avancarTour())}>
              {ultimo ? "Entendi" : "Próximo"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {tour.indice + 1} de {total}
        </p>
      </div>
    </div>
  );
}
