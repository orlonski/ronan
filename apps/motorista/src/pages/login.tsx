import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cpfDigits } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";

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
      const tokens = await api.loginMotorista(cpfDigitos, senha);
      saveTokens(tokens);
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

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      {/* Hero brand */}
      <div className="bg-brand px-6 pb-10 pt-safe">
        <div className="pt-12">
          <h1 className="text-5xl font-extrabold tracking-tight text-white">SCHABA</h1>
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
            <Input
              id="senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              type="password"
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
        </div>
      </form>
    </div>
  );
}
