"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, HardHat, Send, UserPlus } from "lucide-react";
import { formatTelefone, maskTelefone, telefoneDigits } from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Encarregado = {
  id: string;
  nome: string;
  telefone: string;
  ativo: boolean;
  podeVerValores: boolean;
  podePedirCaminhao: boolean;
  conviteEnviadoEm: string | null;
  ultimoAcessoEm: string | null;
  criadoEm: string;
  convidadoPor: { nome: string } | null;
};

type Lista = { link: string; itens: Encarregado[] };
type RespostaConvite = { encarregado: Encarregado; conviteEnviado: boolean; link: string };

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Quem da obra acompanha pelo celular (portal /obra). O encarregado é gente do
 * CLIENTE: entra com código no WhatsApp, vê só esta obra, e R$ só se alguém
 * daqui ligar "pode ver valores".
 */
export function EncarregadosObra({ clienteId, obraNome }: { clienteId: string; obraNome: string }) {
  const { temPermissao, temModulo } = usePermissoes();
  if (!temPermissao("encarregados.ver") || !temModulo("encarregados.ver")) return null;
  return <Conteudo clienteId={clienteId} obraNome={obraNome} />;
}

function Conteudo({ clienteId, obraNome }: { clienteId: string; obraNome: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const chave = ["encarregados-obra", clienteId];
  const lista = useQuery({
    queryKey: chave,
    enabled: Boolean(token),
    queryFn: () => fetchApi<Lista>(`/admin/clientes/${clienteId}/encarregados`, { token: token! }),
  });
  const [convidando, setConvidando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "ok" | "atencao"; texto: string } | null>(null);
  const recarregar = () => qc.invalidateQueries({ queryKey: chave });

  function resultadoConvite(r: RespostaConvite, nome: string) {
    setAviso(
      r.conviteEnviado
        ? { tom: "ok", texto: `Convite enviado no WhatsApp de ${nome}.` }
        : {
            tom: "atencao",
            texto: `O cadastro valeu, mas o WhatsApp não saiu agora. Mande o link pra ${nome} por outro caminho: ${r.link}`,
          },
    );
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <HardHat className="h-5 w-5" /> Encarregados da obra
          </h2>
          <p className="text-sm text-muted-foreground">
            Gente da obra que acompanha pelo celular: entregas do dia com a foto do ticket, a programação, e pede
            caminhão. Entra com código no WhatsApp, sem senha.
          </p>
        </div>
        <Permitido chave="encarregados.editar">
          {!convidando && (
            <Button onClick={() => setConvidando(true)}>
              <UserPlus className="h-4 w-4" /> Convidar encarregado
            </Button>
          )}
        </Permitido>
      </div>

      {lista.data && <LinkPortal link={lista.data.link} />}

      {aviso && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            aviso.tom === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      {convidando && (
        <FormConvite
          clienteId={clienteId}
          obraNome={obraNome}
          onCancelar={() => setConvidando(false)}
          onConvidou={(r, nome) => {
            setConvidando(false);
            resultadoConvite(r, nome);
            void recarregar();
          }}
        />
      )}

      {lista.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {lista.data && lista.data.itens.length === 0 && !convidando && (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Ninguém da obra tem acesso ainda.
        </p>
      )}
      {lista.data && lista.data.itens.length > 0 && (
        <ul className="divide-y rounded-md border">
          {lista.data.itens.map((e) => (
            <LinhaEncarregado
              key={e.id}
              e={e}
              clienteId={clienteId}
              onMudou={recarregar}
              onConvite={(r) => resultadoConvite(r, e.nome)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LinkPortal({ link }: { link: string }) {
  const [copiado, setCopiado] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <span className="text-muted-foreground">Endereço do portal:</span>
      <code className="font-medium">{link}</code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(link).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          });
        }}
      >
        <Copy className="h-3.5 w-3.5" /> {copiado ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

function FormConvite({
  clienteId,
  obraNome,
  onCancelar,
  onConvidou,
}: {
  clienteId: string;
  obraNome: string;
  onCancelar: () => void;
  onConvidou: (r: RespostaConvite, nome: string) => void;
}) {
  const token = useAuthToken();
  const [nome, setNome] = React.useState("");
  const [telefone, setTelefone] = React.useState("");
  const [podeVerValores, setPodeVerValores] = React.useState(false);
  const [podePedirCaminhao, setPodePedirCaminhao] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  async function convidar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) return setErro("Diga o nome do encarregado.");
    if (telefoneDigits(telefone).length !== 11) return setErro("Informe o celular com DDD (11 números).");
    if (!token) return;
    setSalvando(true);
    try {
      const r = await fetchApi<RespostaConvite>(`/admin/clientes/${clienteId}/encarregados`, {
        token,
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), telefone, podeVerValores, podePedirCaminhao }),
      });
      onConvidou(r, nome.trim());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={convidar} className="space-y-3 rounded-md border bg-muted/30 p-4">
      <p className="text-sm font-medium">Convidar alguém da obra {obraNome}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="enc-nome">Nome</Label>
          <Input id="enc-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Carlos Souza" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="enc-tel">Celular (WhatsApp)</Label>
          <Input
            id="enc-tel"
            inputMode="tel"
            value={telefone}
            onChange={(e) => setTelefone(maskTelefone(e.target.value))}
            placeholder="(43) 99999-1234"
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={podePedirCaminhao}
          onChange={(e) => setPodePedirCaminhao(e.target.checked)}
        />
        <span>
          Pode pedir caminhão pelo celular
          <span className="block text-xs text-muted-foreground">O pedido cai na Programação pra alguém daqui confirmar.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={podeVerValores}
          onChange={(e) => setPodeVerValores(e.target.checked)}
        />
        <span>
          Pode ver valores (R$)
          <span className="block text-xs text-muted-foreground">
            Sem isto ele vê peso, placa e ticket, mas nenhum valor de frete.
          </span>
        </span>
      </label>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" variant="success" disabled={salvando}>
          <Send className="h-4 w-4" /> Convidar e mandar WhatsApp
        </Button>
      </div>
    </form>
  );
}

function LinhaEncarregado({
  e,
  clienteId,
  onMudou,
  onConvite,
}: {
  e: Encarregado;
  clienteId: string;
  onMudou: () => void;
  onConvite: (r: RespostaConvite) => void;
}) {
  const token = useAuthToken();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [ocupado, setOcupado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function chamar<T>(caminho: string, method: string, body?: unknown): Promise<T | null> {
    if (!token) return null;
    setOcupado(true);
    setErro(null);
    try {
      return await fetchApi<T>(`/admin/clientes/${clienteId}/encarregados/${e.id}${caminho}`, {
        token,
        method,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      setErro((err as Error).message);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function alternar(campo: "podeVerValores" | "podePedirCaminhao" | "ativo", valor: boolean) {
    if (campo === "ativo" && !valor) {
      const ok = await confirmar({
        variant: "destructive",
        title: `Tirar o acesso de ${e.nome}?`,
        description: "Ele sai do portal na hora, em todos os aparelhos. Dá pra convidar de novo depois.",
        confirmLabel: "Tirar acesso",
        cancelLabel: "Voltar",
      });
      if (!ok) return;
    }
    if ((await chamar("", "PATCH", { [campo]: valor })) !== null) onMudou();
  }

  async function encerrarSessoes() {
    const ok = await confirmar({
      variant: "warning",
      title: "Desconectar os aparelhos?",
      description: `${e.nome} vai precisar pedir um código novo pra entrar. Use se ele perdeu o celular.`,
      confirmLabel: "Desconectar",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    await chamar("/encerrar-sessoes", "POST");
  }

  return (
    <li className="space-y-2 px-3 py-3">
      <ConfirmDialog />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {e.nome}
            {!e.ativo && <Badge className="border-transparent bg-slate-100 text-slate-600">Sem acesso</Badge>}
            {e.podeVerValores && e.ativo && (
              <Badge className="border-transparent bg-amber-100 text-amber-900">Vê valores</Badge>
            )}
          </p>
          <p className="text-sm text-muted-foreground">{formatTelefone(e.telefone)}</p>
          <p className="text-xs text-muted-foreground">
            {e.ultimoAcessoEm
              ? `Último acesso ${dataHora(e.ultimoAcessoEm)}`
              : e.conviteEnviadoEm
                ? `Convite enviado ${dataHora(e.conviteEnviadoEm)} · ainda não entrou`
                : "Convite ainda não saiu"}
            {e.convidadoPor ? ` · convidado por ${e.convidadoPor.nome}` : ""}
          </p>
        </div>
        <Permitido chave="encarregados.editar">
          <div className="flex flex-wrap gap-2">
            {e.ativo ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={async () => {
                    const r = await chamar<RespostaConvite>("/convite", "POST");
                    if (r) onConvite(r);
                    onMudou();
                  }}
                >
                  Reenviar convite
                </Button>
                <Button variant="outline" size="sm" disabled={ocupado} onClick={encerrarSessoes}>
                  Desconectar aparelhos
                </Button>
                <Button variant="destructive" size="sm" disabled={ocupado} onClick={() => alternar("ativo", false)}>
                  Tirar acesso
                </Button>
              </>
            ) : (
              <Button variant="success" size="sm" disabled={ocupado} onClick={() => alternar("ativo", true)}>
                Devolver acesso
              </Button>
            )}
          </div>
        </Permitido>
      </div>
      {e.ativo && (
        <Permitido chave="encarregados.editar">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={e.podePedirCaminhao}
                disabled={ocupado}
                onChange={(ev) => alternar("podePedirCaminhao", ev.target.checked)}
              />
              Pode pedir caminhão
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={e.podeVerValores}
                disabled={ocupado}
                onChange={(ev) => alternar("podeVerValores", ev.target.checked)}
              />
              Pode ver valores (R$)
            </label>
          </div>
        </Permitido>
      )}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
    </li>
  );
}
