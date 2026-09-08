import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthState, setAuthState, subscribeAuth } from "@/lib/auth-state";
import { getCadastroStatus, subscribeCadastroStatus } from "@/lib/cadastro-status";
import { loadTokens } from "@/lib/auth";
import { startAutoSync } from "@/lib/sync";
import { enviarPendentes } from "@/lib/error-reporter";
import { obterEEnviarPushToken } from "@/lib/notifications";
import { EmAnalise } from "@/components/em-analise";
import { SemEmpresa } from "@/components/sem-empresa";
import { assinarIdentidade, temIdentidade } from "@/lib/identidade";
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
  // Re-renderiza quando a sessão da pessoa aparece/some (cadastro novo, logout).
  const comIdentidade = useSyncExternalStore(assinarIdentidade, temIdentidade, () => false);
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
          // A sessão da PESSOA também conta como "logado": é quem se cadastrou
          // e ainda não foi convidado por ninguém.
          setAuthState(!!tokens?.accessToken || temAlgumaSessaoComToken() || temIdentidade());
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
    // Quem não está em empresa nenhuma não tem o que reparar nem o que alinhar:
    // esses endpoints falam pelo cadastro numa empresa, e chamá-los sem sessão
    // era o caminho pro 401 que deslogava o recém-cadastrado.
    if (listarSessoes().length === 0) return;
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

  // Logado, mas em empresa nenhuma: cobre o app com a tela de convites. Vem
  // ANTES do "em análise" porque sem vínculo não há aprovação pendente — o
  // status guardado pode ser sobra de um cadastro anterior. A checagem exige a
  // identidade porque quem entrou antes das sessões por empresa também tem
  // lista vazia e roda pelo token legado.
  // O caderninho é dele e não depende de empresa nenhuma — é a única tela que
  // escapa da cobertura, senão o botão "Meus gastos" não levaria a lugar algum.
  const emRotaPessoal = location.pathname.startsWith("/meus-gastos");
  if (state && comIdentidade && listarSessoes().length === 0 && !emRotaPessoal) {
    return <SemEmpresa />;
  }

  // Logado mas cadastro ainda em análise: cobre o app inteiro com a tela de
  // espera (some sozinho quando o status vira APROVADO).
  if (state && cadastroStatus === "PENDENTE_APROVACAO") return <EmAnalise />;

  // Roda pra mais de uma empresa: escolhe a do turno antes de ver qualquer tela.
  // Uma vez por abertura do app (o marcador vive em memória).
  if (state && precisaEscolherEmpresa()) return <EscolherEmpresaAbertura />;

  return <>{children}</>;
}
