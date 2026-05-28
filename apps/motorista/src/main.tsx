import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import App from "./App";
import { instalarHandlersGlobais } from "./lib/error-reporter";
import { instalarDrenoAutomatico } from "./lib/event-reporter";
import { setQueryClientGlobal } from "./lib/queries";
import { pruneExpired as pruneRotaCache } from "./lib/rota-cache";
import "./index.css";

instalarHandlersGlobais();
instalarDrenoAutomatico();
void pruneRotaCache();

// Quando o motorista volta pro app (foco da aba), TanStack revalida.
// Mesmo padrão do nativo via expo's AppState — aqui via visibilitychange.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    focusManager.setFocused(document.visibilityState === "visible");
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
      refetchOnWindowFocus: true,
    },
  },
});

setQueryClientGlobal(queryClient);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
