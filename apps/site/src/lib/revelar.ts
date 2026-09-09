import { useEffect } from "react";

// Um único observer pra página inteira: cada elemento .revelar ganha .revelado
// quando entra na tela. Sem lib de animação — é só opacity + transform.
export function useRevelar() {
  useEffect(() => {
    const alvos = document.querySelectorAll<HTMLElement>(".revelar");

    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      alvos.forEach((el) => el.classList.add("revelado"));
      return;
    }

    const observer = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (entrada.isIntersecting) {
            entrada.target.classList.add("revelado");
            observer.unobserve(entrada.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    alvos.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}
