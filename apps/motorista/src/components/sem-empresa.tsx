import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LogOut, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type ConviteEmpresa } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus, setCadastroStatus } from "@/lib/cadastro-status";
import { guardarSessao, marcarEmpresaEscolhida } from "@/lib/sessoes";

/**
 * Cobre o app inteiro quando ele tem cadastro mas não está em empresa nenhuma.
 *
 * Não é uma tela de erro: é o estado normal de quem acabou de se cadastrar. O
 * app é dele antes de ser de qualquer transportadora — o que falta é uma empresa
 * dizer "vem rodar comigo", e é isso que aparece aqui quando chega.
 *
 * A entrada é sempre por convite: ele não procura empresa nem digita código.
 * Ver docs/identidade-motorista.md.
 */
export function SemEmpresa() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [aceitando, setAceitando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const convites = useQuery({
    queryKey: ["m", "eu", "convites"],
    queryFn: () => api.meusConvites(),
    // Sem cache-first aqui: convite é coisa nova por definição, e esta tela só
    // aparece pra quem está esperando um.
    staleTime: 0,
  });

  const aceitar = useCallback(
    async (c: ConviteEmpresa) => {
      setErro(null);
      setAceitando(c.motoristaId);
      try {
        const sessao = await api.aceitarConvite(c.motoristaId);
        guardarSessao(sessao);
        marcarEmpresaEscolhida();
        setCadastroStatus(sessao.status);
        await queryClient.invalidateQueries();
        navigate("/", { replace: true });
      } catch (err) {
        setErro((err as Error).message);
      } finally {
        setAceitando(null);
      }
    },
    [navigate, queryClient],
  );

  const recusar = useCallback(
    async (c: ConviteEmpresa) => {
      if (
        !confirm(
          `Recusar o convite da ${c.contaNome}? Ela não vai poder te ver no sistema. Se mudar de ideia, peça um convite novo.`,
        )
      ) {
        return;
      }
      await api.recusarConvite(c.motoristaId).catch(() => {});
      await convites.refetch();
    },
    [convites],
  );

  function sair() {
    // `clearTokens` já esquece a sessão da pessoa junto (ver lib/auth.ts).
    clearTokens();
    clearCadastroStatus();
    setAuthState(false);
    navigate("/login", { replace: true });
  }

  const lista = convites.data ?? [];

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      <div className="bg-brand px-6 pb-10 pt-safe">
        <div className="pt-12">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Movatruck</h1>
          <p className="mt-2 text-base font-medium text-white/80">Seu cadastro está pronto</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-6 px-6 py-8">
        {lista.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-foreground">
              {lista.length === 1 ? "Uma empresa te chamou" : "Empresas te chamaram"}
            </h2>
            {lista.map((c) => (
              <div
                key={c.motoristaId}
                className="space-y-3 rounded-2xl border-2 border-border bg-card p-5"
              >
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 shrink-0" />
                  <p className="flex-1 text-xl font-bold text-foreground">{c.contaNome}</p>
                </div>
                <p className="text-base text-muted-foreground">
                  Aceitando, você passa a lançar suas viagens pra ela e ela enxerga o que você
                  rodar. Enquanto não aceitar, ela não vê nada seu.
                </p>
                <Button
                  size="lg"
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={aceitando !== null}
                  onClick={() => void aceitar(c)}
                >
                  {aceitando === c.motoristaId ? "Entrando..." : `Rodar pra ${c.contaNome}`}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full"
                  disabled={aceitando !== null}
                  onClick={() => void recusar(c)}
                >
                  Recusar
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-foreground">Falta você entrar numa empresa</h2>
            <p className="text-base leading-6 text-muted-foreground">
              Seu cadastro já está feito e é seu. Pra começar a lançar viagens, uma transportadora
              precisa te adicionar — passe o seu CPF pra ela.
            </p>
            <p className="text-base leading-6 text-muted-foreground">
              Quando ela fizer isso, o convite aparece aqui pra você aceitar.
            </p>
          </div>
        )}

        {erro && (
          <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
            <p className="text-base font-medium text-destructive">{erro}</p>
          </div>
        )}

        {/* O caderninho é dele e existe antes de qualquer empresa — é o que dá
            o que fazer no app enquanto ninguém o chamou. */}
        <button
          type="button"
          onClick={() => navigate("/meus-gastos")}
          className="flex w-full items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 text-left"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <Wallet className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-foreground">Meus gastos</p>
            <p className="text-sm text-muted-foreground">
              Anote o diesel, o pedágio e o que você recebeu
            </p>
          </div>
        </button>

        <div className="space-y-3">
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={convites.isFetching}
            onClick={() => void convites.refetch()}
          >
            <RefreshCw className="h-5 w-5" />
            {convites.isFetching ? "Verificando..." : "Verificar convites"}
          </Button>
          <Button size="lg" variant="outline" className="w-full" onClick={sair}>
            <LogOut className="h-5 w-5" />
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
