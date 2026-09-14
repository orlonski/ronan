"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  custoDeReceber,
  ROTULO_CICLO,
  ROTULO_FORMA_COBRANCA,
  ROTULO_STATUS_ASSINATURA,
  ROTULO_STATUS_COBRANCA,
  type CicloAssinatura,
  type FormaCobranca,
  type StatusAssinatura,
  type StatusCobranca,
} from "@ronan/shared-types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

const PATH = "/admin/assinaturas";

type Assinatura = {
  id: string;
  contaId: string;
  status: StatusAssinatura;
  forma: FormaCobranca;
  ciclo: string;
  valorCentavos: number;
  diaVencimento: number;
  nomeResponsavel: string;
  telefoneCobranca: string;
  proximoVencimento: string | null;
  qrCodePayload: string | null;
  taxaPorCobrancaCentavos: number;
  conta: { id: string; nome: string; slug: string; ativa: boolean; somenteLeitura: boolean };
  emAberto: { quantidade: number; totalCentavos: number; diasDeAtraso: number | null };
};

type Cobranca = {
  id: string;
  competencia: string;
  vencimento: string;
  status: StatusCobranca;
  valorCentavos: number;
  pagoEm: string | null;
  linkPagamento: string | null;
  /** Foi o Pix que o cliente pagou pra autorizar a recorrência. */
  pagamentoDeAtivacao: boolean;
};

type Sugestao = {
  conta: { id: string; nome: string; cnpj: string | null; razaoSocial: string | null };
  veiculos: number;
  faixa: { valorCentavos: number; rotulo: string | null } | null;
  valorSugeridoCentavos: number | null;
};

type ContaResumo = { id: string; nome: string };

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function paraCentavos(texto: string): number {
  const limpo = texto.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  return Math.round((Number(limpo) || 0) * 100);
}

/** "2026-10-10" (coluna Date, que chega em meia-noite UTC) → "10/10/2026". */
function dataBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** A cor do status, no semáforo do padrão de botões. */
const COR_STATUS: Record<StatusAssinatura, string> = {
  RASCUNHO: "bg-muted text-muted-foreground",
  AGUARDANDO: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ATIVA: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  INADIMPLENTE: "bg-destructive/10 text-destructive",
  CANCELADA: "bg-muted text-muted-foreground",
};

/**
 * As mensalidades que a Movatruck cobra das empresas.
 *
 * Mora na tela da plataforma pelo mesmo motivo da tabela de preço e dos
 * módulos: o cliente não decide o próprio contrato. E mostra a TAXA de cada
 * forma na hora de escolher, porque é o número que decide a conversa — em cima
 * de R$ 1.890, o cartão come R$ 57 por mês contra R$ 1,99 do Pix.
 *
 * O que esta tela NÃO faz: cortar acesso. Cancelar uma assinatura para de
 * cobrar; tirar a empresa do ar é decisão humana, na lista de empresas logo
 * abaixo.
 */
