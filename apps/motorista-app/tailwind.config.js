/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Bordas e fundos
        border: "hsl(216 12% 84%)",   // mais escura pra ler em sol
        input: "hsl(216 12% 84%)",
        ring: "hsl(22 95% 53%)",
        background: "hsl(0 0% 100%)",
        foreground: "hsl(222 47% 11%)",

        // Brand: azul marinho forte (logo, status bar, header)
        brand: {
          DEFAULT: "hsl(220 75% 28%)",
          foreground: "hsl(0 0% 100%)",
        },

        // Primary = LARANJA construção (acoes principais: salvar, nova viagem)
        primary: {
          DEFAULT: "hsl(22 95% 50%)",   // #ea580c-ish
          foreground: "hsl(0 0% 100%)",
        },

        // Secondary (pra botoes outline/secundarios)
        secondary: {
          DEFAULT: "hsl(220 40% 96%)",
          foreground: "hsl(220 75% 28%)",
        },

        // Muted (textos secundarios, MAIS ESCURO pra ler em sol)
        muted: {
          DEFAULT: "hsl(220 14% 95%)",
          foreground: "hsl(215 20% 35%)",   // mais escuro que o anterior
        },

        // Accent (hover/highlight)
        accent: {
          DEFAULT: "hsl(220 14% 92%)",
          foreground: "hsl(220 75% 28%)",
        },

        // Erro: vermelho FORTE (pra divergencia, cancelar, sair)
        destructive: {
          DEFAULT: "hsl(0 84% 50%)",
          foreground: "hsl(0 0% 100%)",
        },

        // Sucesso: verde FORTE (status OK, foi salva, etc)
        success: {
          DEFAULT: "hsl(142 70% 38%)",
          foreground: "hsl(0 0% 100%)",
        },

        // Aviso/pendente: amarelo/amber FORTE
        warning: {
          DEFAULT: "hsl(38 95% 50%)",
          foreground: "hsl(222 47% 11%)",
        },

        card: {
          DEFAULT: "hsl(0 0% 100%)",
          foreground: "hsl(222 47% 11%)",
        },
      },
      borderRadius: {
        lg: "0.875rem",
        md: "0.625rem",
        sm: "0.375rem",
      },
    },
  },
  plugins: [],
};
