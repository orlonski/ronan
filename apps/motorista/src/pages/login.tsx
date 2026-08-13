import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cpfDigits } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";
import type { SessaoEmpresa } from "@ronan/shared-types";
import { api, ApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { setCadastroStatus } from "@/lib/cadastro-status";
import { ativarSessao, marcarEmpresaEscolhida, salvarSessoesDoLogin } from "@/lib/sessoes";
import { resolverLegadoAposLogin } from "@/lib/troca-empresa";
import { MovatruckLogo } from "@/components/movatruck-logo";

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Só aparece pra quem tem cadastro em mais de uma empresa — pra todo mundo o
  // login continua sendo CPF, senha, entrou.
  const [escolha, setEscolha] = useState<SessaoEmpresa[] | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const cpfDigitos = cpfDigits(cpf);
    if (cpfDigitos.length !== 11 || !senha) {
      setErro("Informe o CPF (11 dígitos) e a senha.");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await api.loginMotorista(cpfDigitos, senha);
      const cadastros = resp.cadastros ?? [];
      if (cadastros.length > 1) {
        // Guarda TODAS as sessões já (o login é a única hora em que ele digita a
        // senha) e só pergunta qual começa ativa. A troca depois é offline.
        salvarSessoesDoLogin(cadastros, cadastros[0]!.motoristaId);
        setEscolha(cadastros);
        return;
      }
      if (cadastros.length === 1) {
        salvarSessoesDoLogin(cadastros, cadastros[0]!.motoristaId);
        await resolverLegadoAposLogin(cadastros[0]!.motoristaId);
        marcarEmpresaEscolhida();
      } else {
        // Backend antigo (deploy ainda não chegou): guarda como antes.
        saveTokens(resp);
      }
      setAuthState(true);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErro("CPF ou senha incorretos.");
      } else {
        setErro((err as Error).message ?? "Falha ao entrar.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function comecarEm(sessao: SessaoEmpresa) {
    ativarSessao(sessao.motoristaId);
    // Acabou de escolher: não faz sentido a tela de abertura perguntar de novo.
    marcarEmpresaEscolhida();
    await resolverLegadoAposLogin(sessao.motoristaId);
    setCadastroStatus(sessao.status);
    setAuthState(true);
    navigate("/", { replace: true });
  }

  if (escolha) {
    return (
      <div className="flex min-h-screen-safe flex-col bg-background">
        <div className="bg-brand px-6 pb-8 pt-safe">
          <div className="pt-12">
            <MovatruckLogo />
            <p className="mt-2 text-base font-medium text-white/80">
              Você roda pra mais de uma empresa
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 p-6">
          <h2 className="text-lg font-bold text-foreground">Pra qual você vai rodar agora?</h2>
          <p className="text-base text-muted-foreground">
            Dá pra trocar a qualquer hora lá no topo da tela inicial.
          </p>
          {escolha.map((s) => (
            <button
              key={s.motoristaId}
              type="button"
              onClick={() => void comecarEm(s)}
              className="flex items-center gap-3 rounded-2xl border-2 border-border bg-card p-5 text-left active:opacity-75"
            >
              <Building2 size={24} className="text-brand" />
              <span className="flex-1 text-lg font-bold text-foreground">{s.contaNome}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      {/* Hero brand */}
      <div className="bg-brand px-6 pb-10 pt-safe">
        <div className="pt-12">
          <MovatruckLogo />
          <p className="mt-2 text-base font-medium text-white/80">Aplicativo do motorista</p>
        </div>
      </div>

      <form onSubmit={entrar} className="flex flex-1 flex-col px-6 py-8">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="cpf">CPF</Label>
            <Input
              id="cpf"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
              type="tel"
              inputMode="numeric"
              autoCorrect="off"
              autoComplete="username"
              placeholder="000.000.000-00"
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha">Senha</Label>
            <PasswordInput
              id="senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••"
              disabled={submitting}
            />
          </div>

          {erro && (
            <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
              <p className="text-base font-medium text-destructive whitespace-pre-line">{erro}</p>
            </div>
          )}

          <Button type="submit" size="xl" className="mt-3 w-full" loading={submitting}>
            {submitting ? "Entrando..." : "Entrar"}
          </Button>

          <button
            type="button"
            onClick={() => navigate("/signup")}
            disabled={submitting}
            className="w-full py-2 text-center text-base font-semibold text-brand"
          >
            Não tem cadastro? Criar agora
          </button>
        </div>
      </form>
    </div>
  );
}
