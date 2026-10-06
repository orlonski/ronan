/**
 * ETAPAS DA VIAGEM (módulo `etapas`) — TODA a conversa do app com a API mora
 * aqui, junto com os tipos do contrato.
 *
 * ⚠️ Os tipos e leitores abaixo ESPELHAM o contrato /m/etapas* (servidor em
 * paralelo; fonte da verdade `packages/shared-types/src/etapa-viagem.ts`, que
 * chega pelo branch da API). Trocar por @ronan/shared-types quando o pacote
 * tiver os schemas: `ModeloEtapaCatalogo`, `DefinicaoEtapa`, `ItemEtapa`,
 * `lerDefinicaoEtapa`, `itemCompleto`, `ResponderEtapaInput`,
 * `SeguiuSemEtapaInput`, `EtapasDoMotoristaResposta`,
 * `PendenciasEtapaMotoristaResposta`, `MOTIVOS_SEGUIR_SEM` têm o mesmo papel lá.
 *
 * Por dentro o app usa uma forma ACHATADA do modelo (itens com a área) — é ela
 * que fica no rascunho. Quem lê o que vem do servidor (ou do disco) são leitores
 * TOTAIS: nunca lançam, campo ausente vale o padrão, tipo de item desconhecido é
 * PULADO (app velho, campo novo). Cache velho ou servidor antigo nunca derrubam a
 * tela no posto.
 *
 * Nada aqui desenha tela nem mexe na fila: a fila (lib/sync.ts) chama as
 * funções de envio; as telas usam lib/etapas-local.ts.
 */
import { api, request } from "./api";

// ---------------------------------------------------------------------------
// Capacidade (shared-types/capacidades-app.ts — trocar por shared-types)
// ---------------------------------------------------------------------------

/**
 * "Documentos da viagem" no app. NASCE DESLIGADA: só vale com um `true`
 * explícito do servidor (`useCapacidadeNova`). Desligada = app exatamente como
 * antes — nenhuma tela, cartão, aviso ou barreira.
 */
export const CAP_ETAPAS = "app.viagem.etapas";

// ---------------------------------------------------------------------------
// Definição do formulário (cópia do contrato — trocar por shared-types)
// ---------------------------------------------------------------------------

/**
 * Quando o formulário aparece.
 * - INICIO: logo depois de "Começar viagem" (é a carga).
 * - FIM: logo depois de "Finalizar viagem" (é a descarga).
 * - AVULSA: não abre sozinha (acerto do frete) — botão na viagem e aviso na home.
 * - EVENTO: preso a um tipo extra do catálogo. Fora da Onda 1 no app: pulado.
 */
export type MomentoEtapa = "INICIO" | "FIM" | "AVULSA" | "EVENTO";

/**
 * Tipos de item como o APP os chama por dentro. O contrato usa `FOTO_OU_PDF`
 * e `TEXTO_COM_FOTO` — o leitor traduz na entrada e o envio não manda tipo.
 */
export const TIPOS_ITEM_ETAPA = [
  "FOTO",
  "ARQUIVO",
  "SIM_NAO",
  "VALOR",
  "NUMERO",
  "TEXTO",
  "TEXTO_FOTO",
  "ASSINATURA",
] as const;
export type TipoItemEtapa = (typeof TIPOS_ITEM_ETAPA)[number];

const APELIDOS_TIPO: Record<string, TipoItemEtapa> = {
  FOTO_OU_PDF: "ARQUIVO",
  TEXTO_COM_FOTO: "TEXTO_FOTO",
};

/** "Se faltar": só avisar o escritório, ou pedir motivo na próxima ação. */
export type SeFaltar = "AVISAR" | "NAO_SEGUIR";

/** O que aparece depois de Sim ou de Não: nada, opcional ou obrigatório. */
export type ModoExtraSimNao = "NAO" | "PEDE" | "EXIGE";
export type ExtraSimNao = { foto: ModoExtraSimNao; comentario: ModoExtraSimNao };

