"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BookOpen, Check, Copy, KeyRound, Plug, Plus, Power, RotateCcw, Send, X } from "lucide-react";
import { EVENTOS_INTEGRACAO, type AvisoResumo, type ChaveGerada, type EntregaAvisoResumo, type IntegracaoResumo } from "@ronan/shared-types";
import { RequerTela } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiBaseUrl, ApiError, fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type EscopoTela = { chave: string; titulo: string; descricao: string; podeDar: boolean };
type Lista = { integracoes: IntegracaoResumo[]; escopos: EscopoTela[]; podeCriar: boolean };

const PATH = "/admin/integracoes";

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "nunca";

const mensagem = (e: unknown) => (e instanceof ApiError ? e.message : "Não deu certo. Tente de novo.");

export default function IntegracoesPage() {
  return (
    <RequerTela chave="integracoes.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const pode = temPermissao("integracoes.gerenciar");
  const lista = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Lista>(PATH, { token }),
  });
  const [criando, setCriando] = useState(false);
  // A chave completa vive SÓ aqui, na memória desta tela, até a pessoa fechar o
  // aviso. Nada de cache global: depois disso ela não existe mais em lugar nenhum.
  const [chaveNova, setChaveNova] = useState<{ nome: string; chave: string } | null>(null);

  const ativas = lista.data?.integracoes.filter((i) => !i.revogadaEm) ?? [];
  const desligadas = lista.data?.integracoes.filter((i) => i.revogadaEm) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conectar outro sistema</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            O sistema de vocês (ERP, sistema de frete, app próprio) manda as viagens direto pra cá, sem ninguém digitar duas
            vezes. Cada conexão tem uma chave, e a chave só faz o que vocês marcarem.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={`${apiBaseUrl}/v1/docs`} target="_blank" rel="noreferrer">
              <BookOpen className="h-4 w-4" /> Instruções pra quem programa
            </a>
          </Button>
          {pode && lista.data?.podeCriar && !criando && (
            <Button onClick={() => setCriando(true)}>
              <Plus className="h-4 w-4" /> Nova conexão
            </Button>
          )}
        </div>
      </div>

      {pode && lista.data && !lista.data.podeCriar && (
        <p className="text-sm text-muted-foreground">
          Só quem administra a empresa inteira (sem restrição de frota) cria conexões, e nunca alguém visitando a empresa.
        </p>
      )}

      {chaveNova && <ChaveParaCopiar {...chaveNova} onFechar={() => setChaveNova(null)} />}

      {criando && lista.data && (
        <NovaConexao
          escopos={lista.data.escopos}
          onCancelar={() => setCriando(false)}
          onCriada={(nome, chave) => {
            setCriando(false);
            setChaveNova({ nome, chave });
          }}
        />
      )}

      {lista.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {lista.error && <p className="text-sm text-destructive">{mensagem(lista.error)}</p>}

      {lista.data && ativas.length === 0 && !criando && (
        <Card className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <Plug className="h-5 w-5 shrink-0" />
          Nenhum sistema conectado ainda.
        </Card>
      )}

      {ativas.map((i) => (
        <CartaoConexao key={i.id} integ={i} escopos={lista.data!.escopos} pode={pode} onChaveNova={(chave) => setChaveNova({ nome: i.nome, chave })} />
      ))}

      {desligadas.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Conexões desligadas ({desligadas.length})</summary>
          <div className="mt-3 space-y-2">
            {desligadas.map((i) => (
              <Card key={i.id} className="p-4 text-muted-foreground">
                <p className="font-medium">{i.nome}</p>
                <p className="text-xs">
                  Desligada em {quando(i.revogadaEm)}
                  {i.revogacaoMotivo ? ` — ${i.revogacaoMotivo}` : ""}
                </p>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function NovaConexao({
  escopos,
  onCancelar,
  onCriada,
}: {
  escopos: EscopoTela[];
  onCancelar: () => void;
  onCriada: (nome: string, chave: string) => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [sistema, setSistema] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const criar = useMutation({
    mutationFn: () =>
      fetchApi<ChaveGerada & { integracaoId: string }>(PATH, {
        method: "POST",
        token,
        body: JSON.stringify({ nome, sistema, escopos: marcados }),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: [PATH] });
      onCriada(nome, r.chave);
    },
  });

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-base font-semibold">Nova conexão</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="nome">Que sistema é</Label>
          <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ERP da empresa" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sistema">Nome curto</Label>
          <Input
            id="sistema"
            value={sistema}
            onChange={(e) => setSistema(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="erp"
          />
          <p className="text-xs text-muted-foreground">
            Identifica os números que vêm de lá (o pedido 123 do ERP). Só letras minúsculas, números e hífen.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label>O que ela pode fazer</Label>
        {escopos.map((e) => (
          <label key={e.chave} className={`flex items-start gap-3 rounded-md border p-3 ${e.podeDar ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              className="mt-1"
              disabled={!e.podeDar}
              checked={marcados.includes(e.chave)}
              onChange={(ev) => setMarcados((m) => (ev.target.checked ? [...m, e.chave] : m.filter((x) => x !== e.chave)))}
            />
            <span>
              <span className="block text-sm font-medium">{e.titulo}</span>
              <span className="block text-xs text-muted-foreground">
                {e.descricao}
                {!e.podeDar && " (você não tem essa permissão)"}
              </span>
            </span>
          </label>
        ))}
      </div>
      {criar.error && <p className="text-sm text-destructive">{mensagem(criar.error)}</p>}
      <div className="flex gap-2">
        <Button variant="success" disabled={!nome.trim() || !sistema || marcados.length === 0 || criar.isPending} onClick={() => criar.mutate()}>
          <KeyRound className="h-4 w-4" /> Criar e mostrar a chave
        </Button>
        <Button variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

function ChaveParaCopiar({ nome, chave, onFechar }: { nome: string; chave: string; onFechar: () => void }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <Card className="space-y-3 border-amber-400 bg-amber-50 p-5 dark:bg-amber-950/30">
      <h2 className="text-base font-semibold">Copie a chave de “{nome}” agora</h2>
      <p className="text-sm">
        Ela não aparece de novo — nem pra gente. Entregue só a quem vai configurar o sistema, e trate como senha: quem tiver a
        chave grava viagens em nome da empresa.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input readOnly value={chave} className="max-w-xl font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(chave).then(() => setCopiada(true));
          }}
        >
          {copiada ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copiada ? "Copiada" : "Copiar"}
        </Button>
        <Button variant="success" onClick={onFechar}>
          <Check className="h-4 w-4" /> Já guardei a chave
        </Button>
      </div>
    </Card>
  );
}

function CartaoConexao({
  integ,
  escopos,
  pode,
  onChaveNova,
}: {
  integ: IntegracaoResumo;
  escopos: EscopoTela[];
  pode: boolean;
  onChaveNova: (chave: string) => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const recarregar = () => void qc.invalidateQueries({ queryKey: [PATH] });
  const [desligando, setDesligando] = useState<{ tipo: "conexao" } | { tipo: "chave"; id: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const titulo = (k: string) => escopos.find((e) => e.chave === k)?.titulo ?? k;
  const vivas = integ.chaves.filter((c) => !c.revogadaEm);

  const gerar = useMutation({
    mutationFn: () => fetchApi<ChaveGerada>(`${PATH}/${integ.id}/chaves`, { method: "POST", token }),
    onSuccess: (r) => {
      recarregar();
      onChaveNova(r.chave);
    },
  });
  const desligar = useMutation({
    mutationFn: () =>
      fetchApi(
        desligando?.tipo === "chave" ? `${PATH}/${integ.id}/chaves/${desligando.id}/revogar` : `${PATH}/${integ.id}/revogar`,
        { method: "POST", token, body: JSON.stringify({ motivo }) },
      ),
    onSuccess: () => {
      setDesligando(null);
      setMotivo("");
      recarregar();
    },
  });

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{integ.nome}</h2>
          <p className="text-xs text-muted-foreground">
            Nome curto <span className="font-mono">{integ.sistema}</span> · criada por {integ.criadaPorNome ?? "—"} em {quando(integ.criadoEm)}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>
            {integ.uso.ultimos7Dias} chamadas nos últimos 7 dias
            {integ.uso.erros7Dias > 0 ? ` · ${integ.uso.erros7Dias} recusadas` : ""}
          </p>
          <p>Último uso: {quando(integ.uso.ultimoUsoEm)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {integ.escopos.map((e) => (
          <Badge key={e} className={integ.escoposSuspensos.includes(e) ? "text-muted-foreground" : "bg-muted"}>
            {titulo(e)}
            {integ.escoposSuspensos.includes(e) ? " (parado: módulo não contratado)" : ""}
          </Badge>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Chaves</p>
        {vivas.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="font-mono text-xs">{c.mascara}</span>
            <span className="text-xs text-muted-foreground">
              criada em {quando(c.criadoEm)} · último uso {quando(c.ultimoUsoEm)}
              {c.ultimoUsoIp ? ` (de ${c.ultimoUsoIp})` : ""}
            </span>
            {pode && !desligando && (
              <Button size="sm" variant="destructive" onClick={() => setDesligando({ tipo: "chave", id: c.id })}>
                <X className="h-4 w-4" /> Desligar chave
              </Button>
            )}
          </div>
        ))}
        {vivas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma chave ligada.</p>}
      </div>

      {desligando && (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3">
          <Label htmlFor={`motivo-${integ.id}`}>
            {desligando.tipo === "conexao"
              ? `Por que desligar a conexão "${integ.nome}"? Todas as chaves dela param na hora; nada do que ela gravou é apagado.`
              : `Por que desligar a chave ${integ.chaves.find((c) => desligando.tipo === "chave" && c.id === desligando.id)?.mascara ?? ""}? O sistema que usa ela para no próximo pedido.`}
          </Label>
          <Input id={`motivo-${integ.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: trocamos de ERP" />
          {desligar.error && <p className="text-sm text-destructive">{mensagem(desligar.error)}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={motivo.trim().length < 5 || desligar.isPending} onClick={() => desligar.mutate()}>
              <Power className="h-4 w-4" /> {desligando.tipo === "conexao" ? "Confirmar: desligar conexão" : "Confirmar: desligar chave"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDesligando(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {pode && !desligando && (
        <div className="flex flex-wrap gap-2">
          {vivas.length < 2 && (
            <Button size="sm" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
              <KeyRound className="h-4 w-4" /> Gerar outra chave
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDesligando({ tipo: "conexao" })}>
            <Power className="h-4 w-4" /> Desligar conexão
          </Button>
        </div>
      )}
      {gerar.error && <p className="text-sm text-destructive">{mensagem(gerar.error)}</p>}
      {pode && vivas.length === 1 && (
        <p className="text-xs text-muted-foreground">
          Pra trocar a chave sem parar o sistema: gere outra, troque lá, e só então desligue a antiga.
        </p>
      )}
      <AvisosDaConexao integ={integ} pode={pode} />
    </Card>
  );
}

type Avisos = { disponivel: boolean; aviso: AvisoResumo | null; entregas: EntregaAvisoResumo[] };

const SITUACAO_ENTREGA: Record<EntregaAvisoResumo["status"], string> = {
  PENDENTE: "Tentando",
  ENTREGUE: "Entregue",
  FALHOU: "Não entregou",
  DESCARTADA: "Não enviado",
};

/**
 * Avisos automáticos: o Movatruck chama o sistema de vocês quando uma viagem
 * muda. O aviso diz QUAL viagem mudou; o sistema busca os dados com a chave.
 */
function AvisosDaConexao({ integ, pode }: { integ: IntegracaoResumo; pode: boolean }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const chave = [PATH, integ.id, "avisos"];
  const avisos = useQuery({
    queryKey: chave,
    enabled: !!token,
    queryFn: () => fetchApi<Avisos>(`${PATH}/${integ.id}/avisos`, { token }),
    refetchInterval: 15_000,
  });
  const recarregar = () => void qc.invalidateQueries({ queryKey: chave });
  const [editando, setEditando] = useState(false);
  const [url, setUrl] = useState("");
  const [eventos, setEventos] = useState<string[]>([]);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [desligando, setDesligando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi<{ segredo: string | null }>(`${PATH}/${integ.id}/avisos`, { method: "PUT", token, body: JSON.stringify({ url, eventos }) }),
    onSuccess: (r) => {
      setEditando(false);
      if (r.segredo) setSegredo(r.segredo);
      recarregar();
    },
  });
  const testar = useMutation({
    mutationFn: () => fetchApi<{ ok: boolean; status: number | null; erro: string | null }>(`${PATH}/${integ.id}/avisos/teste`, { method: "POST", token }),
    onSettled: recarregar,
  });
  const desligar = useMutation({
    mutationFn: () => fetchApi(`${PATH}/${integ.id}/avisos/desligar`, { method: "POST", token, body: JSON.stringify({ motivo }) }),
    onSuccess: () => {
      setDesligando(false);
      setMotivo("");
      recarregar();
    },
  });
  const religar = useMutation({
    mutationFn: () => fetchApi(`${PATH}/${integ.id}/avisos/religar`, { method: "POST", token }),
    onSuccess: recarregar,
  });
  const reentregar = useMutation({
    mutationFn: (id: string) => fetchApi(`${PATH}/${integ.id}/avisos/entregas/${id}/reentregar`, { method: "POST", token }),
    onSuccess: recarregar,
  });

  const d = avisos.data;
  if (!d) return null;
  const a = d.aviso;
  const podeLer = integ.escopos.includes("viagens:ler");

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4" />
        <p className="text-sm font-medium">Avisos automáticos</p>
        {a && (
          <Badge className={a.ativo ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}>
            {a.ativo ? "Ligados" : "Desligados"}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        O Movatruck chama o sistema de vocês quando uma viagem muda — e o sistema busca os dados com a chave. Se o sistema de vocês
        ficar fora do ar, tentamos de novo por até 3 dias.
      </p>

      {!d.disponivel && <p className="text-sm text-muted-foreground">Os avisos ainda não foram ativados no servidor. Fale com a Movatruck.</p>}
      {d.disponivel && !podeLer && (
        <p className="text-sm text-muted-foreground">Pra receber avisos, a conexão precisa poder ver viagens (“Vê viagens”).</p>
      )}

      {segredo && (
        <div className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-sm font-medium">Copie o segredo de assinatura agora — ele não aparece de novo</p>
          <p className="text-xs">Com ele, o sistema de vocês confere que o aviso veio mesmo do Movatruck (padrão Standard Webhooks).</p>
          <div className="flex flex-wrap gap-2">
            <Input readOnly value={segredo} className="max-w-xl font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(segredo)}>
              <Copy className="h-4 w-4" /> Copiar
            </Button>
            <Button variant="success" size="sm" onClick={() => setSegredo(null)}>
              <Check className="h-4 w-4" /> Já guardei
            </Button>
          </div>
        </div>
      )}

      {a && !editando && (
        <div className="space-y-1 text-sm">
          <p className="break-all font-mono text-xs">{a.url}</p>
          <p className="text-xs text-muted-foreground">
            {a.eventos.map((e) => EVENTOS_INTEGRACAO.find((x) => x.chave === e)?.titulo ?? e).join(" · ")}
          </p>
          {!a.ativo && a.motivoDesligamento && <p className="text-xs text-destructive">Desligados: {a.motivoDesligamento}</p>}
          {a.ativo && a.falhasSeguidas > 0 && (
            <p className="text-xs text-amber-700">{a.falhasSeguidas} tentativa(s) seguida(s) sem conseguir entregar.</p>
          )}
        </div>
      )}

      {editando && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor={`url-${integ.id}`}>Endereço do sistema de vocês</Label>
            <Input id={`url-${integ.id}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://erp.suaempresa.com.br/movatruck/avisos" />
          </div>
          <div className="space-y-2">
            <Label>Quais avisos mandar</Label>
            {EVENTOS_INTEGRACAO.map((e) => (
              <label key={e.chave} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={eventos.includes(e.chave)}
                  onChange={(ev) => setEventos((m) => (ev.target.checked ? [...m, e.chave] : m.filter((x) => x !== e.chave)))}
                />
                <span>
                  <span className="block font-medium">{e.titulo}</span>
                  <span className="block text-xs text-muted-foreground">{e.descricao}</span>
                </span>
              </label>
            ))}
          </div>
          {salvar.error && <p className="text-sm text-destructive">{mensagem(salvar.error)}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="success" disabled={!url.startsWith("https://") || eventos.length === 0 || salvar.isPending} onClick={() => salvar.mutate()}>
              <Check className="h-4 w-4" /> {a ? "Salvar avisos" : "Ligar avisos"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {desligando && (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3">
          <Label htmlFor={`motivo-aviso-${integ.id}`}>Por que desligar os avisos? O sistema de vocês ainda pode buscar o que mudou pela chave.</Label>
          <Input id={`motivo-aviso-${integ.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: sistema em manutenção" />
          {desligar.error && <p className="text-sm text-destructive">{mensagem(desligar.error)}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={motivo.trim().length < 5 || desligar.isPending} onClick={() => desligar.mutate()}>
              <Power className="h-4 w-4" /> Confirmar: desligar avisos
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDesligando(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {pode && d.disponivel && podeLer && !editando && !desligando && (
        <div className="flex flex-wrap gap-2">
          {!a && (
            <Button size="sm" onClick={() => { setUrl(""); setEventos(EVENTOS_INTEGRACAO.map((e) => e.chave)); setEditando(true); }}>
              <Bell className="h-4 w-4" /> Ligar avisos automáticos
            </Button>
          )}
          {a && (
            <>
              <Button size="sm" disabled={testar.isPending} onClick={() => testar.mutate()}>
                <Send className="h-4 w-4" /> Enviar teste
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setUrl(a.url); setEventos(a.eventos); setEditando(true); }}>
                Alterar
              </Button>
              {a.ativo ? (
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDesligando(true)}>
                  <Power className="h-4 w-4" /> Desligar avisos
                </Button>
              ) : (
                <Button size="sm" variant="success" disabled={religar.isPending} onClick={() => religar.mutate()}>
                  <Power className="h-4 w-4" /> Religar avisos
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {testar.data && (
        <p className={`text-sm ${testar.data.ok ? "text-emerald-700" : "text-destructive"}`}>
          {testar.data.ok ? `Teste entregue (HTTP ${testar.data.status}).` : `O teste não chegou: ${testar.data.erro}`}
        </p>
      )}
      {testar.error && <p className="text-sm text-destructive">{mensagem(testar.error)}</p>}

      {d.entregas.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Últimas entregas ({d.entregas.length})</summary>
          <div className="mt-2 space-y-1">
            {d.entregas.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                <span className="font-mono">{e.tipo}</span>
                <span className="text-muted-foreground">{quando(e.criadoEm)}</span>
                <span className={e.status === "ENTREGUE" ? "text-emerald-700" : e.status === "PENDENTE" ? "text-amber-700" : "text-destructive"}>
                  {SITUACAO_ENTREGA[e.status]}
                  {e.ultimoStatusHttp ? ` · HTTP ${e.ultimoStatusHttp}` : ""}
                  {e.tentativas > 1 ? ` · ${e.tentativas} tentativas` : ""}
                  {e.status === "PENDENTE" && e.proximaTentativaEm ? ` · próxima ${quando(e.proximaTentativaEm)}` : ""}
                </span>
                {e.ultimoErro && e.status !== "ENTREGUE" && <span className="w-full text-muted-foreground">{e.ultimoErro}</span>}
                {pode && (e.status === "FALHOU" || e.status === "DESCARTADA") && e.tipo !== "teste" && (
                  <Button size="sm" variant="outline" disabled={reentregar.isPending} onClick={() => reentregar.mutate(e.id)}>
                    <RotateCcw className="h-3 w-3" /> Mandar de novo
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
