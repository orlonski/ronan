import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(216 12% 84%)",
        input: "hsl(216 12% 84%)",
        ring: "hsl(22 95% 53%)",
        background: "hsl(0 0% 100%)",
        foreground: "hsl(222 47% 11%)",
        brand: {
          DEFAULT: "hsl(220 75% 28%)",
          foreground: "hsl(0 0% 100%)",
        },
        primary: {
          DEFAULT: "hsl(22 95% 50%)",
          foreground: "hsl(0 0% 100%)",
        },
        secondary: {
          DEFAULT: "hsl(220 40% 96%)",
          foreground: "hsl(220 75% 28%)",
        },
        muted: {
          DEFAULT: "hsl(220 14% 95%)",
          foreground: "hsl(215 20% 35%)",
        },
        accent: {
          DEFAULT: "hsl(220 14% 92%)",
          foreground: "hsl(220 75% 28%)",
        },
        destructive: {
          DEFAULT: "hsl(0 84% 50%)",
          foreground: "hsl(0 0% 100%)",
        },
        success: {
          DEFAULT: "hsl(142 70% 38%)",
          foreground: "hsl(0 0% 100%)",
        },
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
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
