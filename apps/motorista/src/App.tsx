import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { isLoggedIn } from "@/lib/auth";
import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import NovaViagemPage from "@/pages/nova-viagem";
import NovoPedagioPage from "@/pages/novo-pedagio";
import PerfilPage from "@/pages/perfil";
import { ProtectedLayout } from "@/components/protected-layout";

function ProtectedRoute() {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return (
    <ProtectedLayout>
      <Outlet />
    </ProtectedLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/nova-viagem" element={<NovaViagemPage />} />
          <Route path="/novo-pedagio" element={<NovoPedagioPage />} />
          <Route path="/perfil" element={<PerfilPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