export type ItemEtapa = {
  /** Estável entre versões — é a chave da resposta. */
  chave: string;
  /** Título da área (cartão) em que o item mora. */
  area: string | null;
  rotulo: string;
  ajuda: string | null;
  tipo: TipoItemEtapa;
  obrigatorio: boolean;
  seFaltar: SeFaltar;
  escritorioPodeAnexar: boolean;
  /** FOTO / ARQUIVO / TEXTO_FOTO (e as fotos do SIM_NAO): quantos arquivos. */
  fotos: { min: number; max: number };
  simNao: { aoSim: ExtraSimNao; aoNao: ExtraSimNao };
  numero: { unidade: string | null; casas: number };
  assinatura: { pedeNome: boolean };
};

export type ModeloEtapa = {
  id: string;
  /** A VERSÃO publicada que o celular viu (volta no POST). */
  versaoId: string;
  versao: number;
  nome: string;
  momento: MomentoEtapa;
  /** Até quantos dias depois de finalizar a viagem o app ainda oferece. */
  janelaDias: number;
  ordem: number;
  itens: ItemEtapa[];
};

export const JANELA_DIAS_PADRAO = 30;
export const MAX_ARQUIVOS_ITEM = 10;
const CHAVE_ITEM_REGEX = /^[A-Za-z0-9_-]{1,40}$/;

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function inteiro(v: unknown, padrao: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function lerFaixaFotos(v: unknown): { min: number; max: number } {
  if (!v || typeof v !== "object") return { min: 1, max: MAX_ARQUIVOS_ITEM };
  const o = v as Record<string, unknown>;
  const max = inteiro(o.max, MAX_ARQUIVOS_ITEM, 1, MAX_ARQUIVOS_ITEM);
  const min = inteiro(o.min, 1, 0, max);
  return { min, max };
}

function lerModo(v: unknown): ModoExtraSimNao {
  return v === "PEDE" || v === "EXIGE" ? v : "NAO";
}

function lerExtra(v: unknown): ExtraSimNao {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { foto: lerModo(o.foto), comentario: lerModo(o.comentario) };
}

/** Leitor TOTAL de um item. `null` = tipo que este app não sabe mostrar (pula). */
function lerItem(v: unknown, areaDaDefinicao: string | null): ItemEtapa | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const chave = texto(o.chave, 40);
  const rotulo = texto(o.rotulo, 200);
  const tipoBruto = typeof o.tipo === "string" ? o.tipo.toUpperCase() : "";
  const tipo = (TIPOS_ITEM_ETAPA as readonly string[]).includes(tipoBruto)
    ? (tipoBruto as TipoItemEtapa)
    : APELIDOS_TIPO[tipoBruto];
  if (!chave || !CHAVE_ITEM_REGEX.test(chave) || !rotulo || !tipo) return null;

  const sn = o.simNao && typeof o.simNao === "object" ? (o.simNao as Record<string, unknown>) : {};
  const num = o.numero && typeof o.numero === "object" ? (o.numero as Record<string, unknown>) : {};
  const as = o.assinatura && typeof o.assinatura === "object"
    ? (o.assinatura as Record<string, unknown>)
    : {};

  return {
    chave,
    area: areaDaDefinicao ?? texto(o.area, 120),
    rotulo,
    ajuda: texto(o.ajuda, 300),
    tipo,
    obrigatorio: o.obrigatorio === true,
    // NAO_SEGUIR em item opcional não tem o que parar: vira AVISAR (igual ao servidor).
    seFaltar: o.seFaltar === "NAO_SEGUIR" && o.obrigatorio === true ? "NAO_SEGUIR" : "AVISAR",
    escritorioPodeAnexar: o.escritorioPodeAnexar === true,
    fotos: lerFaixaFotos(o.fotos),
    simNao: { aoSim: lerExtra(sn.aoSim), aoNao: lerExtra(sn.aoNao) },
    numero: { unidade: texto(num.unidade, 20), casas: inteiro(num.casas, 0, 0, 6) },
    assinatura: { pedeNome: as.pedeNome === true },
  };
}

