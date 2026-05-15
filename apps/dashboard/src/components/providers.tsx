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
      <SessionProvider>
        <QueryClientProvider client={qc}>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
