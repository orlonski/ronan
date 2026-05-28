import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { reportarErro } from "@/lib/error-reporter";
import { Button } from "@/components/ui/button";

type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    void reportarErro(error, { url: "ErrorBoundary" });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen-safe flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15">
          <AlertTriangle size={36} className="text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Erro inesperado</h1>
        <p className="max-w-xs text-base text-muted-foreground">
          O app encontrou um problema e precisa recarregar. Já avisamos o suporte.
        </p>
        {this.state.error?.message && (
          <p className="max-w-xs rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
        )}
        <Button onClick={() => window.location.reload()} size="lg">
          <RefreshCcw size={18} />
          Recarregar
        </Button>
      </div>
    );
  }
}