/**
 * Lê os itens. Aceita a `definicao` do contrato (`{ v: 1, areas: [{ titulo,
 * itens }] }`) ou a lista achatada que o próprio app guarda no rascunho (cada
 * item com a `area`). Versão desconhecida → nenhum item.
 */
export function lerItensEtapa(json: unknown): ItemEtapa[] {
  const brutos: { item: unknown; area: string | null }[] = [];
  if (Array.isArray(json)) {
    for (const i of json) brutos.push({ item: i, area: null });
  } else if (json && typeof json === "object") {
    const j = json as Record<string, unknown>;
    if (j.v !== undefined && j.v !== 1) return [];
    if (Array.isArray(j.areas)) {
      for (const a of j.areas) {
        if (!a || typeof a !== "object") continue;
        const area = a as Record<string, unknown>;
        const titulo = texto(area.titulo, 120);
        for (const i of Array.isArray(area.itens) ? area.itens : []) brutos.push({ item: i, area: titulo });
      }
    } else if (Array.isArray(j.itens)) {
      for (const i of j.itens) brutos.push({ item: i, area: null });
    }
  }
  const vistos = new Set<string>();
  const saida: ItemEtapa[] = [];
  for (const b of brutos.slice(0, 60)) {
    const item = lerItem(b.item, b.area);
    if (!item || vistos.has(item.chave)) continue;
    vistos.add(item.chave);
    saida.push(item);
  }
  return saida;
}

const MOMENTOS: readonly MomentoEtapa[] = ["INICIO", "FIM", "AVULSA", "EVENTO"];

/** Leitor TOTAL de um modelo (`ModeloEtapaCatalogo`, ou o achatado do rascunho). */
export function lerModeloEtapa(v: unknown): ModeloEtapa | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = texto(o.id, 100);
  const nome = texto(o.nome, 120);
  const momento = (MOMENTOS as readonly unknown[]).includes(o.momento)
    ? (o.momento as MomentoEtapa)
    : null;
  const versaoId = texto(o.versaoId, 100);
  if (!id || !nome || !momento || !versaoId) return null;
  if (o.ativo === false) return null;
  const itens = lerItensEtapa(o.definicao ?? o.itens);
  if (itens.length === 0) return null;
  return {
    id,
    versaoId,
    versao: inteiro(o.versao, 1, 1, 1_000_000),
    nome,
    momento,
    janelaDias: inteiro(o.janelaDias, JANELA_DIAS_PADRAO, 1, 365),
    ordem: inteiro(o.ordem, 0, -1_000_000, 1_000_000),
    itens,
  };
}

/**
 * Compat on-read: cache sem o campo (app que nunca baixou, servidor antigo,
 * conta sem o módulo) ou lixo → NENHUM modelo = app exatamente como era.
 */
