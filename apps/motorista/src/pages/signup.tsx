import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { cpfDigits, telefoneDigits } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { api, humanizeApiError } from "@/lib/api";

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function maskCelular(input: string): string {
  const d = telefoneDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskPlaca(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}

export default function SignupPage() {
  const navigate = useNavigate();
  // Código que a empresa passa pro motorista. É ele que decide em qual
  // empresa o cadastro entra — o mesmo app serve todas.
  const [codigoEmpresa, setCodigoEmpresa] = useState("");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [celular, setCelular] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [placas, setPlacas] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function setPlaca(i: number, v: string) {
    setPlacas((arr) => arr.map((p, idx) => (idx === i ? maskPlaca(v) : p)));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const cpfDigitos = cpfDigits(cpf);
    const celularDigitos = telefoneDigits(celular);
    const placasLimpa = placas.map((p) => p.trim()).filter(Boolean);

    if (nome.trim().length < 2) return setErro("Informe seu nome completo.");
    if (cpfDigitos.length !== 11) return setErro("CPF precisa ter 11 dígitos.");
    if (codigoEmpresa.trim().length < 3) {
      return setErro("Informe o código da empresa pra quem você roda.");
    }
    if (celularDigitos.length < 10) return setErro("Informe um celular válido com DDD.");
    if (senha.length < 6) return setErro("A senha precisa ter ao menos 6 caracteres.");
    if (senha !== confirmar) return setErro("As senhas não conferem.");
    if (placasLimpa.length === 0) return setErro("Informe ao menos uma placa.");

    setSubmitting(true);
    try {
      await api.iniciarCadastro({
        codigoEmpresa: codigoEmpresa.trim(),
        nome: nome.trim(),
        cpf: cpfDigitos,
        telefone: celularDigitos,
        email: email.trim() || undefined,
        senha,
        placas: placasLimpa.map((placa) => ({ placa })),
        placaDefault: placasLimpa.length > 1 ? placasLimpa[0] : undefined,
      });
      navigate(
        `/signup/codigo?cpf=${cpfDigitos}&celular=${celularDigitos}&empresa=${encodeURIComponent(codigoEmpresa.trim())}`,
      );
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      <div className="bg-brand px-6 pb-8 pt-safe">
        <div className="pt-12">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">Criar cadastro</h1>
          <p className="mt-2 text-base font-medium text-white/80">
            Preencha seus dados pra começar
          </p>
        </div>
      </div>

      <form onSubmit={enviar} className="flex flex-1 flex-col gap-5 px-6 py-7">
        <div className="space-y-2">
          <Label htmlFor="codigoEmpresa">Código da empresa</Label>
          <Input
            id="codigoEmpresa"
            value={codigoEmpresa}
            onChange={(e) => setCodigoEmpresa(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect="off"
            placeholder="Ex.: FREITAS-K9M4TX"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Peça esse código para a empresa pra quem você roda. É ele que faz seu cadastro chegar
            até ela.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nome">Nome completo</Label>
          <Input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoCapitalize="words"
            placeholder="Seu nome"
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cpf">CPF</Label>
          <Input
            id="cpf"
            name="username"
            value={cpf}
            onChange={(e) => setCpf(maskCpf(e.target.value))}
            type="tel"
            inputMode="numeric"
            autoComplete="username"
            placeholder="000.000.000-00"
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="celular">Celular (WhatsApp)</Label>
          <Input
            id="celular"
            value={celular}
            onChange={(e) => setCelular(maskCelular(e.target.value))}
            type="tel"
            inputMode="numeric"
            placeholder="(00) 00000-0000"
            disabled={submitting}
          />
          <p className="text-sm text-muted-foreground">
            Vamos enviar um código de confirmação nesse número.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email (opcional)</Label>
          <Input
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="voce@email.com"
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label>Placa do veículo</Label>
          {placas.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={p}
                onChange={(e) => setPlaca(i, e.target.value)}
                autoCapitalize="characters"
                autoCorrect="off"
                placeholder="ABC1D23"
                className="flex-1"
                disabled={submitting}
              />
              {placas.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPlacas((arr) => arr.filter((_, idx) => idx !== i))}
                  disabled={submitting}
                >
                  <X className="h-5 w-5" />
                </Button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPlacas((arr) => [...arr, ""])}
            disabled={submitting}
            className="py-1 text-left text-base font-semibold text-brand"
          >
            + Adicionar outra placa
          </button>
          {placas.filter((p) => p.trim()).length > 1 && (
            <p className="text-sm text-muted-foreground">
              A primeira placa será sua placa padrão.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="senha">Senha</Label>
          <PasswordInput
            id="senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="new-password"
            placeholder="Mínimo 6 caracteres"
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmar">Confirmar senha</Label>
          <PasswordInput
            id="confirmar"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            autoComplete="new-password"
            placeholder="Repita a senha"
            disabled={submitting}
          />
        </div>

        {erro && (
          <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
            <p className="text-base font-medium text-destructive whitespace-pre-line">{erro}</p>
          </div>
        )}

        <Button type="submit" size="xl" className="mt-1 w-full" loading={submitting}>
          {submitting ? "Enviando..." : "Continuar"}
        </Button>

        <button
          type="button"
          onClick={() => navigate("/login", { replace: true })}
          disabled={submitting}
          className="py-2 text-center text-base font-medium text-muted-foreground"
        >
          Já tenho cadastro — entrar
        </button>
      </form>
    </div>
  );
}
