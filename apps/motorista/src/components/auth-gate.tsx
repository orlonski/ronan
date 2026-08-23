import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthState, setAuthState, subscribeAuth } from "@/lib/auth-state";
import { getCadastroStatus, subscribeCadastroStatus } from "@/lib/cadastro-status";
import { loadTokens } from "@/lib/auth";
import { startAutoSync } from "@/lib/sync";
import { enviarPendentes } from "@/lib/error-reporter";
import { obterEEnviarPushToken } from "@/lib/notifications";
import { EmAnalise } from "@/components/em-analise";
import { EscolherEmpresaAbertura } from "@/components/escolher-empresa-abertura";
import {
  assinarSessoes,
  listarSessoes,
  precisaEscolherEmpresa,
  temAlgumaSessaoComToken,
} from "@/lib/sessoes";
import { atualizarCadastros, prepararSessoes, repararSessaoAtiva } from "@/lib/troca-empresa";

/**
 * Gate de autenticação. Usa useSyncExternalStore pra evitar bug de ordem
 * entre boot (que muda o estado global) e subscribe (que escuta mudanças):
 * em produção o boot rodava antes do subscribe e o componente ficava preso
 * em null pra sempre.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthState, () => null);
  const cadastroStatus = useSyncExternalStore(
    subscribeCadastroStatus,
    getCadastroStatus,
    () => null,
  );
  // Re-renderiza ao trocar/escolher empresa (o gate de escolha some).
  useSyncExternalStore(assinarSessoes, () => JSON.stringify(listarSessoes()));
  const location = useLocation();

  // Boot único: lê tokens e popula auth-state. useSyncExternalStore re-renderiza
  // automaticamente quando setAuthState muda o valor.
  useEffect(() => {
    if (getAuthState() !== null) return;
    // `prepararSessoes` PRIMEIRO: adota a sessão de quem já estava logado antes
    // das sessões por empresa e resolve os pendentes sem dono. Ler o token antes
    // disso mostraria dado da empresa errada por um instante.
    void prepararSessoes()
      .catch(() => {
        /* nunca derruba o boot: sem migrar, cai no caminho antigo */
      })
      .then(() => {
        try {
          // `temAlgumaSessaoComToken` cobre o aparelho cujo slot ativo foi
          // descartado por guardar o token de outra empresa: ele segue logado
          // pela sessão sã que tem, e o reparo repõe a que falta.
          const tokens = loadTokens();
          setAuthState(!!tokens?.accessToken || temAlgumaSessaoComToken());
        } catch {
          setAuthState(false);
        }
      });
  }, []);

  // Inicia auto-sync ao logar.
  useEffect(() => {
    if (state !== true) return;
    startAutoSync();
    void enviarPendentes();
    // Repõe o token da empresa ativa se ele faltar (slot descartado por guardar
    // o de outro cadastro) e só depois alinha as empresas com o servidor: nome
    // da empresa, aprovação e cadastro numa segunda empresa.
    void repararSessaoAtiva()
      .catch(() => {})
      .then(() => atualizarCadastros())
      .catch(() => {});
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void obterEEnviarPushToken();
    }
  }, [state]);

  if (state === null) return null;

  // Rotas públicas (pré-login): login e o fluxo de auto-cadastro.
  const onAuthScreen = location.pathname === "/login" || location.pathname.startsWith("/signup");
  if (!state && !onAuthScreen) return <Navigate to="/login" replace />;
  if (state && onAuthScreen) return <Navigate to="/" replace />;

  // Logado mas cadastro ainda em análise: cobre o app inteiro com a tela de
  // espera (some sozinho quando o status vira APROVADO).
  if (state && cadastroStatus === "PENDENTE_APROVACAO") return <EmAnalise />;

  // Roda pra mais de uma empresa: escolhe a do turno antes de ver qualquer tela.
  // Uma vez por abertura do app (o marcador vive em memória).
  if (state && precisaEscolherEmpresa()) return <EscolherEmpresaAbertura />;

  return <>{children}</>;
}
