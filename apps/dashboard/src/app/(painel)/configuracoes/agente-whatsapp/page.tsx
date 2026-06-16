"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageCircle, Power, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusToggle } from "@/components/status-toggle";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ProviderId = "anthropic" | "gemini";

type ConfigAgente = {
  id: string;
  provider: ProviderId;
  modeloAnthropic: string;
  modeloGemini: string;
  ativo: boolean;
  mensagemInativo: string | null;
  alteradoEm: string;
  keys: { anthropic: boolean; gemini: boolean };
};

const MENSAGEM_INATIVO_PLACEHOLDER =
  "Oi! 👋 Esse número é só pra envios automáticos (avisos e código de cadastro). Pra registrar suas viagens, use o app. Qualquer dúvida, fala com o escritório!";

const PATH = "/admin/agente-config";

type ProviderInfo = {
  id: ProviderId;
  nome: string;
  icone: string;
  custoLabel: string;
  descricao: string;
  envKeyLabel: string;
};

const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    nome: "Anthropic Claude",
    icone: "🧠",
    custoLabel: "Médio (~$25/mês estimado)",
    descricao:
      "Sonnet 4.6 com prompt caching ligado. Mais confiável em tool use complexo (lançar viagem com vários campos), tom PT-BR fica natural.",
    envKeyLabel: "ANTHROPIC_API_KEY",
  },
  {
    id: "gemini",
    nome: "Google Gemini",
    icone: "✨",
    custoLabel: "Barato (~$8/mês estimado)",
    descricao:
      "Gemini 2.5 Flash. Bem mais barato, latência baixa no Brasil, tool use sólido. Pode ter regressões pequenas em conversas longas — vale comparar.",
    envKeyLabel: "GEMINI_API_KEY",
  },
];

const MODELOS_ANTHROPIC = [
  { id: "claude-haiku-4-5-20251001", nome: "Haiku 4.5", hint: "+ barato, pode alucinar tool calls" },
  { id: "claude-sonnet-4-6", nome: "Sonnet 4.6", hint: "padrão, equilíbrio" },
  { id: "claude-opus-4-7", nome: "Opus 4.7", hint: "+ caro, qualidade máxima" },
];

const MODELOS_GEMINI = [
  { id: "gemini-2.5-flash-lite", nome: "Flash Lite", hint: "+ barato, tool use limitado" },
  { id: "gemini-2.5-flash", nome: "Flash", hint: "padrão, equilíbrio" },
  { id: "gemini-2.5-pro", nome: "Pro", hint: "+ caro, qualidade máxima" },
];