export function lerModelosEtapa(raw: unknown): ModeloEtapa[] {
  const lista = Array.isArray(raw) ? raw : [];
  const saida: ModeloEtapa[] = [];
  for (const m of lista) {
    const lido = lerModeloEtapa(m);
    // EVENTO fica fora da Onda 1 no app (os marcos são INICIO e FIM).
    if (lido && lido.momento !== "EVENTO") saida.push(lido);
  }
  return saida.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

// ---------------------------------------------------------------------------
// Envio — o que a fila manda
// ---------------------------------------------------------------------------

/** Teto do upload de UM arquivo: 10 MB de PDF num 4G de beira de estrada. */
export const TIMEOUT_UPLOAD_ARQUIVO_MS = 120_000;
export const TAMANHO_MAX_ARQUIVO = 10 * 1024 * 1024;

export type ArquivoEnviado = { storageKey: string; mime?: string | null; nome?: string | null };

/**
 * Um item no POST. `undefined` = "fica como está" no servidor; `null` =
 * "limpa" (ele apagou o texto, trocou Sim por Não e o comentário sumiu).
 * `arquivos` SOMAM (por storageKey); só saem por `arquivosRemovidos`.
 */
export type ItemRespostaEnviado = {
  chave: string;
  simNao?: boolean | null;
  texto?: string | null;
  numero?: number | null;
  valor?: number | null;
  comentario?: string | null;
  assinatura?: string | null;
  assinanteNome?: string | null;
  arquivos: ArquivoEnviado[];
  arquivosRemovidos: string[];
  /** Relógio do aparelho quando ele mexeu NESTE item. */
  respondidoEm: string;
};

/**
 * `ResponderEtapaInput`. Sempre 200: idempotente, e mescla por
 * `(viagemClientId, modeloId)` — outro clientId pro mesmo par (reinstalou,
 * outro celular) MESCLA, nunca 409.
 */
export type RespostaEtapaEnviada = {
  clientId: string;
  viagemClientId: string;
  modeloId: string;
  versaoId: string;
  itens: ItemRespostaEnviado[];
  /** Tocou "Concluir" (nunca volta a false). */
  concluida?: boolean;
  iniciadaEm?: string | null;
  concluidaEm?: string | null;
  lat?: number | null;
  lng?: number | null;
  criadoOfflineEm?: string | null;
};

/** POST /m/uploads/etapa (multipart `arquivo`, imagem ou PDF) → `{ storageKey, sha256, ... }`. */
export async function enviarArquivoEtapa(a: {
  uri: string;
  mime: string;
  nome: string;
}): Promise<{ storageKey: string; sha256?: string }> {
  const fd = new FormData();
  fd.append("arquivo", { uri: a.uri, type: a.mime, name: a.nome } as unknown as Blob);
  const r = await api.postForm<{ storageKey?: string; sha256?: string }>("/m/uploads/etapa", fd, {
    outbox: true,
    timeoutMs: TIMEOUT_UPLOAD_ARQUIVO_MS,
  });
  if (!r?.storageKey) throw new Error("O servidor não devolveu a chave do arquivo.");
  return { storageKey: r.storageKey, sha256: r.sha256 };
}

/** POST /m/etapas. */
export async function enviarRespostaEtapa(corpo: RespostaEtapaEnviada): Promise<void> {
  await api.post("/m/etapas", corpo, { outbox: true });
}

/**
 * Motivos de "Seguir sem isso" COMO O MOTORISTA LÊ (decisão do dono,
 * 06/10/2026). O servidor tem outro enum (`MotivoSeguirSem`): a tradução está
 * em `motivoParaServidor` — "Esqueci o papel" não tem código próprio lá e vai
 * como OUTRO com o texto, sem perder nada.
 */
export const MOTIVOS_SEGUIR_SEM = [
  { value: "JA_COM_ESCRITORIO", label: "Já está com o escritório" },
  { value: "ESCRITORIO_NAO_MANDOU", label: "O escritório ainda não mandou" },
  { value: "ESQUECI", label: "Esqueci o papel" },
  { value: "OUTRO", label: "Outro" },
] as const;
export type MotivoSeguirSem = (typeof MOTIVOS_SEGUIR_SEM)[number]["value"];

export type MotivoSeguirSemServidor = "JA_COM_ESCRITORIO" | "AINDA_NAO_RECEBI" | "VOU_MANDAR_DEPOIS" | "OUTRO";

export function motivoParaServidor(
  motivo: MotivoSeguirSem,
  textoOutro?: string,
): { motivoCodigo: MotivoSeguirSemServidor; motivoTexto?: string } {
  switch (motivo) {
    case "JA_COM_ESCRITORIO":
      return { motivoCodigo: "JA_COM_ESCRITORIO" };
    case "ESCRITORIO_NAO_MANDOU":
      return { motivoCodigo: "AINDA_NAO_RECEBI" };
    case "ESQUECI":
      return { motivoCodigo: "OUTRO", motivoTexto: "Esqueci o papel" };
    case "OUTRO":
      return { motivoCodigo: "OUTRO", motivoTexto: textoOutro?.trim() || undefined };
  }
}

/** `SeguiuSemEtapaInput`. Não supre a pendência — só anota o motivo. */
export type SeguiuSemEnviado = {
  clientId: string;
  viagemClientId: string;
  modeloId: string;
  itens: string[];
  motivoCodigo: MotivoSeguirSemServidor;
  motivoTexto?: string | null;
  acao: "FINALIZAR" | "INICIAR_PROXIMA" | "OUTRA";
  ocorridoEm: string;
  lat?: number | null;
  lng?: number | null;
};

/** POST /m/etapas/seguiu-sem. */
export async function enviarSeguiuSem(corpo: SeguiuSemEnviado): Promise<void> {
  await api.post("/m/etapas/seguiu-sem", corpo, { outbox: true });
}

/** O POST recusou uma storageKey (fora do prefixo conta/motorista): re-subir o arquivo local. */
export function ehArquivoInvalido(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { code?: unknown }).code === "ARQUIVO_INVALIDO";
}

