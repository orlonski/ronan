"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
};

const PATH = "/admin/materiais";

type Props = { initial?: Material };

/** O estado do formulário: o valor é TEXTO enquanto a pessoa digita. */
type MaterialForm = {
  nome: string;
  apelidos: string[];
  exigeTicket: boolean;
  permiteBotaFora: boolean;
  temComprovanteFoto: boolean;
  dispensaConferencia: boolean;
  valorReferenciaTonelada: string;
};

/** O que vai pra API: número de verdade, ou null quando em branco. */
type MaterialBody = Omit<MaterialForm, "valorReferenciaTonelada"> & {
  valorReferenciaTonelada: number | null;
};

export function MaterialForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<MaterialBody, Material>(PATH, PATH);
  const update = useUpdateResource<Partial<MaterialBody>, Material>(PATH, PATH);
  const [form, setForm] = useState<MaterialForm>({
    nome: initial?.nome ?? "",
    apelidos: initial?.apelidos ?? [],
    exigeTicket: initial?.exigeTicket ?? true,
    permiteBotaFora: initial?.permiteBotaFora ?? false,
    temComprovanteFoto: initial?.temComprovanteFoto ?? true,
    dispensaConferencia: initial?.dispensaConferencia ?? false,
    valorReferenciaTonelada:
      initial?.valorReferenciaTonelada == null ? "" : String(initial.valorReferenciaTonelada),
  });

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      ...form,
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
    router.push("/materiais");
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
        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/materiais" sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
