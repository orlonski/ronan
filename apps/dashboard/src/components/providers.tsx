"use client";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "sonner";

export const THEMES = [
  "light",
  "theme-bubblegum",
  "theme-tangerine",
  "theme-claude",
  "theme-vintage-paper",
  "theme-vercel",
  "theme-t3-chat",
  "theme-supabase",
  "theme-catppuccin",
  "theme-cyberpunk",
] as const;

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={[...THEMES]}
      enableSystem={false}
      disableTransitionOnChange
    >
      {/* refetchInterval mantém o access token (15min) fresco: a cada 5min o
          NextAuth reroda o jwt callback e renova antes de vencer — evita a
          cascata de 401 quando a aba fica parada. */}
      <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
        <QueryClientProvider client={qc}>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