// ---------------------------------------------------------------------------
// Leitura: GET /m/etapas?viagemClientId= e GET /m/etapas/pendencias?viagemClientId=
// ---------------------------------------------------------------------------

export type ArquivoServidor = { id: string; storageKey: string; mime: string; nome: string | null };

export type ItemRespostaServidor = {
  chave: string;
  texto: string | null;
  numero: number | null;
  valor: number | null;
  simNao: boolean | null;
  comentario: string | null;
  assinatura: string | null;
  assinanteNome: string | null;
  arquivos: ArquivoServidor[];
};

export type RespostaEtapaServidor = {
  clientId: string;
  modeloId: string;
  concluida: boolean;
  concluidaEm: string | null;
  itens: ItemRespostaServidor[];
};

/**
 * A situação de cada item, ACHATADA do `EstadoEtapasViagem` do servidor. É o
 * que a barreira consulta antes de aparecer: se o escritório já anexou ou
 * dispensou (ou ele já explicou em outro celular), o cartão nem aparece.
 */
export type SituacaoItemServidor =
  | "FALTANDO"
  | "SEGUIU_SEM"
  | "RESPONDIDO"
  | "ANEXADO_ESCRITORIO"
  | "DISPENSADO";

export type PendenciaServidor = {
  modeloId: string;
  itemChave: string;
  situacao: SituacaoItemServidor;
};

export type EtapasDaViagemServidor = {
  respostas: RespostaEtapaServidor[];
  pendencias: PendenciaServidor[];
};

function numeroOuNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function lerArquivoServidor(v: unknown): ArquivoServidor | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = texto(o.id, 100);
  const storageKey = texto(o.storageKey, 400);
  if (!id || !storageKey) return null;
  return { id, storageKey, mime: texto(o.mime, 100) ?? "image/jpeg", nome: texto(o.nome, 200) };
}

function lerItemRespostaServidor(v: unknown): ItemRespostaServidor | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const chave = texto(o.chave, 40);
  if (!chave) return null;
  return {
    chave,
    texto: typeof o.texto === "string" ? o.texto : null,
    numero: numeroOuNull(o.numero),
    valor: numeroOuNull(o.valor),
    simNao: typeof o.simNao === "boolean" ? o.simNao : null,
    comentario: typeof o.comentario === "string" ? o.comentario : null,
    assinatura: typeof o.assinatura === "string" ? o.assinatura : null,
    assinanteNome: typeof o.assinanteNome === "string" ? o.assinanteNome : null,
    arquivos: Array.isArray(o.arquivos)
      ? o.arquivos.map(lerArquivoServidor).filter((a): a is ArquivoServidor => !!a)
      : [],
  };
}

