import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, KeyRound, LogOut } from "lucide-react";
import { formatCpf, formatTelefone } from "@ronan/shared-types";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus } from "@/lib/cadastro-status";
import { useMe } from "@/lib/queries";
import {
  estadoPermissao,
  obterEEnviarPushToken,
  suportaPush,
} from "@/lib/notifications";

export default function PerfilPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [showChange, setShowChange] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushPermissao, setPushPermissao] = useState<NotificationPermission | "unsupported">(
    "default",
  );

  useEffect(() => {
    setPushPermissao(estadoPermissao());
  }, []);

  function sair() {
    if (!confirm("Sair da conta?")) return;
    clearTokens();
    clearCadastroStatus();
    setAuthState(false);
    navigate("/login", { replace: true });
  }

  async function trocarSenha(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!senhaAtual || !novaSenha) {
      setFeedback({ type: "err", msg: "Preencha senha atual e nova senha." });
      return;
    }
    if (novaSenha.length < 6) {
      setFeedback({ type: "err", msg: "Nova senha precisa ter ao menos 6 caracteres." });
      return;
    }
    setLoading(true);
    try {
      await api.post("/m/auth/trocar-senha", { senhaAtual, novaSenha });
      setFeedback({ type: "ok", msg: "Senha alterada." });
      setSenhaAtual("");
      setNovaSenha("");
      setShowChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : (err as Error).message ?? "Erro ao trocar senha";
      setFeedback({ type: "err", msg });
    } finally {
      setLoading(false);
    }
  }

  async function ativarPush() {
    await obterEEnviarPushToken();
    setPushPermissao(estadoPermissao());
  }

  return (
    <div>
      <div className="bg-brand">
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-safe">
          <div className="flex-1 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Conta</p>
            <p className="mt-0.5 text-2xl font-bold text-white">Perfil</p>
          </div>
          <div className="pt-3">
            <NotificationBell />
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <Card>
          <Row dt="Nome" dd={me.data?.nome ?? "—"} />
          <Row dt="CPF" dd={me.data?.cpf ? formatCpf(me.data.cpf) : "—"} mono />
          <Row dt="Telefone" dd={me.data?.telefone ? formatTelefone(me.data.telefone) : "—"} />
          {me.data?.veiculos && me.data.veiculos.length > 0 ? (
            <div className="py-1.5">
              <p className="text-sm text-muted-foreground">Placas</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {me.data.veiculos.map((v) => {
                  const ehPadrao = v.id === me.data?.veiculoDefaultId;
                  return (
                    <span
                      key={v.id}
                      className={`rounded px-2 py-0.5 text-sm tabular ${
                        ehPadrao
                          ? "bg-secondary font-medium text-secondary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {v.placa}
                      {ehPadrao ? " · padrão" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <Row dt="Placas" dd="—" />
          )}
        </Card>

        {pushPermissao !== "unsupported" && (
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
                {pushPermissao === "granted" ? (
                  <Bell size={20} className="text-primary" />
                ) : (
                  <BellOff size={20} className="text-muted-foreground" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-base font-bold text-foreground">Notificações push</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {pushPermissao === "granted"
                    ? "Ativadas. Você receberá avisos do escritório."
                    : pushPermissao === "denied"
                    ? "Bloqueadas pelo navegador. Ajuste nas configurações do site."
                    : "Não estão ativas. Toque pra permitir."}
                </p>
                {pushPermissao !== "granted" && pushPermissao !== "denied" && suportaPush() && (
                  <Button onClick={ativarPush} size="sm" className="mt-3">
                    Ativar notificações
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {!showChange && (
          <Button variant="outline" size="lg" onClick={() => setShowChange(true)} className="w-full">
            <KeyRound size={18} />
            Trocar senha
          </Button>
        )}

        {showChange && (
          <Card>
            <form onSubmit={trocarSenha} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="atual">Senha atual</Label>
                <Input
                  id="atual"
                  type="password"
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nova">Nova senha</Label>
                <Input
                  id="nova"
                  type="password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowChange(false);
                    setSenhaAtual("");
                    setNovaSenha("");
                    setFeedback(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1" loading={loading}>
                  {loading ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {feedback && (
          <p
            className={
              feedback.type === "ok"
                ? "text-sm font-medium text-success"
                : "text-sm font-medium text-destructive"
            }
          >
            {feedback.msg}
          </p>
        )}

        <Button variant="outline" size="lg" onClick={sair} className="w-full text-destructive">
          <LogOut size={18} />
          Sair
        </Button>

        <p className="pt-4 text-center text-xs text-muted-foreground">
          Schaba — Motorista PWA
        </p>
      </div>
    </div>
  );
}

function Row({ dt, dd, mono }: { dt: string; dd: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <p className="text-sm text-muted-foreground">{dt}</p>
      <p className={`flex-1 truncate text-right text-sm text-foreground ${mono ? "tabular" : ""}`}>{dd}</p>
    </div>
  );
}
