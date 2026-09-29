"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import type { AcessosDoMotorista, AjustarAcessosMotoristaInput, ItemAcessoMotorista } from "@ronan/shared-types";
import { AppPreview } from "@/components/app-preview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import {
  ConferenciaMotivoInline,
  useConferenciaMotorista,
  type ConferenciaDoMotorista,
} from "./conferencia-interruptor";

/**
 * O ACESSO AO APP DE UM MOTORISTA — a ÚNICA forma de mexer nele.
 *
 * Uma grade de interruptores: tocou, salvou (sem botão Salvar, sem janela, sem
 * pedir motivo). Aparece igual na ficha e na edição, e sem poder tocar pra
 * quem só pode ver.
 *
 * Por baixo a empresa pode estar no espelho da ficha ou nas regras; a API
 * escolhe o caminho e devolve o estado JÁ do jeito do interruptor. Aqui não
 * existe perfil, regra, grupo nem exceção — no máximo uma linha discreta dizendo
 * que ele tem ajustes só dele, com o caminho pra ver.
 *
 * "Ligado" quer dizer que o app dele mostra o acesso: quem decide isso é a API.
 * A tela só pinta o toque na hora (otimista) e desfaz com aviso se falhar.
 */
export function AcessosDoApp({
  motoristaId,
  conferencia,
}: {
  motoristaId: string;
  /** O que o cadastro já traz sobre a conferência (ficha e edição têm o mesmo). */
  conferencia: ConferenciaDoMotorista;
}) {
  const { temPermissao, temModulo, plataforma } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();
  const caminho = `/admin/acesso-app/motoristas/${motoristaId}/itens`;
  const dados = useApiQuery<AcessosDoMotorista>(caminho);
  const conf = useConferenciaMotorista(motoristaId, conferencia);

  // Toque pintado na hora, até a API responder. chave → estado pedido.
  const [pendentes, setPendentes] = useState<Record<string, boolean>>({});
  // Uma mudança por vez: duas chamadas juntas recalculam a empresa uma por cima da outra.
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const [confirmandoDesligar, setConfirmandoDesligar] = useState(false);
  const [vendoCelular, setVendoCelular] = useState(false);
  const [enviandoResumo, setEnviandoResumo] = useState(false);

  const d = dados.data;
  if (dados.isLoading) return <p className="text-sm text-muted-foreground">Carregando acessos…</p>;
  if (!d) return <p className="text-sm text-muted-foreground">Não deu pra carregar os acessos.</p>;

  const mostrarConferencia =
    (temPermissao("conferencia-diaria.decidir") || temPermissao("conferencia-diaria.ver")) &&
    temModulo("conferencia-diaria.decidir");
  const podeConferencia = temPermissao("conferencia-diaria.decidir") && temModulo("conferencia-diaria.decidir");
  const podeAlterar = temPermissao("motoristas.editar") && (d.fonte === "COLUNAS" || temPermissao("perfis-acesso.aplicar"));

  const ligadoDe = (i: ItemAcessoMotorista) => pendentes[i.chave] ?? i.ligado;
  const total = d.itens.length + (mostrarConferencia ? 1 : 0);
  const ligados = d.itens.filter(ligadoDe).length + (mostrarConferencia && conf.recebe ? 1 : 0);

  function enviar(mudancas: AjustarAcessosMotoristaInput["itens"]): Promise<boolean> {
    setPendentes((p) => ({ ...p, ...Object.fromEntries(mudancas.map((m) => [m.chave, m.ligado])) }));
    const tarefa = fila.current.then(async () => {
      try {
        const fresco = await fetchApi<AcessosDoMotorista>(caminho, {
          method: "PATCH",
          token,
          body: JSON.stringify({ itens: mudancas }),
        });
        qc.setQueryData([caminho, "get"], fresco);
        return true;
      } catch (e) {
        toast.error(
          mudancas.length === 1
            ? "Não deu pra salvar. Ficou como estava."
            : "Não deu pra salvar as mudanças. Ficou como estava.",
          { description: e instanceof Error ? e.message : undefined },
        );
        return false;
      } finally {
        setPendentes((p) => {
          const resto = { ...p };
          for (const m of mudancas) delete resto[m.chave];
          return resto;
        });
      }
    });
    fila.current = tarefa;
    return tarefa;
  }

  async function alternar(i: ItemAcessoMotorista) {
    const novo = !ligadoDe(i);
    const ok = await enviar([{ chave: i.chave, ligado: novo }]);
    if (ok) toast.success(`${i.label}: ${novo ? "ligado" : "desligado"}`, { duration: 1800 });
  }

  async function emLote(novo: boolean) {
    setConfirmandoDesligar(false);
    const mudancas = d!.itens
      .filter((i) => ligadoDe(i) !== novo && i.precisaDe.length === 0)
      .map((i) => ({ chave: i.chave, ligado: novo }));
    const confMuda = mostrarConferencia && podeConferencia && conf.recebe !== novo;
    if (mudancas.length === 0 && !confMuda) {
      toast.info(novo ? "Já estava tudo ligado." : "Já estava tudo desligado.", { duration: 1800 });
      return;
    }
    let ok = true;
    if (mudancas.length > 0) ok = await enviar(mudancas);
    if (ok && confMuda) await conf.definir(novo);
    if (ok) toast.success(novo ? "Tudo ligado" : "Tudo desligado", { duration: 1800 });
  }

  async function enviarResumo() {
    setEnviandoResumo(true);
    try {
      const r = await fetchApi<{ enviado: boolean; motivo?: string }>(`/admin/motoristas/${motoristaId}/enviar-resumo`, {
        method: "POST",
        token,
      });
      if (r.enviado) toast.success("Resumo enviado", { description: `WhatsApp de ${d!.nome}.` });
      else toast.error("Não enviado", { description: r.motivo ?? "Motivo desconhecido." });
    } catch (e) {
      toast.error("Falha ao enviar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setEnviandoResumo(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="acessos-do-app">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" data-testid="acessos-contagem">
          <strong className="text-foreground">{ligados}</strong> de {total} ligados
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {podeAlterar &&
            (confirmandoDesligar ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar desligar tudo">
                <span className="text-sm">Desligar tudo dele?</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmandoDesligar(false)}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => void emLote(false)}>
                  Desligar tudo
                </Button>
              </div>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => void emLote(true)}>
                  Ligar todos
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmandoDesligar(true)}>
                  Desligar todos
                </Button>
              </>
            ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setVendoCelular(true)}>
            <Smartphone className="mr-2 h-4 w-4" />
            Ver o celular dele
          </Button>
        </div>
      </div>

      {!d.aprovado && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          O cadastro dele ainda não foi aprovado. Estes acessos passam a valer quando for.
        </p>
      )}
      {!podeAlterar && (
        <p className="text-xs text-muted-foreground">Você pode ver os acessos, mas não mudar.</p>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {d.itens.map((i) => (
          <Interruptor
            key={i.chave}
            testid={`acesso-${i.chave}`}
            titulo={i.label}
            descricao={i.efeito}
            nota={i.precisaDe.length > 0 ? `Precisa estar ligado: ${i.precisaDe.join(" ou ")}.` : undefined}
            etiqueta={i.custa && plataforma ? "tem custo" : undefined}
            ligado={ligadoDe(i)}
            salvando={i.chave in pendentes}
            desabilitado={!podeAlterar || i.precisaDe.length > 0}
            onAlternar={() => void alternar(i)}
          />
        ))}
        {mostrarConferencia && (
          <div className="space-y-1">
            <Interruptor
              testid="acesso-conferencia"
              titulo="Conferência de viagens (pergunta por WhatsApp)"
              descricao="Quando a regra da empresa indica que ele pode ter esquecido uma viagem, o sistema pergunta pelo WhatsApp. Vale só nesta empresa."
              ligado={conf.recebe}
              salvando={conf.ocupado}
              desabilitado={!podeConferencia || conf.pedindoMotivo}
              onAlternar={() => void conf.definir(!conf.recebe)}
            />
            {conf.frase && (
              <p className="px-1 text-xs text-amber-700" data-testid="conferencia-estado">
                {conf.frase}
                {conf.motivoDoPainel ? ` Motivo: ${conf.motivoDoPainel}` : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {conf.pedindoMotivo && (
        <ConferenciaMotivoInline
          ocupado={conf.ocupado}
          onReligar={conf.religarComMotivo}
          onCancelar={conf.cancelarMotivo}
        />
      )}

      {podeAlterar && d.itens.some((i) => i.chave === "resumoDiario") && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void enviarResumo()}
            disabled={!d.temTelefone || enviandoResumo}
            title={d.temTelefone ? "Manda o resumo do dia dele agora, no WhatsApp" : "Motorista sem telefone"}
          >
            <Send className="mr-2 h-3.5 w-3.5" />
            {enviandoResumo ? "Enviando…" : "Enviar resumo agora"}
          </Button>
        </div>
      )}

      {d.fonte === "REGRAS" && d.ajustes > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="acessos-ajustes">
          Este motorista tem ajustes próprios.{" "}
          {temPermissao("perfis-acesso.ver") && (
            <Link href={"/acesso-app" as Route} className="underline">
              Ver detalhes
            </Link>
          )}
        </p>
      )}

      {vendoCelular && (
        <Dialog open onOpenChange={(o) => !o && setVendoCelular(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>O celular de {d.nome}</DialogTitle>
            </DialogHeader>
            <AppPreview capacidades={d.capacidadesNoApp} nome={d.nome} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Um acesso: o cartão inteiro é o interruptor (alvo grande, um toque). Ligado é
 * verde com a palavra "Ligado"; desligado é cinza com "Desligado" — a cor não
 * fica sozinha.
 */
function Interruptor({
  testid,
  titulo,
  descricao,
  nota,
  etiqueta,
  ligado,
  salvando,
  desabilitado,
  onAlternar,
}: {
  testid: string;
  titulo: string;
  descricao: string;
  nota?: string;
  etiqueta?: string;
  ligado: boolean;
  salvando: boolean;
  desabilitado: boolean;
  onAlternar: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-busy={salvando}
      disabled={desabilitado}
      onClick={onAlternar}
      data-testid={testid}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ligado ? "border-green-600/60 bg-green-50 dark:bg-green-950/30" : "border-border bg-muted/40",
        desabilitado ? "cursor-default opacity-75" : "cursor-pointer hover:brightness-95",
        salvando && "opacity-70",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">
          {titulo}
          {etiqueta && <span className="ml-2 text-xs font-normal text-muted-foreground">({etiqueta})</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
        {nota && <span className="mt-0.5 block text-xs text-amber-700">{nota}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-center gap-1">
        <span
          aria-hidden
          className={cn("relative inline-flex h-7 w-12 items-center rounded-full transition-colors", ligado ? "bg-green-600" : "bg-gray-300")}
        >
          <span
            className={cn(
              "inline-block h-6 w-6 rounded-full bg-white shadow transition-transform",
              ligado ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </span>
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", ligado ? "text-green-700" : "text-muted-foreground")}>
          {ligado ? "Ligado" : "Desligado"}
        </span>
      </span>
    </button>
  );
}