export default function AgenteConfigPage() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();

  const cfg = useQuery({
    queryKey: [PATH, token],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigAgente>(PATH, { token }),
  });

  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [modeloAnthropic, setModeloAnthropic] = useState("claude-sonnet-4-6");
  const [modeloGemini, setModeloGemini] = useState("gemini-2.5-flash");
  const [ativo, setAtivo] = useState(true);
  const [mensagemInativo, setMensagemInativo] = useState("");

  useEffect(() => {
    if (cfg.data) {
      setProvider(cfg.data.provider);
      setModeloAnthropic(cfg.data.modeloAnthropic);
      setModeloGemini(cfg.data.modeloGemini);
      setAtivo(cfg.data.ativo);
      setMensagemInativo(cfg.data.mensagemInativo ?? "");
    }
  }, [cfg.data]);

  const update = useMutation({
    mutationFn: (body: {
      provider: ProviderId;
      modeloAnthropic: string;
      modeloGemini: string;
      ativo: boolean;
      mensagemInativo: string | null;
    }) =>
      fetchApi<ConfigAgente>(PATH, {
        method: "PUT",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });

  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </div>
    );
  }

  if (cfg.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  async function salvar() {
    await update.mutateAsync({
      provider,
      modeloAnthropic,
      modeloGemini,
      ativo,
      mensagemInativo: mensagemInativo.trim() || null,
    });
  }

  const keys = cfg.data?.keys ?? { anthropic: false, gemini: false };
  const providerEscolhidoTemKey = provider === "anthropic" ? keys.anthropic : keys.gemini;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MessageCircle className="h-6 w-6 text-emerald-600" />
          Agente WhatsApp
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Qual modelo de IA atende motoristas e admin via WhatsApp. A mudança vale
          na próxima mensagem — sem precisar reiniciar nada. As chaves de API
          (segredos) continuam configuradas no servidor, fora dessa tela.
        </p>
      </header>

      {/* Liga/desliga do agente */}
      <Card className={`space-y-3 p-5 ${ativo ? "" : "border-amber-300 bg-amber-50"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              <Power className="h-4 w-4" />
              Agente do WhatsApp
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Ligado: a IA responde e ajuda motoristas/admin (gera custo por
              mensagem). Desligado: <strong>não gasta nada de IA</strong> — quem
              mandar mensagem recebe um aviso automático educado. O envio de código
              de cadastro continua funcionando normalmente nos dois casos.
            </p>
          </div>
          <StatusToggle active={ativo} onChange={setAtivo} label />
        </div>

        {!ativo && (
          <div className="space-y-2 border-t pt-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Resposta automática (quando desligado)
            </label>
            <textarea
              value={mensagemInativo}
              onChange={(e) => setMensagemInativo(e.target.value)}
              placeholder={MENSAGEM_INATIVO_PLACEHOLDER}
              rows={3}
              maxLength={500}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Deixe em branco pra usar a mensagem padrão. Máx. 500 caracteres.
            </p>
          </div>
        )}
      </Card>

      {/* Status das keys */}
      <Card className={`space-y-3 p-5 ${ativo ? "" : "opacity-50"}`}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Status das chaves no servidor
        </h2>
        <div className="grid gap-2 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const ok = p.id === "anthropic" ? keys.anthropic : keys.gemini;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                  ok ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-700" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                )}
                <span className="font-mono text-xs">{p.envKeyLabel}</span>
                <span className="ml-auto text-xs">
                  {ok ? "configurada" : "faltando"}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Quando faltar, peça pra alguém com acesso ao servidor adicionar a env var
          no Easypanel (serviço da API) e reiniciar.
        </p>
      </Card>

      {/* Seleção de provider */}
      <Card className={`space-y-3 p-5 ${ativo ? "" : "opacity-50"}`}>
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Qual provider de IA usar?
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Você pode trocar a qualquer momento. Custo abaixo é estimativa pra ~10
            motoristas em uso real.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const ativo = provider === p.id;
            const temKey = p.id === "anthropic" ? keys.anthropic : keys.gemini;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={`rounded-lg border-2 p-4 text-left transition-colors ${
                  ativo
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="mb-1 text-2xl">{p.icone}</div>
                <div className="font-bold">{p.nome}</div>
                <div className="text-xs text-muted-foreground">{p.custoLabel}</div>
                <p className="mt-2 text-xs text-muted-foreground">{p.descricao}</p>
                <div className="mt-3 flex items-center justify-between text-xs">
                  {ativo && (
                    <span className="font-medium text-primary">✓ selecionado</span>
                  )}
                  {!temKey && (
                    <span className="ml-auto font-medium text-amber-700">
                      ⚠ sem key
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Modelo do provider escolhido */}
      <Card className={`space-y-3 p-5 ${ativo ? "" : "opacity-50"}`}>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Qual modelo do {provider === "anthropic" ? "Anthropic" : "Gemini"}?
        </h2>
        <p className="text-xs text-muted-foreground">
          Padrão é o equilibrado. Suba pra Premium só se notar a IA errando em
          casos complexos.
        </p>
        <div className="grid gap-2">
          {(provider === "anthropic" ? MODELOS_ANTHROPIC : MODELOS_GEMINI).map((m) => {
            const valor = provider === "anthropic" ? modeloAnthropic : modeloGemini;
            const setter =
              provider === "anthropic" ? setModeloAnthropic : setModeloGemini;
            const ativo = valor === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setter(m.id)}
                className={`flex items-center justify-between rounded-md border-2 p-3 text-left transition-colors ${
                  ativo
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div>
                  <div className="font-medium">{m.nome}</div>
                  <div className="text-xs text-muted-foreground">{m.hint}</div>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{m.id}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Alerta se provider escolhido não tem key */}
      {ativo && !providerEscolhidoTemKey && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Atenção:</strong> o provider selecionado não tem chave de API
          configurada no servidor. Se você salvar assim, o agente vai responder
          com mensagem de fallback (“IA fora do ar”) até a key ser adicionada.
        </div>
      )}

      {/* Salvar */}
      <div className="flex justify-end gap-2">
        <Button onClick={salvar} disabled={update.isPending}>
          <Save className="h-4 w-4" />
          {update.isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>

      {update.isSuccess && (
        <p className="text-right text-sm text-green-700">
          ✓ Salvo. Vale na próxima mensagem do WhatsApp.
        </p>
      )}
      {update.isError && (
        <p className="text-right text-sm text-destructive">
          {(update.error as Error).message}
        </p>
      )}
    </div>
  );
}
