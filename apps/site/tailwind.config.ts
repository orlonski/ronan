import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1200px" } },
    extend: {
      colors: {
        fundo: "#F6F7FA",
        superficie: "#FFFFFF",
        "superficie-2": "#EEF1F6",
        tinta: "#0E1526",
        "tinta-media": "#47536B",
        // #6B7688 dava 4,29:1 sobre o fundo — reprovava AA em texto pequeno.
        "tinta-fraca": "#606B7D",
        borda: "#DDE3ED",
        "borda-forte": "#C3CCDC",
        azul: "#1E3575",
        "azul-claro": "#2A4A9E",
        "azul-lavado": "#EAEEF7",
        // #DF7234 puro dá 3,2:1 sobre branco: reprova AA. Em fundo claro ele
        // só entra como FUNDO, com rótulo quase-preto (`laranja-tinta`); pra
        // texto ou ícone laranja em fundo claro, usar `acao`. Sobre o azul
        // escuro da seção "Por dentro" ele passa (5,7:1) e pode ser texto.
        laranja: "#DF7234",
        "laranja-tinta": "#1A1005",
        acao: "#B4501A",
        "laranja-lavado": "#FCF1E8",
        verde: "#1B7A4B",
        "verde-lavado": "#E8F4EE",
      },
      fontFamily: {
        display: ["Archivo", "system-ui", "sans-serif"],
        sans: ["'Public Sans'", "system-ui", "sans-serif"],
      },
      maxWidth: { conteudo: "1200px" },
      borderRadius: { xl2: "0.875rem" },
      boxShadow: {
        placa: "0 1px 2px rgba(14,21,38,.05), 0 12px 32px -12px rgba(14,21,38,.14)",
        alta: "0 24px 60px -24px rgba(14,21,38,.28)",
      },
      transitionTimingFunction: { patio: "cubic-bezier(.16,1,.3,1)" },
    },
  },
  plugins: [],
} satisfies Config;
