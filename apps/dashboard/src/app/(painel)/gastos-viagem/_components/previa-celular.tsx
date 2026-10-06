"use client";

import {
  CAMPO_DESPESA_PERGUNTA_PADRAO,
  CAMPOS_DESPESA,
  CAMPO_DESPESA_LABEL,
  resolverCamposDoTipo,
} from "@ronan/shared-types";
import { brl, emojiDoIcone } from "./comum";

export type TipoNaPrevia = {
  id: string;
  slug: string;
  nome: string;
  icone: string | null;
  ativo: boolean;
  devolve: boolean;
  devolveNoMaximo: string | null;
  manutencao: boolean;
  campos: unknown;
};

/**
 * O celular do motorista, ao vivo (10-telas §9). Quem configura não é quem
 * usa: ver o formulário mudar ao ligar um campo responde "o que ele vai ver?"
 * sem instalar o app. Usa `resolverCamposDoTipo` — a MESMA função do app.
 */
export function PreviaCelular({
  modo,
  tipo,
  lista,
  pendente,
}: {
  modo: "formulario" | "lista";
  tipo: TipoNaPrevia | null;
  lista: TipoNaPrevia[];
  pendente: boolean;
}) {
  return (
    <div className="space-y-2">
      {pendente && (
        <p className="text-center text-xs font-medium text-amber-700">Prévia — ainda não salvo</p>
      )}
      <div className="mx-auto w-[312px] overflow-hidden rounded-[28px] border-4 border-zinc-800 bg-white text-zinc-900 shadow-lg">
        <div className="flex h-11 items-center gap-2 bg-[hsl(220_75%_28%)] px-3 text-sm font-bold text-white">
          <span aria-hidden>←</span>
          {modo === "lista" ? "Gasto de viagem" : (tipo?.nome ?? "Gasto de viagem")}
        </div>
        <div className="h-[560px] space-y-3 overflow-y-auto p-3 text-[13px]">
          {modo === "lista" ? <Lista lista={lista} /> : tipo ? <Formulario tipo={tipo} /> : null}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        O que muda aqui aparece no celular na próxima vez que o motorista tiver sinal.
      </p>
    </div>
  );
}

function Lista({ lista }: { lista: TipoNaPrevia[] }) {
  const ativos = lista.filter((t) => t.ativo);
  return (
    <>
      <div>
        <p className="text-lg font-bold">O que você pagou?</p>
        <p className="text-xs text-zinc-500">Vai pro escritório e volta pra você no acerto.</p>
      </div>
      <ul className="divide-y rounded-lg border">
        <LinhaLista emoji="🛣" nome="Pedágio" />
        <LinhaLista emoji="⛽" nome="Abastecimento" />
      </ul>
      <ul className="divide-y rounded-lg border">
        {ativos.map((t) => (
          <LinhaLista key={t.id} emoji={emojiDoIcone(t.icone)} nome={t.nome} sub={t.devolve ? undefined : "Por sua conta"} />
        ))}
      </ul>
      <p className="text-sm font-medium text-[hsl(220_75%_28%)]">Ver meus reembolsos ›</p>
    </>
  );
}

function LinhaLista({ emoji, nome, sub }: { emoji: string; nome: string; sub?: string }) {
  return (
    <li className="flex h-12 items-center gap-2 px-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-100">{emoji}</span>
      <span className="flex-1">
        <span className="block font-semibold">{nome}</span>
        {sub && <span className="block text-[11px] text-zinc-500">{sub}</span>}
      </span>
      <span className="text-zinc-400">›</span>
    </li>
  );
}

function Formulario({ tipo }: { tipo: TipoNaPrevia }) {
  const cfg = resolverCamposDoTipo(tipo);
  const obrigatorios = CAMPOS_DESPESA.filter((c) => cfg.campos[c].modo === "OBRIGATORIO");
  const opcionais = CAMPOS_DESPESA.filter((c) => cfg.campos[c].modo === "OPCIONAL");
  const pergunta = (c: (typeof CAMPOS_DESPESA)[number]) =>
    cfg.campos[c].pergunta ?? CAMPO_DESPESA_PERGUNTA_PADRAO[c];
  return (
    <>
      {cfg.foto !== "NAO_PEDE" && (
        <div>
          <p className="mb-1 font-semibold">Foto do comprovante</p>
          <div className="flex h-24 flex-col items-center justify-center rounded-lg border-2 border-dashed text-zinc-500">
            <span aria-hidden>📷</span>
            <span className="font-semibold">Fotografar o papel</span>
          </div>
          <p className="mt-1 text-[11px] text-[hsl(220_75%_28%)]">
            Escolher da galeria · Não tenho o comprovante
            {cfg.foto === "EXIGE" && <span className="text-zinc-500"> (aí ele conta o que houve)</span>}
          </p>
        </div>
      )}
      <div>
        <p className="mb-1 font-semibold">Valor</p>
        <div className="flex h-11 items-center rounded-lg border px-2 text-lg font-bold text-zinc-400">R$ 0,00</div>
        {tipo.devolveNoMaximo && (
          <p className="mt-1 text-[11px] text-zinc-500">Devolvido até {brl(tipo.devolveNoMaximo)} por gasto.</p>
        )}
        {!tipo.devolve && <p className="mt-1 text-[11px] text-zinc-500">Por sua conta: a empresa não devolve.</p>}
      </div>
      {obrigatorios.map((c) => (
        <div key={c}>
          <p className="mb-1 font-semibold">{pergunta(c)}</p>
          <div className="flex h-10 items-center rounded-lg border px-2 text-zinc-400">
            {c === "placa" ? "Escolha a placa ▾" : (cfg.campos[c].exemplo ?? "")}
          </div>
          {c === "placa" && tipo.manutencao && (
            <p className="mt-1 text-[11px] text-zinc-500">Vai pro histórico deste caminhão.</p>
          )}
        </div>
      ))}
      <div className="rounded-lg border p-2">
        <p className="font-semibold">Foi nesta viagem?</p>
        <p className="text-[11px] text-zinc-500">Só aparece se o celular conhece uma viagem parecida.</p>
      </div>
      <p className="text-zinc-500">
        Hoje, 14:32 · <span className="text-[hsl(220_75%_28%)]">Foi em outro dia?</span>
      </p>
      {opcionais.length > 0 && (
        <p className="font-medium">
          ▸ Mais detalhes ({opcionais.map((c) => CAMPO_DESPESA_LABEL[c].toLowerCase()).join(", ")})
        </p>
      )}
      <div className="flex h-14 items-center justify-center rounded-lg bg-[#DF7234] text-base font-bold text-white">
        ✓ Salvar gasto
      </div>
    </>
  );
}
