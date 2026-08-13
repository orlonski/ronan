import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/queries";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus, setCadastroStatus } from "@/lib/cadastro-status";
import { MovatruckLogo } from "@/components/movatruck-logo";

/**
 * Tela que cobre o app inteiro quando o cadastro ainda está PENDENTE_APROVACAO.
 * O motorista já está logado, mas não lança nada até um admin aprovar. Busca o
 * /m/me (refetch ao focar a janela) e, quando o status vira APROVADO, atualiza
 * o store — o AuthGate troca pro app normal sozinho.
 */
export function EmAnalise() {
  const navigate = useNavigate();
  const me = useMe();

  useEffect(() => {
    if (me.data?.status) setCadastroStatus(me.data.status);
  }, [me.data?.status]);

  function sair() {
    clearTokens();
    clearCadastroStatus();
    setAuthState(false);
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      <div className="bg-brand px-6 pb-10 pt-safe">
        <div className="pt-12">
          <MovatruckLogo />
          <p className="mt-2 text-base font-medium text-white/80">Aplicativo do motorista</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-6 px-6 py-10">
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-foreground">Cadastro em análise</h2>
          <p className="text-base leading-6 text-muted-foreground">
            Recebemos seu cadastro! Estamos conferindo seus dados. Assim que for aprovado, o
            app libera pra você lançar viagens, pedágios e abastecimentos.
          </p>
          <p className="text-base leading-6 text-muted-foreground">
            Isso costuma ser rápido. Você pode tocar em "Já fui aprovado?" pra verificar de novo.
          </p>
        </div>

        <div className="space-y-3">
          <Button size="xl" className="w-full" loading={me.isFetching} onClick={() => me.refetch()}>
            {me.isFetching ? "Verificando..." : "Já fui aprovado?"}
          </Button>
          <Button size="xl" variant="outline" className="w-full" onClick={sair}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
