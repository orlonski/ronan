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

export default function SignupCodigoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const cpf = params.get("cpf") ?? "";
  const celular = params.get("celular") ?? "";
  // Ele já tinha cadastro criado pela empresa: o código foi pro número que ELA
  // tem em ficha, que pode não ser o que ele acabou de digitar. Sem dizer isso,
  // ele fica olhando pro WhatsApp errado.
  const reivindicacao = params.get("reivindicacao") === "1";
  const [destino, setDestino] = useState(params.get("destino") ?? "");

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
      const cadastros = res.cadastros ?? [];
      if (cadastros.length > 0) {
        // Reivindicou o cadastro que a empresa já tinha: entra direto nela.
        salvarSessoesDoLogin(cadastros, cadastros[0]!.motoristaId);
        marcarEmpresaEscolhida();
        setCadastroStatus(cadastros[0]!.status);
      }
      // Sem empresa nenhuma ele entra do mesmo jeito: a sessão da PESSOA já foi
      // guardada pelo cliente de API, e o app abre no modo sem empresa.
      setAuthState(true);
      if (cadastros.length > 0 && reivindicacao) {
        alert(
          `Você já tinha cadastro na ${cadastros[0]!.contaNome}. Agora a senha é a que você acabou de escolher.`,
        );
      }
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
      const res = await api.reenviarCodigoCadastro(cpf);
      if (res.destinoMascarado) setDestino(res.destinoMascarado);
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
            Enviamos um código no WhatsApp {destino || (celular ? mascararCelular(celular) : "")}
          </p>
        </div>
      </div>

      <form onSubmit={confirmar} className="flex flex-1 flex-col gap-6 px-6 py-8">
        {cpf && (
          <p className="text-base text-muted-foreground">Cadastro do CPF {formatCpf(cpf)}</p>
        )}

        {reivindicacao && (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
            <p className="text-base font-semibold text-amber-900">
              Você já tem cadastro numa empresa
            </p>
            <p className="mt-1 text-base text-amber-900">
              Por segurança, o código foi pro número que ela tem no seu cadastro
              {destino ? ` (${destino})` : ""} — não pro que você digitou agora. Se esse número
              não é mais seu, peça pro administrativo dela atualizar.
            </p>
          </div>
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
