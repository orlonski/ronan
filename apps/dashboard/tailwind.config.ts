import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Token helper: gera color-mix() compatível com qualquer formato de cor (hex,
// oklch, hsl, rgb) e respeita os opacity modifiers do Tailwind (bg-primary/30).
const c = (name: string) =>
  `color-mix(in oklch, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: c("border"),
        input: c("input"),
        ring: c("ring"),
        background: c("background"),
        foreground: c("foreground"),
        primary: {
          DEFAULT: c("primary"),
          foreground: c("primary-foreground"),
        },
        secondary: {
          DEFAULT: c("secondary"),
          foreground: c("secondary-foreground"),
        },
        muted: {
          DEFAULT: c("muted"),
          foreground: c("muted-foreground"),
        },
        accent: {
          DEFAULT: c("accent"),
          foreground: c("accent-foreground"),
        },
        destructive: {
          DEFAULT: c("destructive"),
          foreground: c("destructive-foreground"),
        },
        card: {
          DEFAULT: c("card"),
          foreground: c("card-foreground"),
        },
        popover: {
          DEFAULT: c("popover"),
          foreground: c("popover-foreground"),
        },
        sidebar: {
          DEFAULT: c("sidebar"),
          foreground: c("sidebar-foreground"),
          primary: c("sidebar-primary"),
          "primary-foreground": c("sidebar-primary-foreground"),
          accent: c("sidebar-accent"),
          "accent-foreground": c("sidebar-accent-foreground"),
          border: c("sidebar-border"),
          ring: c("sidebar-ring"),
        },
        chart: {
          "1": c("chart-1"),
          "2": c("chart-2"),
          "3": c("chart-3"),
          "4": c("chart-4"),
          "5": c("chart-5"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "loading-bar": {
          "0%": { transform: "translateX(-100%) scaleX(0.4)" },
          "50%": { transform: "translateX(0%) scaleX(0.6)" },
          "100%": { transform: "translateX(100%) scaleX(0.4)" },
        },
      },
      animation: {
        "loading-bar": "loading-bar 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
