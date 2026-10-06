"use client";

import {
  itensDaDefinicao,
  lerDefinicaoEtapa,
  MOMENTO_ETAPA_LABEL,
  type ItemEtapa,
  type MomentoEtapa,
} from "@ronan/shared-types";

/**
 * O celular do motorista, ao vivo — a tela de documentos como ele vai ver.
 * Quem monta o formulário não é quem preenche: a prévia responde "o que ele
 * vai ver?" sem instalar o app. Lê pela MESMA função do app
 * (`lerDefinicaoEtapa`), então o que não aparece aqui não aparece lá.
 *
 * Sim/Não é LISTA ("Escolha…"), como todo o resto do app (decisão do dono);
 * nada vem marcado.
 */
export function PreviaCelularEtapa({
  nome,
  momento,
  definicao,
  pendente,
}: {
  nome: string;
  momento: MomentoEtapa;
  definicao: unknown;
  pendente: boolean;
}) {
  const def = lerDefinicaoEtapa(definicao);
  const total = itensDaDefinicao(def).length;
  return (
    <div className="space-y-2">
      {pendente && <p className="text-center text-xs font-medium text-amber-700">Prévia — ainda não publicado</p>}
      <div className="mx-auto w-[312px] overflow-hidden rounded-[28px] border-4 border-zinc-800 bg-white text-zinc-900 shadow-lg">
        <div className="flex h-11 items-center gap-2 bg-[#DF7234] px-3 text-sm font-bold text-white">
          <span aria-hidden>✕</span>
          <span className="truncate">{nome.trim() || "Documentos"}</span>
        </div>
        <div className="h-[560px] space-y-3 overflow-y-auto bg-zinc-50 p-3 text-[13px]">
          <div>
            <p className="text-[11px] text-zinc-500">ABC-1D23 · {MOMENTO_ETAPA_LABEL[momento]}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full w-0 bg-emerald-600" />
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">0 de {total} feitos</p>
          </div>
          {def.areas.length === 0 && <p className="text-zinc-500">Nenhum item ainda.</p>}
          {def.areas.map((a, i) => (
            <div key={i} className="space-y-3 rounded-xl border bg-white p-2.5">
              <p className="flex justify-between text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                <span className="truncate">{a.titulo}</span>
                <span className="shrink-0 font-normal">0 de {a.itens.length}</span>
              </p>
              {a.itens.map((it) => (
                <ItemNaPrevia key={it.chave} item={it} />
              ))}
            </div>
          ))}
          <div className="flex h-12 items-center justify-center rounded-lg bg-emerald-600 text-[15px] font-bold text-white">
            ✓ Concluir {nome.trim() ? nome.trim().toLowerCase() : "documentos"}
          </div>
          <div className="flex h-10 items-center justify-center rounded-lg border bg-white font-semibold text-zinc-700">
            ← Voltar pra viagem
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Publicado, chega no celular na próxima vez que o motorista tiver sinal.
      </p>
    </div>
  );
}

function BotoesFoto({ pdf }: { pdf?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="rounded-md border bg-white px-2 py-1 font-semibold">📷 Tirar foto</span>
      <span className="rounded-md border bg-white px-2 py-1 font-semibold">🖼 Galeria</span>
      {pdf && <span className="rounded-md border bg-white px-2 py-1 font-semibold">📄 Escolher PDF</span>}
    </div>
  );
}

function ItemNaPrevia({ item }: { item: ItemEtapa }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-start justify-between gap-2 font-semibold">
        <span>{item.rotulo}</span>
        {item.obrigatorio && <span className="shrink-0 text-[10px] font-normal text-zinc-500">obrigatório</span>}
      </p>
      {item.ajuda && <p className="text-[11px] text-zinc-500">{item.ajuda}</p>}
      {(item.tipo === "FOTO" || item.tipo === "FOTO_OU_PDF") && <BotoesFoto pdf={item.tipo === "FOTO_OU_PDF"} />}
      {item.tipo === "TEXTO_COM_FOTO" && (
        <>
          <div className="h-9 rounded-lg border bg-white" />
          <BotoesFoto />
        </>
      )}
      {item.tipo === "TEXTO" && <div className="h-9 rounded-lg border bg-white" />}
      {item.tipo === "VALOR" && (
        <div className="flex h-10 items-center rounded-lg border bg-white px-2 text-base font-bold text-zinc-400">R$ 0,00</div>
      )}
      {item.tipo === "NUMERO" && (
        <div className="flex h-9 items-center justify-end rounded-lg border bg-white px-2 text-zinc-400">
          {item.numero.unidade ?? ""}
        </div>
      )}
      {item.tipo === "SIM_NAO" && (
        <>
          <div className="flex h-9 items-center justify-between rounded-lg border bg-white px-2 text-zinc-400">
            Escolha… <span>▾</span>
          </div>
          <ExtrasSimNao item={item} />
        </>
      )}
      {item.tipo === "ASSINATURA" && (
        <>
          {item.assinatura.pedeNome && <div className="h-9 rounded-lg border bg-white px-2 pt-2 text-zinc-400">Nome de quem assina</div>}
          <div className="flex h-20 items-center justify-center rounded-lg border-2 border-dashed bg-white text-zinc-400">
            assine aqui com o dedo
          </div>
        </>
      )}
      {item.seFaltar === "NAO_SEGUIR" && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
          O escritório precisa deste documento antes da próxima viagem.
        </p>
      )}
    </div>
  );
}

function ExtrasSimNao({ item }: { item: ItemEtapa }) {
  const desc = (lado: "Sim" | "Não", e: ItemEtapa["simNao"]["aoSim"]) => {
    const partes: string[] = [];
    if (e.foto !== "NAO") partes.push(e.foto === "EXIGE" ? "foto" : "foto (opcional)");
    if (e.comentario !== "NAO") partes.push(e.comentario === "EXIGE" ? "comentário" : "comentário (opcional)");
    return partes.length ? `${lado} → pede ${partes.join(" e ")}` : null;
  };
  const linhas = [desc("Sim", item.simNao.aoSim), desc("Não", item.simNao.aoNao)].filter(Boolean);
  if (!linhas.length) return null;
  return (
    <p className="text-[11px] text-zinc-500">
      {linhas.map((l, i) => (
        <span key={i} className="block">
          {l}
        </span>
      ))}
    </p>
  );
}
