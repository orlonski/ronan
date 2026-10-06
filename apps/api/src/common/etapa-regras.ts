import type { ItemRespostaInput, MarcaRespostaEtapa } from "@ronan/shared-types";

/**
 * Regras puras das ETAPAS DA VIAGEM do lado do servidor (o que falta mora no
 * shared-types, `calcularEstadoEtapas`, porque o app usa a mesma regra).
 *
 * Aqui: de quem é um arquivo (prefixo da chave), que tipo ele é, quando a
 * resposta chegou fora da janela, quais carimbos ela leva e — o coração do
 * POST idempotente — como um envio se MESCLA com o que já está gravado.
 */

/** Extensão gravada na chave ↔ o mime servido de volta. Só o que o upload aceita. */
export const MIME_POR_EXT: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export function extDoMime(mime: string): string {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/**
 * O arquivo é DESTE motorista nesta conta? Devolve o sha256 e o mime (pela
 * extensão) ou `false` se a chave não é dele.
 *
 * Formato: `${contaId}/etapas/${dia}/${motoristaId}/${sha256}_${uuid}.${ext}`
 * (ver `UploadsService.putEtapaArquivo`). Uma chave de outra conta ou de outro
 * motorista passando aqui faria o proxy do painel servir o arquivo de outra
 * empresa (I5 do QA) — por isso o POST recusa com 4xx (vai pros Pendentes).
 */
export function dadosDaChaveEtapa(
  key: string,
  contaId: string,
  motoristaId: string,
): { sha256: string | null; mime: string } | false {
  const partes = key.split("/");
  if (partes.length !== 5) return false;
  if (partes.some((p) => p === "" || p === "." || p === "..")) return false;
  if (partes[0] !== contaId || partes[1] !== "etapas" || partes[3] !== motoristaId) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(partes[2]!)) return false;
  const nome = partes[4]!;
  const ext = nome.includes(".") ? nome.slice(nome.lastIndexOf(".") + 1).toLowerCase() : "";
  const mime = MIME_POR_EXT[ext];
  if (!mime) return false;
  const m = /^([0-9a-f]{64})_/.exec(nome);
  return { sha256: m ? m[1]! : null, mime };
}

/** O instante de referência do "fim" da viagem: o dia dela, ou quando chegou ao servidor. */
export function fimDaViagem(v: { data: Date | null; sincronizadoEm: Date }): Date {
  return v.data ?? v.sincronizadoEm;
}

/**
 * Chegou depois da janela? Só vale pra viagem FINALIZADA — em andamento,
 * qualquer hora é hora. A janela conta em dias inteiros a partir do fim (+1
 * dia de folga pro fuso: `data` é o dia civil, guardado à meia-noite UTC).
 */
export function foraDaJanela(args: {
  finalizada: boolean;
  fim: Date;
  janelaDias: number;
  agora: Date;
}): boolean {
  if (!args.finalizada) return false;
  const limite = args.fim.getTime() + (args.janelaDias + 1) * 86_400_000;
  return args.agora.getTime() > limite;
}

/** Os carimbos de uma resposta. Nunca recusa: marca. */
export function marcasDaResposta(args: {
  moduloContratado: boolean;
  modeloAtivo: boolean;
  versaoEhAtual: boolean;
  foraDaJanela: boolean;
  anteriores?: readonly string[];
}): MarcaRespostaEtapa[] {
  const m = new Set<string>(args.anteriores ?? []);
  if (!args.moduloContratado) m.add("SEM_MODULO");
  if (!args.modeloAtivo) m.add("MODELO_INATIVO");
  if (!args.versaoEhAtual) m.add("VERSAO_ANTIGA");
  if (args.foraDaJanela) m.add("FORA_DA_JANELA");
  return [...m].sort() as MarcaRespostaEtapa[];
}

// ─── Mescla de um item ───────────────────────────────────────────────────────

export const CAMPOS_ESCALARES_ITEM = [
  "simNao",
  "texto",
  "numero",
  "valor",
  "comentario",
  "assinatura",
  "assinanteNome",
] as const;
export type CampoEscalarItem = (typeof CAMPOS_ESCALARES_ITEM)[number];

export type ValoresItem = {
  simNao: boolean | null;
  texto: string | null;
  numero: number | null;
  valor: number | null;
  comentario: string | null;
  assinatura: string | null;
  assinanteNome: string | null;
};

