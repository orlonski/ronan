"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  ArrowRight,
  FileSpreadsheet,
  MapPin,
  Shield,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MovatruckLogo } from "@/components/movatruck-logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { email, senha, redirect: false, callbackUrl });
    setLoading(false);
    if (res?.error) {
      setError("Credenciais inválidas");
      return;
    }
    router.push(callbackUrl as never);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="senha">Senha</Label>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() =>
              alert("Entre em contato com o administrador pra recuperar sua senha.")
            }
          >
            Esqueci minha senha
          </button>
        </div>
        <Input
          id="senha"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
      </div>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full gap-2" disabled={loading}>
        {loading ? (
          "Entrando..."
        ) : (
          <>
            Entrar <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}

const FEATURES = [
  {
    icon: MapPin,
    title: "Tracking GPS",
    desc: "Em tempo real",
  },
  {
    icon: FileSpreadsheet,
    title: "Fechamentos",
    desc: "Conferência automática",
  },
  {
    icon: Sparkles,
    title: "Agente IA",
    desc: "Direto no WhatsApp",
  },
];

export default function LoginPage() {
  return (
    <main className="theme-modern-minimal relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-black px-4 py-8">
      {/* Vídeo de fundo */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
        aria-hidden="true"
      >
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>

      {/* Overlay escuro */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/60 to-black/40"
        aria-hidden="true"
      />

      {/* Conteúdo */}
      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        {/* Logo + tagline acima do card */}
        <div className="mb-6 flex flex-col items-center">
          <MovatruckLogo width={230} forcarClaro className="drop-shadow-2xl" />
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-zinc-300">
            Logistics &amp; Tracking
          </p>
        </div>

        <Card className="w-full border-border/40 bg-background/95 p-8 shadow-2xl backdrop-blur-md">
          {/* Header dentro do card */}
          <div className="mb-6 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Bem-vindo de volta
            </h1>
            <p className="text-sm text-muted-foreground">
              Acesse seu painel de operações.
            </p>
          </div>

          <Suspense
            fallback={
              <div className="text-sm text-muted-foreground">Carregando...</div>
            }
          >
            <LoginForm />
          </Suspense>

          {/* Features */}
          <div className="mt-8">
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                O que você gerencia aqui
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-3 text-center"
                >
                  <Icon className="h-4 w-4 text-primary" />
                  <p className="text-xs font-medium leading-tight">{title}</p>
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Footer: status + versão */}
          <div className="mt-6 flex items-center justify-between border-t border-border/50 pt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>Sistemas operacionais</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              <span>Acesso autenticado</span>
            </div>
          </div>
        </Card>

        {/* Footer fora do card */}
        <p className="mt-6 text-center text-xs text-zinc-400">
          © {new Date().getFullYear()} Movatruck · Logistics &amp; Tracking
        </p>
      </div>
    </main>
  );
}
