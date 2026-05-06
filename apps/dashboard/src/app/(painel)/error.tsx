"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { reportarErroDashboard } from "@/lib/error-reporter";

/**
 * Boundary global do painel. Captura erros de render do Next App Router
 * e manda pro backend.
 */
export default function PainelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { data: session } = useSession();

  useEffect(() => {
    void reportarErroDashboard(
      error,
      { extra: { digest: error.digest } },
      session?.accessToken,
    );
  }, [error, session]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="max-w-md space-y-4 p-6 text-center">
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="text-sm text-muted-foreground">
          O erro foi reportado automaticamente. Tente recarregar essa tela.
        </p>
        {process.env.NODE_ENV !== "production" && (
          <pre className="overflow-auto rounded bg-muted/40 p-2 text-left text-xs">
            {error.message}
          </pre>
        )}
        <Button onClick={reset} className="w-full">
          Tentar novamente
        </Button>
      </Card>
    </div>
  );
}
