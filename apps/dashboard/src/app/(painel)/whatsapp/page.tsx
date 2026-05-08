"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  CheckCircle2,
  MessageCircle,
  QrCode,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  user: { id: string; nome: string; email: string; perfil: "ADMIN" | "OPERADOR" } | null;
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

export default function WhatsappPage() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [qrOpen, setQrOpen] = useState(false);
  const [sessaoSelecionada, setSessaoSelecionada] = useState<string | null>(null);

  const isAdmin = session?.user?.perfil === "ADMIN";

  const status = useQuery({
    queryKey: ["whatsapp-status", token],
    enabled: !!token,
    refetchInterval: 30_000,
    queryFn: () => fetchApi<Status>("/admin/whatsapp/status", { token }),
  });

  const sessoes = useQuery({
    queryKey: ["whatsapp-sessoes", token],
    enabled: !!token,
    queryFn: () => fetchApi<Sessao[]>("/admin/whatsapp/sessoes", { token }),
  });

  const mensagens = useQuery({
    queryKey: ["whatsapp-mensagens", sessaoSelecionada, token],
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

      {/* Sessões vinculadas */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Sessões vinculadas
        </h2>
        {sessoes.isLoading && <LoadingCard />}
        {sessoes.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Ninguém vinculado ainda. Gera um convite no card de um motorista ou usuário.
          </Card>
        )}
        {sessoes.data && sessoes.data.length > 0 && (
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
                  const perfil = s.motorista
                    ? "Motorista"
                    : s.user?.perfil === "ADMIN"
                    ? "Admin"
                    : "Operador";
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

function QRDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const token = useAuthToken();
  const qr = useQuery({
    queryKey: ["whatsapp-qr", open, token],
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
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
