"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// Mesma faixa do schema e do CHECK no banco.
import { DENSIDADE_MAX_T_M3, DENSIDADE_MIN_T_M3 } from "@ronan/shared-types";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import { StatusToggle } from "@/components/status-toggle";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";
import { BarraDeAcao } from "@/components/barra-de-acao";

export type Material = {
  id: string;
  nome: string;
  ativo: boolean;
  apelidos: string[];
  exigeTicket: boolean;
  permiteBotaFora: boolean;
  temComprovanteFoto: boolean;
  dispensaConferencia: boolean;
  valorReferenciaTonelada: number | string | null;
  densidadeTonM3: number | string | null;
};

const PATH = "/admin/materiais";

type Props = {
  initial?: Material;
  /** Nome já preenchido — vindo do de/para da conferência do ticket. */
  nomeInicial?: string;
  voltarPara?: string;
};

/** O estado do formulário: o valor é TEXTO enquanto a pessoa digita. */
type MaterialForm = {
  nome: string;
  apelidos: string[];
  exigeTicket: boolean;
  permiteBotaFora: boolean;
  temComprovanteFoto: boolean;
  dispensaConferencia: boolean;
  valorReferenciaTonelada: string;
  densidadeTonM3: string;
};

/** O que vai pra API: número de verdade, ou null quando em branco. */
type MaterialBody = Omit<MaterialForm, "valorReferenciaTonelada" | "densidadeTonM3"> & {
  valorReferenciaTonelada: number | null;
  densidadeTonM3: number | null;
};


