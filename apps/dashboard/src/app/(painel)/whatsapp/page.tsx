"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  MessageCircle,
  QrCode,
  RefreshCw,
  Save,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { StatusToggle } from "@/components/status-toggle";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingCard, LoadingInline, Spinner } from "@/components/loading";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Status = {
  configurado: boolean;
  state: "open" | "close" | "connecting" | string;
  numero: string | null;
};

type Sessao = {
  id: string;
  telefone: string;
  vinculadoEm: string;
  ultimaMensagem: string | null;
  motorista: { id: string; nome: string; cpf: string } | null;
  user: { id: string; nome: string; email: string } | null;
};

type Mensagem = {
  id: string;
  telefone: string;
  direcao: "ENTRADA" | "SAIDA";
  conteudo: string;
  tipo: string;
  metadata: Record<string, unknown> | null;
  criadoEm: string;
};

type Grupo = { jid: string; nome: string; tamanho: number };

type ConfigAvisoGrupo = {
  id: string;
  ativo: boolean;
  grupoJid: string | null;
  grupoNome: string | null;
  template: string | null;
  alteradoEm: string;
};

const TEMPLATE_AVISO_PLACEHOLDER =
  "🎉 {nome} acabou de entrar no app da Schaba! Seja bem-vindo, parceiro 🚛";

type Diagnostico = {
  ok: boolean;
  motivo?: string;
  motorista?: { nome: string };
  evolutionConfigurado?: boolean;
  configAtivo?: boolean;
  grupoJid?: string | null;
  temTelefone?: boolean;
  telefoneAlvo?: string | null;
  jaAvisadoEm?: string | null;
  textoPreview?: string | null;
  enviado?: boolean;
};

