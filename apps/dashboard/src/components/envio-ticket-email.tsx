"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import {
  MAX_EMAILS_TICKET,
  MODO_ENVIO_TICKET_LABEL,
  type ConfigEnvioTicket,
  type ModoEnvioTicket,
} from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TagInput } from "@/components/ui/tag-input";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

/** "Seguir o cliente" no select da obra (o null do modo). */
const SEGUE = "__SEGUE__";

const ROTULO_TIPO: Record<string, string> = {
  TICKET_VIAGEM: "Ticket da viagem",
  TICKET_RESUMO_DIARIO: "Resumo do dia",
  TICKET_TESTE: "Teste",
};

/**
 * TICKETS POR E-MAIL, dentro do cadastro do cliente pagador e da obra.
 *
 * Fica na página do cadastro (e não numa tela própria) porque a pergunta que
 * se faz é "esse cliente recebe o ticket?" — e a resposta mora com ele. Nasce
 * em "Não enviar": nenhum cliente começa a receber e-mail sem alguém ligar.
 */
export function EnvioTicketEmail({ alvo, id }: { alvo: "empresas" | "obras"; id: string }) {
  const { temPermissao } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();
  const recurso = alvo === "empresas" ? "empresas" : "clientes";
  const podeVer = temPermissao(`${recurso}.ver`);
  const podeEditar = temPermissao(`${recurso}.editar`);
  const path = `/admin/envio-ticket/${alvo}/${id}`;
  const q = useApiQuery<ConfigEnvioTicket>(podeVer ? path : undefined);

  const [modo, setModo] = useState<string>(alvo === "obras" ? SEGUE : "NENHUM");
  const [emails, setEmails] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setModo(q.data.modo ?? SEGUE);
    setEmails(q.data.emails);
  }, [q.data]);

  if (!podeVer || !q.data) return null;
  const cfg = q.data;
  const segue = modo === SEGUE;
  const modoReal: ModoEnvioTicket | null = segue ? null : (modo as ModoEnvioTicket);
  // Com "seguir o cliente", quem recebe é a lista do pagador — é pra ela que o teste vai.
  const emailsDoTeste = segue ? (cfg.efetivo?.emails ?? []) : emails;
  const mudou = (cfg.modo ?? SEGUE) !== modo || cfg.emails.join(",") !== emails.join(",");

  async function salvar() {
    setSalvando(true);
    try {
      await fetchApi(path, {
        method: "PUT",
        token,
        body: JSON.stringify({ modo: modoReal, emails: segue ? [] : emails }),
      });
      toast.success(
        modoReal === "NENHUM"
          ? "Pronto: nenhum ticket sai por e-mail."
          : segue
            ? "Pronto: a obra segue o que está no cliente."
            : "Pronto: os tickets passam a ir por e-mail a partir de agora.",
      );
      await qc.invalidateQueries({ queryKey: [path, "get"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function enviarTeste() {
    setTestando(true);
    try {
      await fetchApi(`${path}/teste`, {
        method: "POST",
        token,
        body: JSON.stringify({ emails: emailsDoTeste }),
      });
      toast.success(`E-mail de teste enviado para ${emailsDoTeste.join(", ")}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      await qc.invalidateQueries({ queryKey: [path, "get"] });
      setTestando(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="font-semibold">Tickets por e-mail</h2>
          <p className="text-sm text-muted-foreground">
            Quando a viagem é aprovada, {alvo === "empresas" ? "o cliente" : "a obra"} recebe placa,
            material, peso e o link do comprovante com a foto do ticket. Valor em R$ nunca vai.
          </p>
        </div>
      </div>

      {!cfg.emailDisponivel && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          O envio de e-mail ainda não foi ligado no servidor. O que você salvar aqui fica guardado e
          passa a valer quando ligar.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`modo-ticket-${id}`}>Quando enviar</Label>
          <Select
            id={`modo-ticket-${id}`}
            value={modo}
            disabled={!podeEditar}
            onChange={(e) => setModo(e.target.value)}
          >
            {alvo === "obras" && <option value={SEGUE}>Seguir o cliente</option>}
            {(Object.keys(MODO_ENVIO_TICKET_LABEL) as ModoEnvioTicket[]).map((m) => (
              <option key={m} value={m}>
                {MODO_ENVIO_TICKET_LABEL[m]}
              </option>
            ))}
          </Select>
        </div>

        {!segue && modo !== "NENHUM" && (
          <div className="space-y-1.5">
            <Label>E-mails que recebem os tickets</Label>
            {podeEditar ? (
              <TagInput
                value={emails}
                onChange={setEmails}
                maxItems={MAX_EMAILS_TICKET}
                placeholder="nome@cliente.com.br e tecle Enter"
              />
            ) : (
              <p className="text-sm">{emails.join(", ") || "—"}</p>
            )}
          </div>
        )}
      </div>

      {segue && cfg.efetivo && (
        <p className="mt-3 text-sm text-muted-foreground">
          Hoje vale o do cliente:{" "}
          <strong className="text-foreground">{MODO_ENVIO_TICKET_LABEL[cfg.efetivo.modo]}</strong>
          {cfg.efetivo.modo !== "NENHUM" && cfg.efetivo.emails.length > 0 && (
            <> para {cfg.efetivo.emails.join(", ")}</>
          )}
          .
        </p>
      )}

      {podeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="success" onClick={() => void salvar()} disabled={salvando || !mudou}>
            {salvando ? "Salvando…" : "Salvar envio"}
          </Button>
          <Button
            onClick={() => void enviarTeste()}
            disabled={testando || emailsDoTeste.length === 0 || !cfg.emailDisponivel}
            title={emailsDoTeste.length === 0 ? "Informe pelo menos um e-mail" : undefined}
          >
            {testando ? "Enviando…" : "Enviar teste"}
          </Button>
        </div>
      )}

      {cfg.historico.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium">Últimos envios</h3>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {cfg.historico.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.assunto}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROTULO_TIPO[h.tipo] ?? h.tipo} · {h.para.join(", ")} ·{" "}
                    {new Date(h.criadoEm).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  {h.status === "FALHOU" && h.erro && (
                    <p className="text-xs text-red-700 dark:text-red-400">{h.erro}</p>
                  )}
                </div>
                <StatusEnvio status={h.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function StatusEnvio({ status }: { status: ConfigEnvioTicket["historico"][number]["status"] }) {
  if (status === "ENVIADO")
    return <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Enviado</Badge>;
  if (status === "FALHOU")
    return <Badge className="border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">Falhou</Badge>;
  return <Badge className="border-border text-muted-foreground">Enviando</Badge>;
}
