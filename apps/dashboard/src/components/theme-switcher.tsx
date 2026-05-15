"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Palette } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ThemeOption = {
  id: string;
  label: string;
  // Swatches: 3 cores CSS (background, primary, accent)
  swatches: [string, string, string];
};

const LIGHT_THEMES: ThemeOption[] = [
  {
    id: "light",
    label: "Modern Minimal",
    swatches: ["#ffffff", "#3b82f6", "#e0f2fe"],
  },
  {
    id: "theme-bubblegum",
    label: "Bubblegum",
    swatches: ["#f6e6ee", "#d04f99", "#fbe2a7"],
  },
  {
    id: "theme-tangerine",
    label: "Tangerine",
    swatches: ["#e8ebed", "#e05d38", "#d6e4f0"],
  },
  {
    id: "theme-claude",
    label: "Claude",
    swatches: ["#faf9f5", "#c96442", "#e9e6dc"],
  },
  {
    id: "theme-vintage-paper",
    label: "Vintage Paper",
    swatches: ["#f5f1e6", "#a67c52", "#d4c8aa"],
  },
];

const DARK_THEMES: ThemeOption[] = [
  {
    id: "theme-vercel",
    label: "Vercel",
    swatches: ["#000000", "#ffffff", "#525252"],
  },
  {
    id: "theme-t3-chat",
    label: "T3 Chat",
    swatches: ["#221d27", "#db2777", "#463753"],
  },
  {
    id: "theme-supabase",
    label: "Supabase",
    swatches: ["#121212", "#4ade80", "#313131"],
  },
  {
    id: "theme-catppuccin",
    label: "Catppuccin",
    swatches: ["#181825", "#cba6f7", "#89dceb"],
  },
  {
    id: "theme-cyberpunk",
    label: "Cyberpunk",
    swatches: ["#0c0c1d", "#ff00c8", "#00ffcc"],
  },
];

const ALL_THEMES = [...LIGHT_THEMES, ...DARK_THEMES];

function Swatches({ swatches }: { swatches: ThemeOption["swatches"] }) {
  return (
    <span className="flex gap-1">
      {swatches.map((color, i) => (
        <span
          key={i}
          className="h-3.5 w-3.5 rounded-full border border-border/60"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

function ThemeItem({
  opt,
  active,
  onSelect,
}: {
  opt: ThemeOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="justify-between">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center",
            !active && "opacity-0",
          )}
        >
          <Check className="h-4 w-4" />
        </span>
        {opt.label}
      </span>
      <Swatches swatches={opt.swatches} />
    </DropdownMenuItem>
  );
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = ALL_THEMES.find((t) => t.id === theme) ?? ALL_THEMES[0]!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Trocar tema"
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact && "px-2",
        )}
      >
        <Palette className="h-4 w-4 shrink-0" />
        {!compact && (
          <>
            <span className="flex-1 text-left">
              {mounted ? current.label : "Tema"}
            </span>
            {mounted && <Swatches swatches={current.swatches} />}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel>Light</DropdownMenuLabel>
        {LIGHT_THEMES.map((opt) => (
          <ThemeItem
            key={opt.id}
            opt={opt}
            active={mounted && theme === opt.id}
            onSelect={() => setTheme(opt.id)}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Dark</DropdownMenuLabel>
        {DARK_THEMES.map((opt) => (
          <ThemeItem
            key={opt.id}
            opt={opt}
            active={mounted && theme === opt.id}
            onSelect={() => setTheme(opt.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