export default function WhatsappPage() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [qrOpen, setQrOpen] = useState(false);
  const [sessaoSelecionada, setSessaoSelecionada] = useState<string | null>(null);
  const { viewMode, setViewMode } = useListViewMode("whatsapp-sessoes");

  const { temPermissao } = usePermissoes();
  const isAdmin = temPermissao("whatsapp.gerenciar");

  const status = useQuery({
    queryKey: ["whatsapp-status"],
    enabled: !!token,
    refetchInterval: 30_000,
    queryFn: () => fetchApi<Status>("/admin/whatsapp/status", { token }),
  });

  const sessoes = useQuery({
    queryKey: ["whatsapp-sessoes"],
    enabled: !!token,
    queryFn: () => fetchApi<Sessao[]>("/admin/whatsapp/sessoes", { token }),
  });

  const mensagens = useQuery({
    queryKey: ["whatsapp-mensagens", sessaoSelecionada],
    enabled: !!token && !!sessaoSelecionada,
    queryFn: () =>
      fetchApi<Mensagem[]>(
        `/admin/whatsapp/mensagens?sessaoId=${sessaoSelecionada}&limit=50`,
        { token },
      ),
  });

  const desvincular = useMutation({
    mutationFn: (id: string) =>
      fetchApi<void>(`/admin/whatsapp/sessoes/${id}`, { method: "DELETE", token }),
    onSuccess: () => {
      toast.success("Sessão desvinculada");
      void qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] });
      setSessaoSelecionada(null);
    },
    onError: (e: Error) => toast.error("Falha ao desvincular", { description: e.message }),
  });

  async function pedirDesvincular(id: string, nome: string) {
    const ok = await confirmar({
      title: `Desvincular WhatsApp de ${nome}?`,
      description: "A pessoa vai precisar de um novo código de convite pra voltar a usar.",
      confirmLabel: "Desvincular",
      variant: "destructive",
    });
    if (ok) desvincular.mutate(id);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Status da integração + sessões vinculadas + histórico.
          </p>
        </div>
      </header>

      {/* Status da conexão */}
      {status.isLoading ? (
        <LoadingCard label="Consultando status..." />
      ) : (
        <StatusCard
          status={status.data}
          onAbrirQR={() => setQrOpen(true)}
          isAdmin={isAdmin}
          onRefresh={() => status.refetch()}
          atualizando={status.isFetching}
        />
      )}

      {/* Aviso automático no grupo quando motorista se cadastra */}
      {status.data?.configurado && <AvisoGrupoCard isAdmin={isAdmin} online={status.data.state === "open"} />}

      {/* Sessões vinculadas */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Sessões vinculadas
          </h2>
          {sessoes.data && sessoes.data.length > 0 && (
            <ViewModeToggle value={viewMode} onChange={setViewMode} />
          )}
        </div>
        {sessoes.isLoading && <LoadingCard />}
        {sessoes.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Ninguém vinculado ainda. Gera um convite no card de um motorista ou usuário.
          </Card>
        )}
        {sessoes.data && sessoes.data.length > 0 && viewMode === "cards" && (
          <div className="space-y-3">
            {sessoes.data.map((s) => {
              const nome = s.motorista?.nome ?? s.user?.nome ?? "—";
              const perfil = s.motorista ? "Motorista" : "Admin";
              return (
                <Card
                  key={s.id}
                  className={`cursor-pointer overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md ${
                    sessaoSelecionada === s.id ? "border-primary/40 bg-muted/40" : ""
                  }`}
                  onClick={() => setSessaoSelecionada(s.id)}
                >
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
                    <Badge
                      className={
                        s.motorista
                          ? "border-blue-200 bg-blue-50 text-blue-800"
                          : "border-purple-200 bg-purple-50 text-purple-800"
                      }
                    >
                      {perfil}
                    </Badge>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{nome}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono">+{s.telefone}</span>
                        <span>·</span>
                        <span>Vinculado {fmtDataHora(s.vinculadoEm)}</span>
                        {s.ultimaMensagem && (
                          <>
                            <span>·</span>
                            <span>Última msg {fmtDataHora(s.ultimaMensagem)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Desvincular"
                          onClick={(e) => {
                            e.stopPropagation();
                            void pedirDesvincular(s.id, nome);
                          }}
                          className="hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {sessoes.data && sessoes.data.length > 0 && viewMode === "table" && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Vinculado em</TableHead>
                  <TableHead>Última mensagem</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessoes.data.map((s) => {
                  const nome = s.motorista?.nome ?? s.user?.nome ?? "—";
                  const perfil = s.motorista ? "Motorista" : "Admin";
                  return (
                    <TableRow
                      key={s.id}
                      className={`cursor-pointer ${
                        sessaoSelecionada === s.id ? "bg-muted/40" : ""
                      }`}
                      onClick={() => setSessaoSelecionada(s.id)}
                    >
                      <TableCell className="font-medium">{nome}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            s.motorista
                              ? "border-blue-200 bg-blue-50 text-blue-800"
                              : "border-purple-200 bg-purple-50 text-purple-800"
                          }
                        >
                          {perfil}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">+{s.telefone}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDataHora(s.vinculadoEm)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.ultimaMensagem ? fmtDataHora(s.ultimaMensagem) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Desvincular"
                            onClick={(e) => {
                              e.stopPropagation();
                              void pedirDesvincular(s.id, nome);
                            }}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      {/* Histórico da sessão selecionada */}
      {sessaoSelecionada && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Histórico de mensagens
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSessaoSelecionada(null)}>
              Fechar
            </Button>
          </div>
          {mensagens.isLoading ? (
            <LoadingCard />
          ) : (
            <Card className="space-y-2 p-4">
              {mensagens.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem mensagens ainda.</p>
              )}
              {mensagens.data
                ?.slice()
                .reverse()
                .map((m) => (
                  <MensagemBubble key={m.id} mensagem={m} />
                ))}
            </Card>
          )}
        </section>
      )}

      <QRDialog open={qrOpen} onOpenChange={setQrOpen} />
      <ConfirmDialog />
    </div>
  );
}

function StatusCard({
  status,
  onAbrirQR,
  isAdmin,
  onRefresh,
  atualizando,
}: {
  status: Status | undefined;
  onAbrirQR: () => void;
  isAdmin: boolean;
  onRefresh: () => void;
  atualizando: boolean;
}) {
  if (!status?.configurado) {
    return (
      <Card className="border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <XCircle className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <p className="font-medium text-amber-900">Evolution API não configurada</p>
            <p className="mt-1 text-sm text-amber-800">
              Defina <code>EVOLUTION_API_URL</code>, <code>EVOLUTION_API_KEY</code> e{" "}
              <code>EVOLUTION_INSTANCE</code> nas variáveis de ambiente da API. Veja{" "}
              <code>docs/whatsapp-evolution-easypanel.md</code>.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const online = status.state === "open";
  const conectando = status.state === "connecting";

  return (
    <Card className={`p-5 ${online ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              online ? "bg-green-100" : conectando ? "bg-amber-100" : "bg-red-100"
            }`}
          >
            <MessageCircle
              className={`h-6 w-6 ${
                online ? "text-green-700" : conectando ? "text-amber-700" : "text-red-700"
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              {online ? (
                <Badge className="border-green-200 bg-green-50 text-green-800">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Online
                </Badge>
              ) : conectando ? (
                <Badge className="border-amber-200 bg-amber-50 text-amber-800">Conectando</Badge>
              ) : (
                <Badge className="border-red-200 bg-red-50 text-red-800">
                  <XCircle className="mr-1 h-3 w-3" /> Offline
                </Badge>
              )}
              {status.numero && (
                <span className="font-mono text-sm text-muted-foreground">+{status.numero}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {online
                ? "Recebendo mensagens normalmente."
                : "WhatsApp não está conectado. Escaneia o QR pra parear."}
            </p>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={atualizando}>
            {atualizando ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
          {isAdmin && !online && (
            <Button size="sm" onClick={onAbrirQR}>
              <QrCode className="h-4 w-4" />
              Conectar
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function AvisoGrupoCard({ isAdmin, online }: { isAdmin: boolean; online: boolean }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { plataforma, conta } = usePermissoes();

  // O número do WhatsApp é UM só, mas o grupo é de cada empresa. Quem opera a
  // plataforma escolhe aqui de qual empresa está configurando o grupo; para os
  // demais, é sempre a própria (e o seletor nem aparece).
  const [contaAlvo, setContaAlvo] = useState<string>("");
  const empresas = useQuery({
    queryKey: ["contas-para-grupo"],
    enabled: !!token && plataforma,
    staleTime: 5 * 60_000,
    queryFn: () => fetchApi<{ id: string; nome: string }[]>("/admin/contas", { token }),
  });

  const alvo = contaAlvo || conta?.id || "";
  const sufixo = plataforma && alvo && alvo !== conta?.id ? `?contaId=${alvo}` : "";

  const cfg = useQuery({
    queryKey: ["aviso-grupo-config", alvo],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigAvisoGrupo>(`/admin/whatsapp/aviso-grupo${sufixo}`, { token }),
  });

  // Grupos só carregam quando o número está conectado (precisa do Baileys).
  const grupos = useQuery({
    queryKey: ["whatsapp-grupos"],
    enabled: !!token && online,
    staleTime: 60_000,
    queryFn: () => fetchApi<Grupo[]>("/admin/whatsapp/grupos", { token }),
  });

  const [ativo, setAtivo] = useState(false);
  const [grupoJid, setGrupoJid] = useState("");
  const [template, setTemplate] = useState("");

  useEffect(() => {
    if (cfg.data) {
      setAtivo(cfg.data.ativo);
      setGrupoJid(cfg.data.grupoJid ?? "");
      setTemplate(cfg.data.template ?? "");
    }
  }, [cfg.data]);

  const salvar = useMutation({
    mutationFn: () => {
      const nome =
        grupos.data?.find((g) => g.jid === grupoJid)?.nome ?? cfg.data?.grupoNome ?? null;
      return fetchApi<ConfigAvisoGrupo>(`/admin/whatsapp/aviso-grupo${sufixo}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          ativo,
          grupoJid: grupoJid || null,
          grupoNome: grupoJid ? nome : null,
          template: template.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Aviso no grupo salvo");
      void qc.invalidateQueries({ queryKey: ["aviso-grupo-config"] });
    },
    onError: (e: Error) => toast.error("Falha ao salvar", { description: e.message }),
  });

  if (cfg.isLoading) return <LoadingCard label="Carregando aviso do grupo..." />;

  // Se o grupo salvo não está na lista (offline ou sumiu), mostra ele mesmo assim.
  const opcoes: Grupo[] = grupos.data ? [...grupos.data] : [];
  if (cfg.data?.grupoJid && !opcoes.some((g) => g.jid === cfg.data!.grupoJid)) {
    opcoes.unshift({
      jid: cfg.data.grupoJid,
      nome: cfg.data.grupoNome ?? "(grupo configurado)",
      tamanho: 0,
    });
  }

  return (
    <Card className={`space-y-4 p-5 ${ativo ? "" : "border-border/60"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Users className="h-4 w-4" />
            Aviso no grupo quando motorista entra no app
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Quando um motorista <strong>se cadastra no app</strong>, o sistema posta um aviso no
            grupo escolhido. Dispara só uma vez por motorista — não precisa que ele já esteja no
            grupo.
          </p>
        </div>
        <StatusToggle active={ativo} onChange={setAtivo} disabled={!isAdmin} label />
      </div>

      {/* Só a plataforma escolhe a empresa. Para o admin de uma empresa, isto nem
          aparece — a configuração é sempre a dela. */}
      {plataforma && (
        <div className="space-y-2 border-t pt-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Empresa que recebe este aviso
          </label>
          <Select value={alvo} onChange={(e) => setContaAlvo(e.target.value)}>
            {(empresas.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Cada empresa tem o grupo dela. O número que envia é o mesmo para todas — só o grupo
            de destino muda.
          </p>
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        <label className="block text-xs font-medium text-muted-foreground">Grupo destino</label>
        {!online && (
          <p className="text-[11px] text-amber-700">
            WhatsApp offline — conecta pra listar os grupos. O grupo já salvo continua valendo.
          </p>
        )}
        <Select
          value={grupoJid}
          onChange={(e) => setGrupoJid(e.target.value)}
          disabled={!isAdmin}
        >
          <option value="">— Nenhum (desativado) —</option>
          {opcoes.map((g) => (
            <option key={g.jid} value={g.jid}>
              {g.nome}
              {g.tamanho ? ` (${g.tamanho})` : ""}
            </option>
          ))}
        </Select>
        {grupos.isFetching && <LoadingInline label="Carregando grupos..." />}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground">
          Mensagem do aviso
        </label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={TEMPLATE_AVISO_PLACEHOLDER}
          rows={2}
          maxLength={400}
          disabled={!isAdmin}
          className="w-full rounded-md border border-input bg-background p-2 text-sm disabled:opacity-60"
        />
        <p className="text-[11px] text-muted-foreground">
          Use <code>{"{nome}"}</code> pro primeiro nome do motorista. Em branco usa o padrão.
        </p>
      </div>

      {isAdmin && (
        <div className="flex items-center justify-end gap-3">
          {ativo && !grupoJid && (
            <span className="text-[11px] text-amber-700">
              Escolha um grupo pra ativar o disparo.
            </span>
          )}
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            <Save className="h-4 w-4" />
            {salvar.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      )}

      {isAdmin && <DiagnosticoAvisoGrupo />}
    </Card>
  );
}

/**
 * Testa a régua do aviso pra um motorista específico (por CPF) e mostra em qual
 * etapa parou. "Testar" é dry-run; "Forçar envio" manda de verdade ignorando a
 * trava de envio único — pra confirmar que o disparo no grupo funciona.
 */
function DiagnosticoAvisoGrupo() {
  const token = useAuthToken();
  const [cpf, setCpf] = useState("");

  const rodar = useMutation({
    mutationFn: (enviar: boolean) =>
      fetchApi<Diagnostico>(
        `/admin/whatsapp/aviso-grupo/diagnostico?motorista=${encodeURIComponent(
          cpf.replace(/\D/g, ""),
        )}&enviar=${enviar}`,
        { token },
      ),
    onError: (e: Error) => toast.error("Falha no diagnóstico", { description: e.message }),
  });

  const d = rodar.data;

  return (
    <div className="space-y-3 border-t pt-3">
      <label className="block text-xs font-medium text-muted-foreground">
        Testar com um motorista
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
          placeholder="CPF do motorista (só números)"
          inputMode="numeric"
          className="w-56 rounded-md border border-input bg-background p-2 text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={rodar.isPending || cpf.replace(/\D/g, "").length !== 11}
          onClick={() => rodar.mutate(false)}
        >
          {rodar.isPending ? <Spinner /> : null} Testar (sem enviar)
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={rodar.isPending || cpf.replace(/\D/g, "").length !== 11}
          onClick={() => rodar.mutate(true)}
        >
          Forçar envio
        </Button>
      </div>

      {d && (
        <div
          className={`space-y-1 rounded-md border p-3 text-xs ${
            d.enviado ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className="font-medium">{d.enviado ? "✅ Enviado!" : d.motivo}</p>
          {d.motorista && <DiagLinha k="Motorista" v={d.motorista.nome} />}
          <DiagLinha k="Evolution conectada" v={boolTxt(d.evolutionConfigurado)} />
          <DiagLinha k="Aviso ligado" v={boolTxt(d.configAtivo)} />
          <DiagLinha k="Grupo escolhido" v={d.grupoJid ? "sim" : "não"} />
          <DiagLinha k="Telefone do motorista" v={d.telefoneAlvo ?? "—"} />
          {d.jaAvisadoEm && <DiagLinha k="Já avisado em" v={fmtDataHora(d.jaAvisadoEm)} />}
          {d.textoPreview && <DiagLinha k="Mensagem" v={d.textoPreview} />}
        </div>
      )}
    </div>
  );
}

function DiagLinha({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </p>
  );
}

function boolTxt(b: boolean | undefined): string {
  return b ? "sim" : "não";
}

function QRDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const token = useAuthToken();
  const qr = useQuery({
    queryKey: ["whatsapp-qr", open],
    enabled: open && !!token,
    refetchInterval: open ? 5_000 : false,
    queryFn: async () => {
      // Tenta primeiro o endpoint direto (que pega do Evolution na hora)
      const direto = await fetchApi<{ base64: string | null; pairingCode: string | null }>(
        "/admin/whatsapp/qrcode",
        { token },
      );
      if (direto.base64) return direto;
      // Fallback: lê do cache (preenchido pelo webhook QRCODE_UPDATED)
      const cache = await fetchApi<{ base64: string | null; capturadoEm: string | null }>(
        "/admin/whatsapp/qrcode-cache",
        { token },
      );
      return { base64: cache.base64, pairingCode: null };
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Abre o WhatsApp no celular → Configurações → Aparelhos conectados → Conectar um
            aparelho → escaneia o QR.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center p-4">
          {qr.isLoading || !qr.data ? (
            <LoadingInline label="Gerando QR..." />
          ) : qr.data.base64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr.data.base64.startsWith("data:") ? qr.data.base64 : `data:image/png;base64,${qr.data.base64}`}
              alt="QR Code WhatsApp"
              className="h-64 w-64 rounded border"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              QR não disponível. A instância pode já estar conectada — fecha e atualiza.
            </p>
          )}
        </div>
        {qr.data?.pairingCode && (
          <p className="text-center font-mono text-lg tracking-widest">
            ou usa o código: {qr.data.pairingCode}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MensagemBubble({ mensagem }: { mensagem: Mensagem }) {
  const entrada = mensagem.direcao === "ENTRADA";
  return (
    <div className={`flex ${entrada ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          entrada ? "bg-muted" : "bg-blue-600 text-white"
        }`}
      >
        <p className="break-words whitespace-pre-wrap">{mensagem.conteudo || `[${mensagem.tipo}]`}</p>
        <p
          className={`mt-1 text-[10px] ${
            entrada ? "text-muted-foreground" : "text-blue-100"
          }`}
        >
          {fmtDataHora(mensagem.criadoEm)}
        </p>
      </div>
    </div>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
