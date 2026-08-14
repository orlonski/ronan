import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { AuthGate } from "@/components/auth-gate";
import { ErrorBoundary } from "@/components/error-boundary";
import { ProtectedLayout } from "@/components/protected-layout";
import { AlertHost } from "@/components/ui/alert-dialog";

import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import SignupCodigoPage from "@/pages/signup-codigo";
import HomePage from "@/pages/home";
import HistoricoPage from "@/pages/historico";
import PerfilPage from "@/pages/perfil";
import NovaViagemPage from "@/pages/nova-viagem";
import NovoPedagioPage from "@/pages/novo-pedagio";
import NovoAbastecimentoPage from "@/pages/novo-abastecimento";
import PendentesPage from "@/pages/pendentes";
import NotificacoesPage from "@/pages/notificacoes";

// Detalhe da viagem usa Leaflet — chunk separado.
const ViagemDetalhePage = lazy(() => import("@/pages/viagens-detalhe"));

function WithTabs() {
  return (
    <ProtectedLayout>
      <Outlet />
    </ProtectedLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthGate>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/signup/codigo" element={<SignupCodigoPage />} />
            <Route element={<WithTabs />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/historico" element={<HistoricoPage />} />
              <Route path="/perfil" element={<PerfilPage />} />
            </Route>
            {/* Telas internas full-screen (sem tab bar) */}
            <Route path="/nova-viagem" element={<NovaViagemPage />} />
            <Route path="/nova-viagem/:clientId" element={<NovaViagemPage />} />
            <Route path="/novo-pedagio" element={<NovoPedagioPage />} />
            <Route path="/novo-pedagio/:clientId" element={<NovoPedagioPage />} />
            <Route path="/novo-abastecimento" element={<NovoAbastecimentoPage />} />
            <Route path="/pendentes" element={<PendentesPage />} />
            <Route path="/notificacoes" element={<NotificacoesPage />} />
            <Route
              path="/viagens/:id"
              element={
                <Suspense fallback={<div className="p-6">Carregando...</div>}>
                  <ViagemDetalhePage />
                </Suspense>
              }
            />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </AuthGate>
        <AlertHost />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
