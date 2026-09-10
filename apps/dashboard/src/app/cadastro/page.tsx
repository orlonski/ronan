"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MovatruckLogo } from "@/components/movatruck-logo";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Passo = "dados" | "codigo";

async function chamar(caminho: string, corpo: unknown) {
  const res = await fetch(`${API_URL}/publico/cadastro/${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const issues = (body as { issues?: { message: string }[] })?.issues;
    throw new Error(
      issues?.[0]?.message ??
        (body as { message?: string })?.message ??
        "Não consegui concluir. Tente de novo.",
    );
  }
  return body;
}

/** Máscara de celular conforme digita — o campo mais errado de qualquer form. */
function mascararTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Abrir uma empresa sem falar com ninguém.
 *
 * Dois passos e nada mais: os dados, e o código que chega no WhatsApp. Cada
 * campo a mais aqui derruba cadastro — CNPJ, endereço e o resto se pede lá
 * dentro, quando a pessoa já viu o produto funcionando.
 */
export default function CadastroPage() {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>("dados");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [destino, setDestino] = useState("");

  const [form, setForm] = useState({
    empresa: "",
    adminNome: "",
    adminEmail: "",
    telefone: "",
    adminSenha: "",
    website: "", // honeypot: invisível, só robô preenche
  });
  const [codigo, setCodigo] = useState("");

  async function enviarDados(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      const r = (await chamar("iniciar", form)) as { destinoMascarado?: string };
      setDestino(r?.destinoMascarado ?? "");
      setPasso("codigo");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    try {
      await chamar("confirmar", { telefone: form.telefone, codigo });
      // Entra direto: pedir pra ele fazer login logo depois de provar quem é
      // seria burocracia pura.
      const res = await signIn("credentials", {
        email: form.adminEmail,
        senha: form.adminSenha,
        redirect: false,
      });
      if (res?.error) {
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
      setCarregando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-2">
        <MovatruckLogo width={180} />
        <p className="text-center text-sm text-muted-foreground">
          Crie sua conta e comece a usar hoje. Sem cartão, sem instalação.
        </p>
      </div>

      <Card className="p-6">
        {passo === "dados" ? (
          <form className="space-y-4" onSubmit={enviarDados}>
            <div className="space-y-2">
              <Label htmlFor="empresa">Nome da sua transportadora</Label>
              <Input
                id="empresa"
                required
                autoFocus
                value={form.empresa}
                onChange={(e) => setForm({ ...form, empresa: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminNome">Seu nome</Label>
              <Input
                id="adminNome"
                required
                autoComplete="name"
                value={form.adminNome}
                onChange={(e) => setForm({ ...form, adminNome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefone">Seu WhatsApp</Label>
              <Input
                id="telefone"
                required
                inputMode="numeric"
                autoComplete="tel"
                placeholder="(42) 99988-7766"
                value={mascararTelefone(form.telefone)}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                É pra onde vai o código de confirmação.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminEmail">Seu e-mail</Label>
              <Input
                id="adminEmail"
                type="email"
                required
                autoComplete="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Vai ser seu login no painel.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminSenha">Crie uma senha</Label>
              <Input
                id="adminSenha"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.adminSenha}
                onChange={(e) => setForm({ ...form, adminSenha: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Pelo menos 8 caracteres.</p>
            </div>

            {/* Honeypot: fora da tela, sem foco e ignorado por leitor de tela. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <Button type="submit" className="w-full" disabled={carregando}>
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Criar minha conta
              {!carregando && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={confirmar}>
            <div className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p>
                Mandei um código de 6 dígitos no WhatsApp que termina em{" "}
                <strong className="font-semibold">{destino}</strong>.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo"
                required
                autoFocus
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.4em]"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              />
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <Button type="submit" className="w-full" disabled={carregando || codigo.length < 6}>
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar e entrar
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => {
                  setPasso("dados");
                  setErro(null);
                }}
              >
                Corrigir meus dados
              </button>
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => {
                  void chamar("reenviar", { telefone: form.telefone }).catch(() => {});
                }}
              >
                Reenviar código
              </button>
            </div>
          </form>
        )}
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
