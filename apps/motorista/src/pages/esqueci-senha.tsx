import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { cpfDigits, maskTelefone, telefoneDigits } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, humanizeApiError } from "@/lib/api";

/**
 * Recuperar a senha.
 *
 * O backend já tinha os três endpoints prontos e públicos desde sempre; o PWA
 * só não tinha as telas. Quem esquecia a senha no iPhone ficava trancado do
 * lado de fora — a troca de senha do perfil exige a senha ATUAL, que é
 * exatamente o que ele não tem.
 *
 * Portado do nativo (`app/esqueci-senha.tsx`), trocando expo-router por
 * react-router e as primitivas nativas por HTML.
 */
function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function EsqueciSenhaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Pode chegar com o CPF preenchido, vindo do login.
  const [cpf, setCpf] = useState(() => {
    const p = params.get("cpf");
    return p ? maskCpf(p) : "";
  });
  const [celular, setCelular] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const cpfDigitos = cpfDigits(cpf);
    const celularDigitos = telefoneDigits(celular);
    if (cpfDigitos.length !== 11) return setErro("Informe o CPF completo.");
    if (celularDigitos.length < 10) return setErro("Informe o celular com DDD.");

    setEnviando(true);
    try {
      await api.esqueciSenha(cpfDigitos, celularDigitos);
      navigate(
        `/esqueci-senha/codigo?cpf=${cpfDigitos}&celular=${celularDigitos}`,
      );
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background px-5 pb-safe pt-safe">
      <div className="mx-auto w-full max-w-md flex-1 pt-10">
        <h1 className="text-2xl font-bold text-foreground">Esqueci minha senha</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A gente manda um código no seu WhatsApp pra você criar uma senha nova.
        </p>

        <form onSubmit={enviar} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cpf">Seu CPF</Label>
            <Input
              id="cpf"
              inputMode="numeric"
              autoComplete="username"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(maskCpf(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="celular">Seu celular</Label>
            <Input
              id="celular"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="(00) 00000-0000"
              value={celular}
              onChange={(e) => setCelular(maskTelefone(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Precisa ser o mesmo número do seu cadastro — é pra lá que o código vai.
            </p>
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? "Enviando…" : "Mandar o código"}
          </Button>

          <Link to="/login" className="block text-center text-sm text-muted-foreground underline">
            Voltar pro login
          </Link>
        </form>
      </div>
    </div>
  );
}