export function MaterialForm({ initial, nomeInicial, voltarPara = "/materiais" }: Props) {
  const router = useRouter();
  const create = useCreateResource<MaterialBody, Material>(PATH, PATH);
  const update = useUpdateResource<Partial<MaterialBody>, Material>(PATH, PATH);
  const [form, setForm] = useState<MaterialForm>({
    nome: initial?.nome ?? nomeInicial ?? "",
    apelidos: initial?.apelidos ?? [],
    exigeTicket: initial?.exigeTicket ?? true,
    permiteBotaFora: initial?.permiteBotaFora ?? false,
    temComprovanteFoto: initial?.temComprovanteFoto ?? true,
    dispensaConferencia: initial?.dispensaConferencia ?? false,
    valorReferenciaTonelada:
      initial?.valorReferenciaTonelada == null ? "" : String(initial.valorReferenciaTonelada),
    densidadeTonM3: initial?.densidadeTonM3 == null ? "" : String(Number(initial.densidadeTonM3)),
  });
  const [erroDensidade, setErroDensidade] = useState<string | null>(null);

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Vazio = não informada (null), nunca 0: densidade zero não é "leve", é
    // divisão por zero na conversão.
    const densidade = form.densidadeTonM3.trim() ? Number(form.densidadeTonM3) : null;
    if (
      densidade != null &&
      (!Number.isFinite(densidade) || densidade < DENSIDADE_MIN_T_M3 || densidade > DENSIDADE_MAX_T_M3)
    ) {
      setErroDensidade(
        `A densidade fica entre 0,3 e 3,5 t/m³ (brita ≈ 1,45). Confira se não digitou em kg/m³.`,
      );
      document.getElementById("densidadeTonM3")?.focus();
      return;
    }
    setErroDensidade(null);
    const body = {
      ...form,
      densidadeTonM3: densidade,
      // Vazio é "não informado", e precisa chegar como null. Mandar "" faria o
      // `z.coerce.number()` do schema virar 0 — e zero num campo de valor não
      // é ausência, é a afirmação de que a carga não vale nada.
      valorReferenciaTonelada: form.valorReferenciaTonelada.trim()
        ? Number(form.valorReferenciaTonelada)
        : null,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push(voltarPara as never);
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            required
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Apelidos do motorista</Label>
          <TagInput
            value={form.apelidos}
            onChange={(arr) => setForm({ ...form, apelidos: arr })}
            placeholder='ex: "brita", "pedrisco"'
          />
          <p className="text-xs text-muted-foreground">
            Como o motorista chama no WhatsApp/áudio. O agente IA usa pra
            achar o material quando ele escreve diferente do cadastro.
          </p>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="exigeTicket">Exige ticket na viagem</Label>
            <StatusToggle
              id="exigeTicket"
              active={form.exigeTicket}
              onChange={(next) => setForm({ ...form, exigeTicket: next })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ligado (padrão): o motorista precisa informar o número do ticket. Desligue
            pra materiais que não geram ticket (ex: concreto) — aí o campo some pro
            motorista e a viagem pode ser lançada sem ticket.
          </p>
        </div>
        {/* O valor da MERCADORIA. Mora no material porque é o único lugar onde
            ele é estável: brita tem preço de mercado por tonelada, e a viagem
            não sabe disso. Sem ele, o CT-e é rejeitado (581). */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="valorReferenciaTonelada">Valor da mercadoria (R$ por tonelada)</Label>
          <Input
            id="valorReferenciaTonelada"
            inputMode="decimal"
            value={form.valorReferenciaTonelada}
            onChange={(e) =>
              setForm({ ...form, valorReferenciaTonelada: e.target.value.replace(",", ".") })
            }
            placeholder="ex: 75.00"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Quanto vale a <strong className="font-medium text-foreground">carga</strong>,
            não o frete. O CT-e exige esse valor e o sistema não tem como deduzir —
            a tabela de preços precifica o serviço de transporte, não a mercadoria.
            O valor da carga sai de <em>referência × toneladas</em>; quando a viagem
            trouxer o valor real da NF-e, ele vence esta referência.
          </p>
        </div>
        {/* A ponte entre o que a balança pesa e o que o cliente compra. Fica
            em branco até alguém saber o número de verdade: chutar uma média
            erra o volume de toda viagem desse material. */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="densidadeTonM3">Densidade (t por m³)</Label>
          <Input
            id="densidadeTonM3"
            inputMode="decimal"
            value={form.densidadeTonM3}
            onChange={(e) => {
              setErroDensidade(null);
              setForm({ ...form, densidadeTonM3: e.target.value.replace(",", ".") });
            }}
            placeholder="ex: 1.45"
            autoComplete="off"
            aria-invalid={erroDensidade ? true : undefined}
            className={erroDensidade ? "border-red-500" : undefined}
          />
          {erroDensidade && <p className="text-xs text-red-600">{erroDensidade}</p>}
          <p className="text-xs text-muted-foreground">
            Quantas toneladas cabem em 1 m³ desse material, solto na caçamba. Referências:
            brita 1 ≈ 1,45 · areia ≈ 1,5 · pó de pedra ≈ 1,6 — o certo é o número da
            pedreira ou de uma pesagem sua. Só precisa se você vende{" "}
            <strong className="font-medium text-foreground">por m³</strong>: é ela que
            converte o peso da balança em volume no pedido e no preço por m³. Em branco,
            pedido e preço em m³ desse material ficam parados avisando que falta a
            densidade.
          </p>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="dispensaConferencia">Não precisa de conferência</Label>
            <StatusToggle
              id="dispensaConferencia"
              active={form.dispensaConferencia}
              onChange={(next) => setForm({ ...form, dispensaConferencia: next })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Desligado (padrão): a viagem entra aguardando alguém conferir, como
            sempre. Ligue só para material que não gera documento nenhum (ex:
            concreto) — aí a viagem já{" "}
            <strong className="font-medium text-foreground">
              entra aprovada, sem ninguém olhar
            </strong>
            , e vai direto pro fechamento. Fica registrado na conversa da viagem
            que foi a regra do material que aprovou.
          </p>
          {form.dispensaConferencia && form.temComprovanteFoto && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Atenção: este material está marcado como &ldquo;gera comprovante
              fotografável&rdquo;. Se ele produz papel, alguém deveria conferir — vale
              revisar as duas opções juntas.
            </p>
          )}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="temComprovanteFoto">Gera comprovante fotografável</Label>
            <StatusToggle
              id="temComprovanteFoto"
              active={form.temComprovanteFoto}
              onChange={(next) => setForm({ ...form, temComprovanteFoto: next })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ligado (padrão): esse material gera algum papel que o motorista pode
            fotografar. Desligue pra material que não gera nada (ex: concreto) — aí
            ele fica de fora da exigência de foto das empresas, porque não daria pra
            cobrar foto de um comprovante que não existe.
          </p>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="permiteBotaFora">Permite voltar pro bota-fora</Label>
            <StatusToggle
              id="permiteBotaFora"
              active={form.permiteBotaFora}
              onChange={(next) => setForm({ ...form, permiteBotaFora: next })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ligue pra materiais em que o motorista às vezes volta pro local de carga
            pra descarregar a sobra (limpeza / bota-fora) na última carga. Aí o app
            mostra a pergunta e soma a volta (descarga → carga) no km faturado.
            Desligado (padrão): a pergunta nem aparece.
          </p>
        </div>
        <BarraDeAcao>
          <BotaoCancelar href={voltarPara} sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </BarraDeAcao>
      </form>
    </Card>
  );
}
