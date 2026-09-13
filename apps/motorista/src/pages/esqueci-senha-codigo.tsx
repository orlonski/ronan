import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatCpf } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, humanizeApiError } from "@/lib/api";
import { marcarEmpresaEscolhida, salvarSessoesDoLogin } from "@/lib/sessoes";
import { setAuthState } from "@/lib/auth-state";
import { setCadastroStatus } from "@/lib/cadastro-status";

const COOLDOWN_S = 60;

function mascararCelular(c: string): string {
  const d = c.replace(/\D/g, "");
  if (d.length < 4) return c;
  return `••••-${d.slice(-4)}`;
}

/**
 * O código e a senha nova, na mesma tela.
 *
 * Duas telas separadas (confirmar código, depois criar senha) fariam ele digitar
 * o código, esperar, e só então descobrir a regra da senha. Numa tela só ele vê
 * tudo antes de começar.
 */
export default function EsqueciSenhaCodigoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cpf = params.get("cpf") ?? "";
  const celular = params.get("celular") ?? "";

  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(COOLDOWN_S);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sem CPF na URL não há o que redefinir — volta pro começo.
    if (!cpf) navigate("/esqueci-senha", { replace: true });
  }, [cpf, navigate]);

  useEffect(() => {
    timer.current = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (codigo.replace(/\D/g, "").length !== 6) return setErro("O código tem 6 números.");
    if (senha.length < 6) return setErro("A senha nova precisa ter pelo menos 6 letras ou números.");

    setEnviando(true);
    try {
      const res = await api.redefinirSenha({
        cpf,
        codigo: codigo.replace(/\D/g, ""),
        novaSenha: senha,
      });
      // Redefinir já loga (ele acabou de provar quem é pelo código no WhatsApp).
      // Mesmo tratamento do cadastro: as sessões de cada empresa vêm em
      // `cadastros`, e quem não tem empresa nenhuma entra no modo sem empresa —
      // a sessão da PESSOA já foi guardada pelo cliente de API.
      const cadastros = res.cadastros ?? [];
      if (cadastros.length > 0) {
        salvarSessoesDoLogin(cadastros, cadastros[0]!.motoristaId);
        marcarEmpresaEscolhida();
        setCadastroStatus(cadastros[0]!.status);
      }
      setAuthState(true);
      navigate("/", { replace: true });
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar() {
    setErro(null);
    setReenviando(true);
    try {
      await api.reenviarCodigoSenha(cpf);
      setCooldown(COOLDOWN_S);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setReenviando(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background px-5 pb-safe pt-safe">
      <div className="mx-auto w-full max-w-md flex-1 pt-10">
        <h1 className="text-2xl font-bold text-foreground">Digite o código</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Mandamos 6 números no WhatsApp {celular ? mascararCelular(celular) : ""} do CPF{" "}
          {cpf ? formatCpf(cpf) : ""}.
        </p>

        <form onSubmit={confirmar} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="text-center text-2xl tracking-[0.4em]"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha">Senha nova</Label>
            <Input
              id="senha"
              type="password"
              autoComplete="new-password"
              placeholder="pelo menos 6 letras ou números"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar e entrar"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={cooldown > 0 || reenviando}
            onClick={() => void reenviar()}
          >
            {cooldown > 0 ? `Mandar de novo em ${cooldown}s` : "Não chegou, mandar de novo"}
          </Button>
        </form>
      </div>
    </div>
  );
}
