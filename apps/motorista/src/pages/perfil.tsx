import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { useMe } from "@/lib/queries";

export default function PerfilPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [showChange, setShowChange] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function sair() {
    clearTokens();
    navigate("/login", { replace: true });
  }

  async function trocarSenha(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
      await api.post("/m/auth/trocar-senha", { senhaAtual, novaSenha });
      setFeedback({ type: "ok", msg: "Senha alterada." });
      setSenhaAtual("");
      setNovaSenha("");
      setShowChange(false);
    } catch (err) {
      setFeedback({ type: "err", msg: (err as Error).message || "Erro ao trocar senha" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-4 space-y-6">
      <header className="space-y-1 pt-2">
        <h1 className="text-xl font-semibold">Perfil</h1>
      </header>

      <section className="rounded-lg border bg-background p-4">
        <dl className="space-y-2 text-sm">
          <Row dt="Nome" dd={me.data?.nome ?? "—"} />
          <Row dt="Usuário" dd={me.data?.usuario ?? "—"} mono />
          <Row dt="Telefone" dd={me.data?.telefone ?? "—"} />
          <Row dt="Placa padrão" dd={me.data?.veiculoDefault?.placa ?? "—"} mono />
        </dl>
      </section>

      <section className="space-y-3">
        {!showChange && (
          <Button variant="outline" size="lg" className="w-full" onClick={() => setShowChange(true)}>
            <KeyRound className="h-5 w-5" /> Trocar senha
          </Button>
        )}

        {showChange && (
          <form onSubmit={trocarSenha} className="space-y-3 rounded-lg border bg-background p-4">
            <div className="space-y-1.5">
              <Label>Senha atual</Label>
              <Input
                type="password"
                required
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <Input
                type="password"
                required
                minLength={6}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        )}

        {feedback && (
          <p className={`text-sm ${feedback.type === "ok" ? "text-green-700" : "text-red-600"}`}>
            {feedback.msg}
          </p>
        )}

        <Button variant="ghost" size="lg" className="w-full text-red-600" onClick={sair}>
          <LogOut className="h-5 w-5" /> Sair
        </Button>
      </section>
    </div>
  );
}

function Row({ dt, dd, mono }: { dt: string; dd: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{dt}</dt>
      <dd className={mono ? "font-mono" : ""}>{dd}</dd>
    </div>
  );
}
