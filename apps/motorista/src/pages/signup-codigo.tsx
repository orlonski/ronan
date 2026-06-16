import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatCpf } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, humanizeApiError } from "@/lib/api";
import { saveTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";

const COOLDOWN_S = 60;

function mascararCelular(c: string): string {
  const d = c.replace(/\D/g, "");
  if (d.length < 4) return c;
  return `••••-${d.slice(-4)}`;
}

export default function SignupCodigoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cpf = params.get("cpf") ?? "";
  const celular = params.get("celular") ?? "";

  const [codigo, setCodigo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(COOLDOWN_S);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sem cpf na URL não dá pra confirmar — volta pro cadastro.
    if (!cpf) navigate("/signup", { replace: true });
  }, [cpf, navigate]);

  useEffect(() => {
    timer.current = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (codigo.trim().length !== 6) return setErro("Digite os 6 dígitos do código.");
    setSubmitting(true);
    try {
      const res = await api.confirmarCadastro({ cpf, codigo: codigo.trim() });
      saveTokens(res);
      setAuthState(true);
      navigate("/", { replace: true });
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function reenviar() {
    if (cooldown > 0) return;
    setErro(null);
    setReenviando(true);
    try {
      await api.reenviarCodigoCadastro(cpf);
      setCodigo("");
      setCooldown(COOLDOWN_S);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setReenviando(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      <div className="bg-brand px-6 pb-8 pt-safe">
        <div className="pt-12">
          <h1 className="text-4xl font-extrabold tracking-tight text-white">Confirme o código</h1>
          <p className="mt-2 text-base font-medium text-white/80">
            Enviamos um código no seu WhatsApp {celular ? mascararCelular(celular) : ""}
          </p>
        </div>
      </div>

      <form onSubmit={confirmar} className="flex flex-1 flex-col gap-6 px-6 py-8">
        {cpf && (
          <p className="text-base text-muted-foreground">Cadastro do CPF {formatCpf(cpf)}</p>
        )}

        <div className="space-y-2">
          <Label htmlFor="codigo">Código de 6 dígitos</Label>
          <Input
            id="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            type="tel"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            className="text-center text-2xl tracking-[8px]"
            disabled={submitting}
          />
        </div>

        {erro && (
          <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
            <p className="text-base font-medium text-destructive whitespace-pre-line">{erro}</p>
          </div>
        )}

        <Button type="submit" size="xl" className="w-full" loading={submitting}>
          {submitting ? "Confirmando..." : "Confirmar"}
        </Button>

        <button
          type="button"
          onClick={reenviar}
          disabled={cooldown > 0 || reenviando}
          className={
            cooldown > 0
              ? "py-2 text-center text-base font-medium text-muted-foreground"
              : "py-2 text-center text-base font-semibold text-brand"
          }
        >
          {reenviando
            ? "Reenviando..."
            : cooldown > 0
              ? `Não recebi — reenviar em ${cooldown}s`
              : "Não recebi — reenviar código"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/login", { replace: true })}
          disabled={submitting}
          className="py-1 text-center text-base font-medium text-muted-foreground"
        >
          Voltar pro login
        </button>
      </form>
    </div>
  );
}