/** `PendenciasViagemMotorista[]` → situação por item, achatada. */
function lerPendencias(viagens: unknown[], viagemClientId: string): PendenciaServidor[] {
  const saida: PendenciaServidor[] = [];
  for (const v of viagens) {
    if (!v || typeof v !== "object") continue;
    const pv = v as Record<string, unknown>;
    if (typeof pv.viagemClientId === "string" && pv.viagemClientId !== viagemClientId) continue;
    const estado = pv.estado && typeof pv.estado === "object" ? (pv.estado as Record<string, unknown>) : {};
    for (const e of Array.isArray(estado.etapas) ? estado.etapas : []) {
      if (!e || typeof e !== "object") continue;
      const et = e as Record<string, unknown>;
      const modeloId = texto(et.modeloId, 100);
      if (!modeloId) continue;
      const seguiuSem = new Set<string>();
      for (const f of Array.isArray(et.faltando) ? et.faltando : []) {
        if (f && typeof f === "object" && (f as { seguiuSem?: unknown }).seguiuSem) {
          const k = texto((f as { itemChave?: unknown }).itemChave, 40);
          if (k) seguiuSem.add(k);
        }
      }
      for (const i of Array.isArray(et.itens) ? et.itens : []) {
        if (!i || typeof i !== "object") continue;
        const it = i as Record<string, unknown>;
        const itemChave = texto(it.chave, 40);
        if (!itemChave) continue;
        let situacao: SituacaoItemServidor | null = null;
        if (it.estado === "FEITO") situacao = "RESPONDIDO";
        else if (it.estado === "DISPENSADO") situacao = "DISPENSADO";
        else if (it.estado === "ANEXADO_ESCRITORIO") situacao = "ANEXADO_ESCRITORIO";
        else if (it.estado === "FALTANDO") situacao = seguiuSem.has(itemChave) ? "SEGUIU_SEM" : "FALTANDO";
        if (situacao) saida.push({ modeloId, itemChave, situacao });
      }
    }
  }
  return saida;
}

/**
 * Leitor total das duas leituras (`EtapasDoMotoristaResposta` traz
 * `respostas` + `pendencias`; `PendenciasEtapaMotoristaResposta` traz
 * `viagens`). Lixo → listas vazias.
 */
export function lerEtapasDaViagem(raw: unknown, viagemClientId: string): EtapasDaViagemServidor {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const respostas: RespostaEtapaServidor[] = [];
  for (const r of Array.isArray(o.respostas) ? o.respostas : []) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const clientId = texto(x.clientId, 100);
    const modeloId = texto(x.modeloId, 100);
    if (!clientId || !modeloId) continue;
    if (typeof x.viagemClientId === "string" && x.viagemClientId !== viagemClientId) continue;
    respostas.push({
      clientId,
      modeloId,
      concluida: x.concluida === true,
      concluidaEm: texto(x.concluidaEm, 40),
      itens: Array.isArray(x.itens)
        ? x.itens.map(lerItemRespostaServidor).filter((i): i is ItemRespostaServidor => !!i)
        : [],
    });
  }
  const viagens = Array.isArray(o.pendencias) ? o.pendencias : Array.isArray(o.viagens) ? o.viagens : [];
  return { respostas, pendencias: lerPendencias(viagens, viagemClientId) };
}

/** GET /m/etapas?viagemClientId= — o que ele já respondeu (outro celular), com teto curto. */
export async function buscarEtapasDaViagem(
  viagemClientId: string,
): Promise<EtapasDaViagemServidor | null> {
  try {
    const raw = await request<unknown>(
      "GET",
      `/m/etapas?viagemClientId=${encodeURIComponent(viagemClientId)}`,
      { timeoutMs: 6_000 },
    );
    return lerEtapasDaViagem(raw, viagemClientId);
  } catch {
    return null;
  }
}

/**
 * GET /m/etapas/pendencias?viagemClientId= com teto CURTO, pra barreira: com
 * sinal ruim, ele não pode ficar esperando pra seguir. Falhou/demorou = `null`
 * e vale o que o celular sabe.
 */
export async function revalidarEtapasDaViagem(
  viagemClientId: string,
): Promise<EtapasDaViagemServidor | null> {
  try {
    const raw = await request<unknown>(
      "GET",
      `/m/etapas/pendencias?viagemClientId=${encodeURIComponent(viagemClientId)}`,
      { timeoutMs: 4_000 },
    );
    return lerEtapasDaViagem(raw, viagemClientId);
  } catch {
    return null;
  }
}

/** URL do arquivo que já subiu (GET autenticado — `<Image>` só com token pronto). */
export function caminhoArquivoEtapa(arquivoId: string): string {
  return `/m/etapas/arquivos/${encodeURIComponent(arquivoId)}`;
}