export function Mensalidades({ contas }: { contas: ContaResumo[] }) {
  const token = useAuthToken();
  const [aberto, setAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [detalhe, setDetalhe] = useState<Assinatura | null>(null);
  const [rodandoRegua, setRodandoRegua] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Assinatura[]>(PATH, { token }),
  });

  const assinaturas = data ?? [];
  const atrasadas = assinaturas.filter((a) => a.status === "INADIMPLENTE");
  // Quem está em atraso entra na conta: o contrato existe, o dinheiro é
  // esperado, e tirar da soma faria a receita recorrente cair sozinha no dia
  // em que alguém atrasa — que é justamente quando o número precisa ser visto.
  const cobrando = assinaturas.filter(
    (a) => a.status === "ATIVA" || a.status === "INADIMPLENTE",
  );
  const recorrenteMensal = cobrando.reduce(
    (s, a) => s + (a.ciclo === "ANUAL" ? Math.round(a.valorCentavos / 12) : a.valorCentavos),
    0,
  );

  async function rodarRegua() {
    setRodandoRegua(true);
    try {
      const r = await fetchApi<{
        vencidas: number;
        enviados: string[];
        naoEnviados: string[];
        semAcao: number;
        erro?: string;
      }>(`${PATH}/regua/rodar`, { method: "POST", token });

      if (r.erro) {
        toast.error("A régua falhou", { description: r.erro });
      } else if (r.enviados.length === 0 && r.naoEnviados.length === 0) {
        // Silêncio é resultado, não falha: ninguém estava na janela de aviso.
        toast.success("Nada a avisar hoje", {
          description: `${r.semAcao} cobrança(s) em aberto conferida(s)${r.vencidas > 0 ? ` · ${r.vencidas} passou(ram) a vencida(s)` : ""}.`,
        });
      } else {
        toast.success(`${r.enviados.length} aviso(s) enviado(s)`, {
          description: [...r.enviados, ...r.naoEnviados.map((n) => `não saiu — ${n}`)].join(" · "),
        });
      }
      void refetch();
    } catch (e) {
      toast.error("Não consegui rodar a régua", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRodandoRegua(false);
    }
  }

  // Empresas que ainda não têm assinatura: é o que a tela precisa oferecer,
  // e listar as que já têm só daria erro de "já tem uma em andamento".
  const semAssinatura = contas.filter((c) => !assinaturas.some((a) => a.contaId === c.id));

  return (
    <Card className="p-4">
      <button
        type="button"
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setAberto((v) => !v)}
      >
        <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Mensalidades</p>
          <p className="text-sm text-muted-foreground">
            {assinaturas.length === 0
              ? "Nenhuma assinatura ainda"
              : `${cobrando.length} assinatura(s) · ${reais(recorrenteMensal)}/mês`}
            {atrasadas.length > 0 && (
              <span className="text-destructive"> · {atrasadas.length} em atraso</span>
            )}
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{aberto ? "Fechar" : "Abrir"}</span>
      </button>

      {aberto && (
        <div className="mt-4 space-y-3 border-t pt-4">
          {assinaturas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa tem assinatura. Crie a primeira — quem já paga no Pix na mão entra
              aqui com a cobrança do mês em aberto e a baixa manual.
            </p>
          )}

          {assinaturas.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.conta.nome}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${COR_STATUS[a.status]}`}>
                    {ROTULO_STATUS_ASSINATURA[a.status]}
                  </span>
                  {a.emAberto.quantidade > 0 && (
                    <span className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {reais(a.emAberto.totalCentavos)} em aberto
                      {a.emAberto.diasDeAtraso !== null && a.emAberto.diasDeAtraso > 0 && (
                        <> · {a.emAberto.diasDeAtraso} dia(s)</>
                      )}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reais(a.valorCentavos)} {ROTULO_CICLO[(a.ciclo as CicloAssinatura) ?? "MENSAL"]?.toLowerCase()} ·{" "}
                  {ROTULO_FORMA_COBRANCA[a.forma]} · vence dia {a.diaVencimento} · taxa{" "}
                  {reais(a.taxaPorCobrancaCentavos)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setDetalhe(a)}>
                Cobranças
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setCriando(true)}
              disabled={semAssinatura.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova assinatura
            </Button>

            {/* A régua roda sozinha às 9h. O botão existe pro dia em que o
                WhatsApp estava fora do ar: aviso que falha não grava data, e
                sem isto só seria tentado de novo amanhã. Apertar duas vezes não
                manda duas mensagens — quem já foi avisado hoje fica de fora. */}
            {assinaturas.length > 0 && (
              <Button
                variant="outline"
                disabled={rodandoRegua}
                onClick={() => void rodarRegua()}
              >
                {rodandoRegua ? "Rodando…" : "Rodar avisos agora"}
              </Button>
            )}
          </div>
          {semAssinatura.length === 0 && contas.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Todas as empresas já têm assinatura.
            </p>
          )}
        </div>
      )}

      {criando && (
        <DialogNovaAssinatura
          contas={semAssinatura}
          onFechar={() => setCriando(false)}
          onCriada={() => {
            setCriando(false);
            void refetch();
          }}
        />
      )}

      {detalhe && (
        <DialogCobrancas
          assinatura={detalhe}
          onFechar={() => setDetalhe(null)}
          onMudou={() => void refetch()}
        />
      )}
    </Card>
  );
}

/**
 * Criar assinatura.
 *
 * A tela busca a sugestão de preço assim que a empresa é escolhida, e mostra a
 * taxa de cada forma junto do nome dela. Sem isso, "Cartão" e "Pix Automático"
 * parecem duas opções equivalentes — e uma custa 28x a outra.
 */
function DialogNovaAssinatura({
  contas,
  onFechar,
  onCriada,
}: {
  contas: ContaResumo[];
  onFechar: () => void;
  onCriada: () => void;
}) {
  const token = useAuthToken();
  const [contaId, setContaId] = useState("");
  const [forma, setForma] = useState<FormaCobranca>("PIX_AUTOMATICO");
  const [ciclo, setCiclo] = useState<CicloAssinatura>("MENSAL");
  const [valor, setValor] = useState("");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [primeiroVencimento, setPrimeiroVencimento] = useState("");
  const [avisarCliente, setAvisarCliente] = useState(true);
  const [nomeResponsavel, setNome] = useState("");
  const [emailCobranca, setEmail] = useState("");
  const [telefoneCobranca, setTelefone] = useState("");
  const [documento, setDocumento] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: sugestao } = useQuery({
    queryKey: [PATH, "sugestao", contaId],
    enabled: !!token && !!contaId,
    queryFn: () => fetchApi<Sugestao>(`${PATH}/sugestao/${contaId}`, { token }),
  });

  // O preço e o CNPJ chegam preenchidos, e continuam editáveis: sugestão que
  // não se deixa mudar vira número contornado por fora do sistema.
  useEffect(() => {
    if (!sugestao) return;
    if (sugestao.valorSugeridoCentavos != null) {
      setValor((sugestao.valorSugeridoCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    }
    if (sugestao.conta.cnpj) setDocumento(sugestao.conta.cnpj);
  }, [sugestao]);

  // A taxa sai do valor DIGITADO, não da sugestão do servidor: ela precisa
  // acompanhar o que a pessoa está combinando, e sumir justamente quando o
  // valor é digitado à mão (frota fora da tabela) escondia o número mais
  // importante da tela.
  const valorCentavos = paraCentavos(valor);
  const taxa = valorCentavos > 0 ? custoDeReceber(forma, valorCentavos) : null;

  async function salvar() {
    setSalvando(true);
    try {
      await fetchApi(PATH, {
        method: "POST",
        token,
        body: JSON.stringify({
          contaId,
          forma,
          ciclo,
          valorCentavos: paraCentavos(valor),
          diaVencimento: Number(diaVencimento) || 10,
          primeiroVencimento: primeiroVencimento || undefined,
          avisarCliente,
          nomeResponsavel,
          emailCobranca,
          telefoneCobranca,
          documento,
        }),
      });
      toast.success("Assinatura criada.", {
        description:
          forma === "PIX_AUTOMATICO"
            ? "Mande o QR Code do primeiro pagamento pro cliente — é ele que autoriza as próximas."
            : "O cliente recebe a cobrança do gateway no vencimento.",
      });
      onCriada();
    } catch (e) {
      toast.error("Não consegui criar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova assinatura</DialogTitle>
          <DialogDescription>
            O valor vem sugerido da tabela de preço pelo tamanho da frota, e pode ser mudado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Empresa</Label>
            <Select value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">Escolha a empresa…</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
            {sugestao && (
              <p className="mt-1 text-xs text-muted-foreground">
                {sugestao.veiculos} caminhão(ões) ativo(s)
                {sugestao.faixa?.rotulo ? ` · faixa "${sugestao.faixa.rotulo}"` : ""}
                {sugestao.valorSugeridoCentavos == null &&
                  " · a tabela de preço não cobre essa frota — digite o valor combinado"}
              </p>
            )}
          </div>

          <div>
            <Label>Como ele paga</Label>
            <Select value={forma} onChange={(e) => setForma(e.target.value as FormaCobranca)}>
              {(["PIX_AUTOMATICO", "CARTAO", "PIX", "BOLETO"] as FormaCobranca[]).map((f) => {
                const t = valorCentavos > 0 ? custoDeReceber(f, valorCentavos) : null;
                return (
                  <option key={f} value={f}>
                    {ROTULO_FORMA_COBRANCA[f]}
                    {t != null ? ` — taxa ${reais(t)}` : ""}
                  </option>
                );
              })}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {forma === "PIX_AUTOMATICO" &&
                "Ele autoriza uma vez no app do banco e as próximas caem sozinhas. É a forma mais barata de receber."}
              {forma === "CARTAO" &&
                "Cobra só a mensalidade a cada mês — não trava o limite do ano como um parcelamento."}
              {forma === "PIX" && "QR Code novo todo mês, que alguém precisa pagar na mão."}
              {forma === "BOLETO" && "Mesma taxa do Pix, pra financeiro que só paga assim."}
              {taxa != null && ` Custa ${reais(taxa)} por cobrança.`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Label>Valor por mês</Label>
              <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div className="w-28">
              <Label>Vence dia</Label>
              <Input
                inputMode="numeric"
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
              />
            </div>
            <div className="w-32">
              <Label>Ciclo</Label>
              <Select value={ciclo} onChange={(e) => setCiclo(e.target.value as CicloAssinatura)}>
                <option value="MENSAL">Mensal</option>
                <option value="ANUAL">Anual</option>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O vencimento vai do dia 1 ao 28 — fevereiro não tem dia 30.
          </p>

          <div>
            <Label>Primeiro vencimento (opcional)</Label>
            <Input
              type="date"
              value={primeiroVencimento}
              onChange={(e) => setPrimeiroVencimento(e.target.value)}
            />
            {/* Sem isto, a primeira cobrança caía sempre no mês seguinte, sem
                escolha. Quem fecha dia 20 e quer começar já, ou combinou
                começar em janeiro, não tinha como — e a conversa acabava
                virando uma cobrança manual por fora do sistema. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Vazio = dia {diaVencimento || "10"} do mês que vem. Preencha pra combinar outra data
              de início.
            </p>
          </div>

          <div className="border-t pt-3">
            <p className="text-sm font-medium">Quem recebe a cobrança</p>
            <p className="mb-2 text-xs text-muted-foreground">
              O financeiro da empresa, que raramente é quem opera o sistema.
            </p>
            <div className="space-y-2">
              <div>
                <Label>Nome</Label>
                <Input value={nomeResponsavel} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={emailCobranca}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label>WhatsApp (com DDD)</Label>
                <Input
                  inputMode="numeric"
                  placeholder="41999998888"
                  value={telefoneCobranca}
                  onChange={(e) => setTelefone(e.target.value)}
                />
              </div>
              {/* Ligado por padrão: o normal é o cliente precisar do código pra
                  autorizar, e esperar alguém lembrar de mandar é como uma
                  assinatura fica parada. Dá pra desligar porque existe o caso
                  de ligar pro cliente antes — e sistema que não deixa escolher
                  isso vira sistema contornado por fora. */}
              <label className="flex items-start gap-2 rounded border p-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={avisarCliente}
                  onChange={(e) => setAvisarCliente(e.target.checked)}
                />
                <span>
                  Avisar o cliente no WhatsApp agora
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Manda pro financeiro o que ele precisa pra autorizar a cobrança. Sem isso, ele
                    só é avisado 3 dias antes do vencimento.
                  </span>
                </span>
              </label>

              <div>
                <Label>CPF ou CNPJ de quem paga</Label>
                <Input
                  inputMode="numeric"
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Sem isso não sai nota fiscal.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando || !contaId}>
            Criar assinatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O histórico de cobranças de uma empresa, com baixa manual e cancelamento. */
function DialogCobrancas({
  assinatura,
  onFechar,
  onMudou,
}: {
  assinatura: Assinatura;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const [baixando, setBaixando] = useState<Cobranca | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [avisando, setAvisando] = useState(false);

  async function avisar() {
    setAvisando(true);
    try {
      const r = await fetchApi<{ enviado: boolean; motivo?: string }>(
        `${PATH}/${assinatura.id}/avisar`,
        { method: "POST", token },
      );
      if (r.enviado) {
        toast.success("Mandado no WhatsApp.", {
          description: `${assinatura.nomeResponsavel} recebeu o que precisa pra pagar.`,
        });
      } else {
        // Não some com o erro: quem apertou precisa saber que o cliente NÃO
        // recebeu, senão vai esperar um pagamento que nunca foi pedido.
        toast.error("Não saiu", { description: r.motivo });
      }
    } catch (e) {
      toast.error("Não consegui mandar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setAvisando(false);
    }
  }

  const { data, refetch } = useQuery({
    queryKey: [PATH, assinatura.id],
    enabled: !!token,
    queryFn: () =>
      fetchApi<{ cobrancas: Cobranca[] }>(`${PATH}/${assinatura.id}`, { token }),
  });

  async function cancelar() {
    try {
      await fetchApi(`${PATH}/${assinatura.id}/cancelar`, {
        method: "POST",
        token,
        body: JSON.stringify({ motivo }),
      });
      toast.success("Assinatura cancelada.", {
        description: "A empresa continua no ar — tirar do acesso é outra decisão, na lista abaixo.",
      });
      onMudou();
      onFechar();
    } catch (e) {
      toast.error("Não consegui cancelar", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{assinatura.conta.nome}</DialogTitle>
          <DialogDescription>
            {reais(assinatura.valorCentavos)} · {ROTULO_FORMA_COBRANCA[assinatura.forma]} · próximo
            vencimento {dataBr(assinatura.proximoVencimento)}
          </DialogDescription>
        </DialogHeader>

        {/* Cartão aguardando: o cliente precisa informar o cartão na página do
            gateway, e é o link da cobrança que leva até lá. Não existe
            copia-e-cola aqui — dizer que "falta o QR" seria assustar à toa. */}
        {assinatura.status === "AGUARDANDO" && assinatura.forma === "CARTAO" && (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">Esperando o cliente informar o cartão</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mande o link da cobrança abaixo. Assim que o cartão passar, a assinatura fica ativa e
              as próximas são cobradas sozinhas — só a mensalidade por vez, sem travar o limite.
            </p>
          </div>
        )}

        {/* Aguardando autorização e SEM o copia-e-cola: estado que não pode
            passar em silêncio. Ele significa que a assinatura existe no
            gateway mas ninguém consegue pagar o primeiro Pix — e sem o
            primeiro, nunca há recorrência. Aconteceu de verdade em 14/09/2026
            (o payload vinha de um campo que o código não lia), e a tela não
            dizia nada: parecia só "esperando o cliente".

            Só vale pro Pix Automático: cartão não tem copia-e-cola nenhum, e
            este mesmo aviso já apareceu numa assinatura de cartão dizendo que
            faltava um QR que nunca deveria existir. */}
        {assinatura.status === "AGUARDANDO" &&
          assinatura.forma === "PIX_AUTOMATICO" &&
          !assinatura.qrCodePayload && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium">Esta assinatura não tem código de pagamento</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ela está esperando autorização, mas o gateway não devolveu o copia-e-cola do
              primeiro Pix — então o cliente não tem como pagar e a recorrência nunca começa.
              Cancele e crie de novo; se repetir, é problema na integração.
            </p>
          </div>
        )}

        {assinatura.status === "AGUARDANDO" &&
          assinatura.forma === "PIX_AUTOMATICO" &&
          assinatura.qrCodePayload && (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">Esperando a autorização do cliente</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mande este copia-e-cola pro financeiro. Pagar este Pix é o que autoriza as próximas
              parcelas a caírem sozinhas.
            </p>
            <textarea
              readOnly
              className="mt-2 h-20 w-full rounded border bg-background p-2 font-mono text-[11px]"
              value={assinatura.qrCodePayload}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                void navigator.clipboard.writeText(assinatura.qrCodePayload ?? "");
                toast.success("Copiado.");
              }}
            >
              Copiar
            </Button>
          </div>
        )}

        {/* O caminho pro cliente receber o que precisa. Antes disto, mandar a
            cobrança significava achar um link em texto miúdo, copiar na mão e
            colar no WhatsApp — o que não é fluxo, é contorno. */}
        <div className="flex flex-wrap items-center gap-2 rounded border bg-muted/30 p-2">
          <Button variant="outline" size="sm" disabled={avisando} onClick={() => void avisar()}>
            {avisando ? "Mandando…" : "Mandar no WhatsApp"}
          </Button>
          <span className="text-xs text-muted-foreground">
            vai pra {assinatura.nomeResponsavel} ({assinatura.telefoneCobranca})
          </span>
        </div>

        <div className="space-y-2">
          {(data?.cobrancas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma cobrança ainda. Elas aparecem aqui quando o gateway gerar a do mês.
            </p>
          )}
          {(data?.cobrancas ?? []).map((c) => {
            const paga = c.status === "CONFIRMADA" || c.status === "RECEBIDA";
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <div className="text-sm">
                  <span className="font-medium">{dataBr(c.competencia).slice(3)}</span> ·{" "}
                  {reais(c.valorCentavos)} · vence {dataBr(c.vencimento)}
                  <span
                    className={`ml-2 rounded px-2 py-0.5 text-xs ${
                      paga
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : c.status === "VENCIDA"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {ROTULO_STATUS_COBRANCA[c.status]}
                  </span>
                  {/* Diz de onde veio o dinheiro. Sem isto, a primeira
                      mensalidade aparece paga sem link e sem explicação — e a
                      pergunta "de onde saiu isso?" não tem resposta na tela. */}
                  {c.pagamentoDeAtivacao && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · pago na autorização do Pix
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {c.linkPagamento && !paga && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(c.linkPagamento!);
                        toast.success("Link copiado.", {
                          description: "É esse endereço que o cliente abre pra pagar.",
                        });
                      }}
                    >
                      Copiar link
                    </Button>
                  )}
                  {c.linkPagamento && (
                    <a
                      className="text-xs text-primary underline"
                      href={c.linkPagamento}
                      target="_blank"
                      rel="noreferrer"
                    >
                      abrir
                    </a>
                  )}
                  {!paga && c.status !== "CANCELADA" && (
                    <Button variant="outline" size="sm" onClick={() => setBaixando(c)}>
                      Dar baixa
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {baixando && (
          <BaixaManual
            cobranca={baixando}
            onFechar={() => setBaixando(null)}
            onPronto={() => {
              setBaixando(null);
              void refetch();
              onMudou();
            }}
          />
        )}

        <div className="border-t pt-3">
          {!cancelando ? (
            <Button variant="outline" className="text-destructive" onClick={() => setCancelando(true)}>
              Cancelar assinatura
            </Button>
          ) : (
            // Confirmação inline, não um segundo Modal por cima: é o padrão que
            // o app já usa, e diz o que acontece de verdade em vez de "tem
            // certeza?".
            <div className="space-y-2 rounded border border-destructive/40 p-3">
              <p className="text-sm font-medium">Parar de cobrar {assinatura.conta.nome}?</p>
              <p className="text-xs text-muted-foreground">
                As cobranças em aberto são canceladas junto. A empresa continua no ar e com os
                dados dela — tirar do acesso é outra decisão, na lista de empresas.
              </p>
              <Input
                placeholder="Por que está cancelando?"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCancelando(false)}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={motivo.trim().length < 5}
                  onClick={() => void cancelar()}
                >
                  Cancelar assinatura
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Baixa manual.
 *
 * É o caminho de quem já pagava no Pix antes de existir assinatura: o dinheiro
 * entrou na conta, o gateway não sabe, e sem isso a cobrança ficaria vencida
 * pra sempre — cobrando quem já pagou.
 */
function BaixaManual({
  cobranca,
  onFechar,
  onPronto,
}: {
  cobranca: Cobranca;
  onFechar: () => void;
  onPronto: () => void;
}) {
  const token = useAuthToken();
  const [pagoEm, setPagoEm] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await fetchApi(`${PATH}/cobrancas/${cobranca.id}/baixa`, {
        method: "POST",
        token,
        body: JSON.stringify({ pagoEm, motivo }),
      });
      toast.success("Cobrança dada como paga.");
      onPronto();
    } catch (e) {
      toast.error("Não consegui dar baixa", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2 rounded border bg-muted/30 p-3">
      <p className="text-sm font-medium">
        Dar baixa em {reais(cobranca.valorCentavos)} ({dataBr(cobranca.competencia).slice(3)})
      </p>
      <div className="flex flex-wrap gap-2">
        <div className="w-40">
          <Label className="text-xs">Quando entrou</Label>
          <Input type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
        </div>
        <div className="min-w-0 flex-1">
          <Label className="text-xs">Como entrou</Label>
          <Input
            placeholder="Pix na conta do Itaú, TED…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onFechar}>
          Voltar
        </Button>
        <Button
          size="sm"
          disabled={salvando || motivo.trim().length < 5}
          onClick={() => void salvar()}
        >
          Confirmar pagamento
        </Button>
      </div>
    </div>
  );
}
