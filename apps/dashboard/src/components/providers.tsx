"use client";
import { SessionProvider } from "next-auth/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster, toast } from "sonner";
import { ApiError } from "@/lib/client-api";
import { CODIGO_CONTA_SOMENTE_LEITURA } from "@/lib/erro-api";

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
        /**
         * Rede de segurança: escrita que falha SEMPRE avisa.
         *
         * Antes daqui, ~17 formulários chamavam `mutateAsync` sem try/catch e
         * sem `onError` — CPF duplicado, placa repetida ou senha curta faziam o
         * botão reabilitar e mais nada acontecer na tela. O operador clicava de
         * novo achando que não tinha clicado.
         *
         * Quem trata o próprio erro (tem `onError` ou marca
         * `meta.erroTratado`) não recebe este toast, pra não duplicar aviso.
         */
        mutationCache: new MutationCache({
          onError: (erro, _vars, _ctx, mutation) => {
            /**
             * Teste acabado vem ANTES dos escapes de quem trata o próprio erro.
             *
             * Não é falha de formulário, é estado da empresa: acontece em
             * qualquer escrita do painel, e quem trata o erro do próprio form
             * não tem como saber disso. Sem este ramo, a pessoa preenchia a
             * tela inteira e recebia uma frase que não oferece saída nenhuma.
             */
            if (erro instanceof ApiError && erro.code === CODIGO_CONTA_SOMENTE_LEITURA) {
              toast.error("Seu teste terminou", {
                description:
                  "Tudo que você lançou continua aqui pra ver e exportar. Pra voltar a lançar, fale com a gente.",
                action: {
                  label: "Quero continuar",
                  onClick: () => window.dispatchEvent(new Event("movatruck:quero-continuar")),
                },
              });
              return;
            }
            if (mutation.options.onError) return;
            if (mutation.meta?.erroTratado) return;
            // 401 já é resolvido dentro do fetchApi (renova a sessão ou
            // desloga). Avisar aqui só assustaria sem o usuário poder agir.
            if (erro instanceof ApiError && erro.status === 401) return;
            const descricao =
              erro instanceof Error && erro.message
                ? erro.message
                : "Tente de novo em alguns instantes.";
            toast.error("Não foi possível concluir", { description: descricao });
          },
        }),
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