/** O item como está no banco (números já convertidos). */
export type ItemGravado = ValoresItem & {
  respondidoEm: Date;
  arquivos: { storageKey: string; removido: boolean }[];
};

export type PlanoItem = {
  /** CRIAR: não existia. ATUALIZAR: algo muda. NADA: reenvio idêntico (idempotência). */
  acao: "CRIAR" | "ATUALIZAR" | "NADA";
  /** Valores finais dos escalares (só os que mudam, no ATUALIZAR). */
  valores: Partial<ValoresItem>;
  /** Os valores anteriores dos campos que mudaram e TINHAM valor — vai pro histórico. */
  antes: Partial<ValoresItem> | null;
  /** O maior respondidoEm entre o gravado e o novo. */
  respondidoEm: Date;
  /** Arquivos novos (ainda não gravados). */
  adicionar: { storageKey: string; mime: string | null; nome: string | null }[];
  /** Arquivos vivos que saem ("Apagar esta foto?"). */
  remover: string[];
};

function normalizar(campo: CampoEscalarItem, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (campo === "simNao") return v === true;
  if (campo === "numero" || campo === "valor") return typeof v === "number" && Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

/**
 * Como um envio se mescla com o item gravado. Função PURA (testada).
 *
 * - Campo AUSENTE no envio fica como está ("o que vier depois soma").
 * - Campo presente troca só se o envio for tão ou mais novo (`respondidoEm`)
 *   que o gravado: um envio velho que chega atrasado (outro celular, fila
 *   presa) nunca desfaz um mais novo.
 * - Arquivos SOMAM sempre (chave nova é arquivo novo); só saem por
 *   `arquivosRemovidos`, explícito.
 * - Reenvio idêntico → NADA (é o mesmo item do outbox chegando duas vezes).
 */
export function mesclarItem(gravado: ItemGravado | null, novo: ItemRespostaInput): PlanoItem {
  const novoEm = novo.respondidoEm;
  const vivos = new Set((gravado?.arquivos ?? []).filter((a) => !a.removido).map((a) => a.storageKey));
  const todos = new Set((gravado?.arquivos ?? []).map((a) => a.storageKey));
  const removidosPedidos = new Set(novo.arquivosRemovidos ?? []);
  const adicionar: PlanoItem["adicionar"] = [];
  const vistos = new Set<string>();
  for (const a of novo.arquivos ?? []) {
    if (todos.has(a.storageKey) || vistos.has(a.storageKey) || removidosPedidos.has(a.storageKey)) continue;
    vistos.add(a.storageKey);
    adicionar.push({ storageKey: a.storageKey, mime: a.mime ?? null, nome: a.nome?.trim() || null });
  }
  const remover = [...removidosPedidos].filter((k) => vivos.has(k));

  if (!gravado) {
    const valores: Partial<ValoresItem> = {};
    for (const c of CAMPOS_ESCALARES_ITEM) {
      const v = normalizar(c, (novo as Record<string, unknown>)[c]);
      (valores as Record<string, unknown>)[c] = v === undefined ? null : v;
    }
    return { acao: "CRIAR", valores, antes: null, respondidoEm: novoEm, adicionar, remover: [] };
  }

  const maisNovo = novoEm.getTime() >= gravado.respondidoEm.getTime();
  const valores: Partial<ValoresItem> = {};
  const antes: Partial<ValoresItem> = {};
  if (maisNovo) {
    for (const c of CAMPOS_ESCALARES_ITEM) {
      const v = normalizar(c, (novo as Record<string, unknown>)[c]);
      if (v === undefined) continue;
      const atual = gravado[c];
      if (v === atual) continue;
      (valores as Record<string, unknown>)[c] = v;
      if (atual !== null) (antes as Record<string, unknown>)[c] = atual;
    }
  }
  const mudaValor = Object.keys(valores).length > 0;
  const respondidoEm = maisNovo ? novoEm : gravado.respondidoEm;
  const acao = mudaValor || adicionar.length || remover.length ? "ATUALIZAR" : "NADA";
  return {
    acao,
    valores,
    antes: Object.keys(antes).length ? antes : null,
    respondidoEm,
    adicionar,
    remover,
  };
}
