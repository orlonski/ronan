"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Ban, Check, Copy, Eye, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isTelefoneValid, maskTelefone } from "@ronan/shared-types";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";

type Estado = "ATIVO" | "EXPIRADO" | "REVOGADO";

type LinkCompartilhado = {
  id: string;
  url: string;
  estado: Estado;
  expiraEm: string;
  revogadoEm: string | null;
  visualizacoes: number;
  ultimoAcessoEm: string | null;
  destinatarioTelefone: string | null;
  enviadoEm: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
};

const VALIDADES = [7, 30, 90] as const;

/**
 * Gera e gerencia links públicos do comprovante da viagem — o que o cliente
 * abre sem login.
 *
 * O aviso do topo não é decorativo: quem clica precisa saber exatamente o que
 * vai sair de casa antes de mandar o link pra fora.
 */
export function CompartilharViagemModal({ viagemId }: { viagemId: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState<number>(30);
  const [telefone, setTelefone] = useState("");
  const [mensagemExtra, setMensagemExtra] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [confirmandoRevogar, setConfirmandoRevogar] = useState<string | null>(null);

  const base = `/admin/viagens/${viagemId}/compartilhamentos`;
  const chave = ["viagem-compartilhamentos", viagemId];

  // O backend exige viagens.ver-comercial ALÉM de viagens.compartilhar (o
  // comprovante mostra km/toneladas faturados). Avisar aqui é melhor que
  // entregar um 403 depois de o usuário preencher tudo. A matriz continua
  // soberana — quem decide de verdade é o PermissaoGuard.
  const podeComercial = temPermissao("viagens.ver-comercial");

  const lista = useQuery({
    queryKey: chave,
    enabled: !!token && aberto,
    queryFn: () => fetchApi<LinkCompartilhado[]>(base, { token }),
  });

  const links = lista.data ?? [];
  const ativo = links.find((l) => l.estado === "ATIVO") ?? null;

  const gerar = useMutation({
    mutationFn: () =>
      fetchApi<LinkCompartilhado>(base, {
        method: "POST",
        body: JSON.stringify({ diasValidade: dias }),
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chave });
      toast.success("Link gerado.");
    },
    onError: (e) => toast.error("Não foi possível gerar", { description: (e as Error).message }),
  });

  const enviar = useMutation({
    mutationFn: (id: string) =>
      fetchApi<LinkCompartilhado>(`${base}/${id}/enviar-whatsapp`, {
        method: "POST",
        body: JSON.stringify({
          telefone,
          mensagemExtra: mensagemExtra.trim() || undefined,
        }),
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chave });
      toast.success(`Comprovante enviado para ${telefone}.`);
      setMensagemExtra("");
    },
    onError: (e) => toast.error("Não foi possível enviar", { description: (e as Error).message }),
  });

  const revogar = useMutation({
    mutationFn: (id: string) => fetchApi<void>(`${base}/${id}`, { method: "DELETE", token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chave });
      setConfirmandoRevogar(null);
      toast.success("Link revogado. Quem tiver o endereço não vê mais nada.");
    },
    onError: (e) => toast.error("Não foi possível revogar", { description: (e as Error).message }),
  });

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Contexto não-seguro (http sem TLS) não tem clipboard API.
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopiado(true);
    toast.success("Link copiado.");
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="mr-1.5 h-4 w-4" />
          Compartilhar
        </Button>
      </DialogTrigger>

      {/* Sem isso o Radix foca o primeiro elemento focável ao abrir — que aqui é
          o <select> de validade. No iOS, focar um select já abre o picker de
          roda: o modal nascia com o seletor "aberto" na cara do usuário. */}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Compartilhar comprovante</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Quem tiver este link vê o comprovante <strong>sem login</strong>: data, trajeto,
              placa, motorista, peso, km, fotos do ticket e valores de pedágio. Não expõe
              cliente/empresa, observações internas nem o GPS do motorista.
            </p>
          </div>

          {!podeComercial && (
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Compartilhar o comprovante expõe km e toneladas faturados — exige a permissão de
              dados comerciais. Fale com um administrador.
            </p>
          )}

          {/* --- gerar --- */}
          <div className="space-y-2">
            <Label htmlFor="validade">Validade do link</Label>
            <div className="flex gap-2">
              <Select
                id="validade"
                value={dias}
                onChange={(e) => setDias(Number(e.target.value))}
                disabled={!podeComercial}
                className="max-w-[160px]"
              >
                {VALIDADES.map((d) => (
                  <option key={d} value={d}>
                    {d} dias
                  </option>
                ))}
              </Select>
              <Button
                onClick={() => gerar.mutate()}
                disabled={!podeComercial || gerar.isPending}
              >
                <Link2 className="mr-1.5 h-4 w-4" />
                {gerar.isPending ? "Gerando…" : "Gerar link"}
              </Button>
            </div>
          </div>

          {/* --- link ativo: copiar + WhatsApp --- */}
          {ativo && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="url">Link do comprovante</Label>
                <div className="flex gap-2">
                  <Input id="url" readOnly value={ativo.url} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copiar(ativo.url)}>
                    {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tel">WhatsApp do cliente</Label>
                <Input
                  id="tel"
                  inputMode="tel"
                  placeholder="(44) 99999-9999"
                  value={telefone}
                  onChange={(e) => setTelefone(maskTelefone(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Com DDD — o 55 entra sozinho.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="extra">Mensagem extra (opcional)</Label>
                <Textarea
                  id="extra"
                  rows={2}
                  maxLength={300}
                  placeholder="Ex.: Segue o comprovante da entrega de ontem."
                  value={mensagemExtra}
                  onChange={(e) => setMensagemExtra(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                onClick={() => enviar.mutate(ativo.id)}
                disabled={!isTelefoneValid(telefone) || enviar.isPending}
              >
                {enviar.isPending ? "Enviando…" : "Enviar no WhatsApp"}
              </Button>
            </div>
          )}

          {/* --- histórico --- */}
          {links.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Links gerados</p>
              <ul className="divide-y rounded-md border">
                {links.map((l) => (
                  <li key={l.id} className="space-y-1 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <SeloEstado estado={l.estado} />
                      {l.estado !== "REVOGADO" &&
                        (confirmandoRevogar === l.id ? (
                          <div className="flex gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => revogar.mutate(l.id)}
                              disabled={revogar.isPending}
                            >
                              Confirmar revogação
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmandoRevogar(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setConfirmandoRevogar(l.id)}
                          >
                            <Ban className="mr-1 h-3.5 w-3.5" />
                            Revogar
                          </Button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Criado por {l.criadoPorNome ?? "—"} em {fmtDataHoraBR(l.criadoEm)} · expira em{" "}
                      {fmtDataHoraBR(l.expiraEm)}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      {l.visualizacoes === 0
                        ? "Nunca aberto"
                        : `${l.visualizacoes} ${l.visualizacoes === 1 ? "visualização" : "visualizações"}`}
                      {l.ultimoAcessoEm && <> · última em {fmtDataHoraBR(l.ultimoAcessoEm)}</>}
                    </p>
                    {l.enviadoEm && (
                      <p className="text-xs text-muted-foreground">
                        Enviado para {l.destinatarioTelefone} em {fmtDataHoraBR(l.enviadoEm)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SELO: Record<Estado, { texto: string; classe: string }> = {
  ATIVO: { texto: "Ativo", classe: "bg-green-100 text-green-800" },
  EXPIRADO: { texto: "Expirado", classe: "bg-slate-100 text-slate-600" },
  REVOGADO: { texto: "Revogado", classe: "bg-red-100 text-red-800" },
};

function SeloEstado({ estado }: { estado: Estado }) {
  const s = SELO[estado];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.classe}`}>{s.texto}</span>
  );
}
