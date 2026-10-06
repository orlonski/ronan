/**
 * ETAPAS DA VIAGEM — o que mora NO CELULAR.
 *
 * Três coisas, guardadas juntas numa chave só do `storage` carimbado por
 * cadastro (motorista de várias empresas: nada de uma aparece na outra, M6):
 *
 * 1. **Viagens com documentos** — a lista das viagens em que a função estava
 *    ligada, com a CÓPIA dos formulários que valiam naquele momento (a versão
 *    que ele viu). É daqui que saem o cartão da viagem, o aviso da home e a
 *    barreira — sem depender de rede nem do estado atual da capacidade.
 * 2. **Rascunhos** — a resposta de cada formulário, gravada a CADA toque. Ele
 *    pode sair no meio, desligar o celular e voltar amanhã. Pro escritório,
 *    sobe quando ele sai da tela (`enviarRascunho` → fila coalescida).
 * 3. **"Seguiu sem"** — o que ele já explicou, pra a barreira não perguntar
 *    de novo.
 *
 * A pendência de verdade é calculada no servidor (viagem × modelos ×
 * respostas). Aqui é o espelho offline dela, com a mesma regra.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { storage } from "./storage";
import { motoristaAtivoId } from "./sessoes";
import {
  listPendingEtapas,
  listPendingEtapasSeguiuSem,
  type ArquivoEtapaPendente,
  type PendingEtapa,
  type PendingEtapaSeguiuSem,
} from "@/db/database";
import { aoSubirArquivoEtapa, enqueueEtapa, enqueueEtapaSeguiuSem, onSyncChange } from "./sync";
import {
  JANELA_DIAS_PADRAO,
  MAX_ARQUIVOS_ITEM,
  MOTIVOS_SEGUIR_SEM,
  TAMANHO_MAX_ARQUIVO,
  lerModeloEtapa,
  revalidarEtapasDaViagem,
  motivoParaServidor,
  type EtapasDaViagemServidor,
  type ExtraSimNao,
  type ItemEtapa,
  type ItemRespostaEnviado,
  type ModeloEtapa,
  type MotivoSeguirSem,
  type RespostaEtapaEnviada,
  type RespostaEtapaServidor,
} from "./etapas";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ViagemComEtapas = {
  viagemClientId: string;
  viagemId?: string | null;
  /** "Sorriso → Rondonópolis", "Cliente X" — pra ele reconhecer a viagem. */
  rotulo: string;
  placa?: string | null;
  /** GUIADA = Começar/Finalizar; LANCADA = "Lançar viagem feita" (depois do fato). */
  origem: "GUIADA" | "LANCADA";
  iniciadaEm: string;
  finalizadaEm?: string | null;
  /** Os formulários que valiam quando a viagem começou (a versão que ele viu). */
  modelos: ModeloEtapa[];
};

export type ArquivoRascunho = {
  id: string;
  /** Cópia em `documentDirectory` (ausente = arquivo que já estava no servidor). */
  uri?: string;
  mime: string;
  nome: string;
  tamanho?: number;
  /** Já subiu (pela fila deste celular, ou veio do servidor). */
  storageKey?: string;
  /** Id no servidor (arquivo que veio de outro celular) — pra mostrar a miniatura. */
  arquivoId?: string;
};

export type RespostaItem = {
  texto?: string;
  /** Como ele digitou (vírgula ou ponto). */
  numero?: string;
  valorCentavos?: number;
  /** `undefined`/null = não respondeu. Nada vem marcado. */
  simNao?: boolean | null;
  comentario?: string;
  assinaturaSvg?: string;
  assinanteNome?: string;
  arquivos: ArquivoRascunho[];
  /**
   * storageKeys de arquivos que JÁ tinham subido e ele apagou. O servidor
   * soma arquivos e só tira o que vier aqui (`arquivosRemovidos`).
   */
  removidos?: string[];
  alteradoEm?: string;
};

export type RascunhoEtapa = {
  clientId: string;
  viagemClientId: string;
  modelo: ModeloEtapa;
  iniciadaEm: string;
  alteradaEm: string;
  concluidaEm: string | null;
  incompleta: boolean;
  /** `alteradaEm` do último envio pra fila: igual = nada novo pra mandar. */
  enviadoEm?: string | null;
  itens: Record<string, RespostaItem>;
  lat?: number;
  lng?: number;
};

export type SeguiuSemLocal = {
  viagemClientId: string;
  modeloId: string;
  itemChave: string;
  motivo: MotivoSeguirSem;
  em: string;
};

type Estado = {
  viagens: ViagemComEtapas[];
  rascunhos: Record<string, RascunhoEtapa>;
  seguiuSem: SeguiuSemLocal[];
  /**
   * Itens que o ESCRITÓRIO resolveu (anexou ou dispensou), por formulário —
   * o que o servidor disse na última vez que deu pra perguntar.
   */
  resolvidos: Record<string, string[]>;
};

const CHAVE = "ronan.etapas.estado.v1";

// ---------------------------------------------------------------------------
// Persistência (uma chave, escrita em fila)
// ---------------------------------------------------------------------------

const ouvintes = new Set<() => void>();
export function onEtapasChange(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}
function avisar(): void {
  for (const fn of ouvintes) fn();
}

let memoria: { dono: string | null; estado: Estado } | null = null;
let fila: Promise<unknown> = Promise.resolve();

function vazio(): Estado {
  return { viagens: [], rascunhos: {}, seguiuSem: [], resolvidos: {} };
}

/**
 * Compat on-read: o que veio do disco passa pelo mesmo leitor total do
 * servidor. Formato antigo, campo renomeado ou lixo viram "nada" — nunca uma
 * tela quebrada no posto.
 */
function normalizar(raw: unknown): Estado {
  if (!raw || typeof raw !== "object") return vazio();
  const o = raw as Record<string, unknown>;
  const viagens: ViagemComEtapas[] = [];
  for (const v of Array.isArray(o.viagens) ? o.viagens : []) {
    if (!v || typeof v !== "object") continue;
    const x = v as Record<string, unknown>;
    if (typeof x.viagemClientId !== "string") continue;
    viagens.push({
      viagemClientId: x.viagemClientId,
      viagemId: typeof x.viagemId === "string" ? x.viagemId : null,
      rotulo: typeof x.rotulo === "string" ? x.rotulo : "Viagem",
      placa: typeof x.placa === "string" ? x.placa : null,
      origem: x.origem === "LANCADA" ? "LANCADA" : "GUIADA",
      iniciadaEm: typeof x.iniciadaEm === "string" ? x.iniciadaEm : new Date().toISOString(),
      finalizadaEm: typeof x.finalizadaEm === "string" ? x.finalizadaEm : null,
      modelos: (Array.isArray(x.modelos) ? x.modelos : [])
        .map(lerModeloEtapa)
        .filter((m): m is ModeloEtapa => !!m && m.momento !== "EVENTO"),
    });
  }
  const rascunhos: Record<string, RascunhoEtapa> = {};
  const rs = o.rascunhos && typeof o.rascunhos === "object" ? (o.rascunhos as Record<string, unknown>) : {};
  for (const [k, r] of Object.entries(rs)) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const modelo = lerModeloEtapa(x.modelo);
    if (!modelo || typeof x.clientId !== "string" || typeof x.viagemClientId !== "string") continue;
    const itens: Record<string, RespostaItem> = {};
    const brutos = x.itens && typeof x.itens === "object" ? (x.itens as Record<string, unknown>) : {};
    for (const [chave, it] of Object.entries(brutos)) {
      if (!it || typeof it !== "object") continue;
      const i = it as RespostaItem;
      itens[chave] = { ...i, arquivos: Array.isArray(i.arquivos) ? i.arquivos : [] };
    }
    rascunhos[k] = {
      clientId: x.clientId,
      viagemClientId: x.viagemClientId,
      modelo,
      iniciadaEm: typeof x.iniciadaEm === "string" ? x.iniciadaEm : new Date().toISOString(),
      alteradaEm: typeof x.alteradaEm === "string" ? x.alteradaEm : new Date().toISOString(),
      concluidaEm: typeof x.concluidaEm === "string" ? x.concluidaEm : null,
      incompleta: x.incompleta === true,
      enviadoEm: typeof x.enviadoEm === "string" ? x.enviadoEm : null,
      itens,
      lat: typeof x.lat === "number" ? x.lat : undefined,
      lng: typeof x.lng === "number" ? x.lng : undefined,
    };
  }
  const seguiuSem = (Array.isArray(o.seguiuSem) ? o.seguiuSem : []).filter(
    (s): s is SeguiuSemLocal =>
      !!s &&
      typeof s === "object" &&
      typeof (s as SeguiuSemLocal).viagemClientId === "string" &&
      typeof (s as SeguiuSemLocal).itemChave === "string",
  );
  const resolvidos: Record<string, string[]> = {};
  const rv = o.resolvidos && typeof o.resolvidos === "object" ? (o.resolvidos as Record<string, unknown>) : {};
  for (const [k, lista] of Object.entries(rv)) {
    if (Array.isArray(lista)) resolvidos[k] = lista.filter((x): x is string => typeof x === "string");
  }
  return { viagens, rascunhos, seguiuSem, resolvidos };
}

async function ler(): Promise<Estado> {
  const dono = await motoristaAtivoId();
  if (memoria && memoria.dono === dono) return memoria.estado;
  let estado = vazio();
  try {
    const raw = await storage.getItem(CHAVE);
    estado = normalizar(raw ? JSON.parse(raw) : null);
  } catch {
    estado = vazio();
  }
  // Enquanto lia o disco, uma gravação (`mudar`) pode ter terminado: a memória
  // dela é mais nova que o que acabou de ser lido. Trocar por esta leitura
  // apagaria a gravação na próxima escrita.
  if (memoria && memoria.dono === dono) return memoria.estado;
  memoria = { dono, estado };
  return estado;
}

/** Toda escrita passa em fila: dois toques seguidos não perdem um ao outro. */
function mudar<T>(fn: (e: Estado) => T | Promise<T>): Promise<T> {
  const p = fila.then(async () => {
    const dono = await motoristaAtivoId();
    const atual = await ler();
    const copia: Estado = {
      viagens: [...atual.viagens],
      rascunhos: { ...atual.rascunhos },
      seguiuSem: [...atual.seguiuSem],
      resolvidos: { ...atual.resolvidos },
    };
    const r = await fn(copia);
    memoria = { dono, estado: copia };
    try {
      await storage.setItem(CHAVE, JSON.stringify(copia));
    } catch {
      /* sem espaço: fica em memória até a próxima escrita */
    }
    avisar();
    return r;
  });
  fila = p.catch(() => {});
  return p;
}

export async function lerEstadoEtapas(): Promise<Estado> {
  return ler();
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function chaveRascunho(viagemClientId: string, modeloId: string): string {
  return `${viagemClientId}|${modeloId}`;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** O formulário ainda aceita resposta? (30 dias depois de finalizar, por padrão). */
export function dentroDaJanela(v: ViagemComEtapas, m: ModeloEtapa, agora = Date.now()): boolean {
  if (!v.finalizadaEm) return true;
  const fim = new Date(v.finalizadaEm).getTime();
  if (!Number.isFinite(fim)) return true;
  return agora <= fim + (m.janelaDias || JANELA_DIAS_PADRAO) * DIA_MS;
}

/**
 * O formulário já está "aberto" pra ele? INICIO desde o começo; FIM e AVULSA
 * depois de finalizar (a viagem lançada depois do fato já nasce finalizada).
 */
export function etapaDisponivel(v: ViagemComEtapas, m: ModeloEtapa): boolean {
  // O acerto do frete (AVULSA) pode ser feito a qualquer hora pelo botão na
  // viagem; só não COBRA (home) antes de a viagem acabar.
  if (m.momento === "INICIO" || m.momento === "AVULSA") return true;
  return !!v.finalizadaEm;
}

/** O que vale depois da resposta Sim/Não dada (nada respondido = nada). */
export function extraDaResposta(item: ItemEtapa, r: RespostaItem | undefined): ExtraSimNao | null {
  if (item.tipo !== "SIM_NAO" || r?.simNao == null) return null;
  return r.simNao ? item.simNao.aoSim : item.simNao.aoNao;
}

export function pedeFotosAgora(item: ItemEtapa, r: RespostaItem | undefined): boolean {
  if (item.tipo === "FOTO" || item.tipo === "ARQUIVO" || item.tipo === "TEXTO_FOTO") return true;
  const extra = extraDaResposta(item, r);
  return !!extra && extra.foto !== "NAO";
}

export function pedeComentarioAgora(item: ItemEtapa, r: RespostaItem | undefined): boolean {
  const extra = extraDaResposta(item, r);
  return !!extra && extra.comentario !== "NAO";
}

/**
 * O item está completo? A MESMA regra do servidor (`itemCompleto`):
 * FOTO/ARQUIVO → arquivos ≥ max(1, min); TEXTO_FOTO → texto + arquivos;
 * TEXTO → texto; VALOR/NUMERO → número; ASSINATURA → traço (+ nome se pede);
 * SIM_NAO → escolheu, e o extra EXIGE da resposta dada (foto/comentário).
 */
export function itemRespondido(item: ItemEtapa, r: RespostaItem | undefined): boolean {
  if (!r) return false;
  const nArq = r.arquivos?.length ?? 0;
  switch (item.tipo) {
    case "FOTO":
    case "ARQUIVO":
      return nArq >= Math.max(1, item.fotos.min);
    case "TEXTO":
      return !!r.texto?.trim();
    case "TEXTO_FOTO":
      return !!r.texto?.trim() && nArq >= Math.max(1, item.fotos.min);
    case "VALOR":
      return (r.valorCentavos ?? 0) > 0;
    case "NUMERO":
      return lerNumero(r.numero) != null;
    case "ASSINATURA":
      return !!r.assinaturaSvg && (!item.assinatura.pedeNome || (r.assinanteNome?.trim().length ?? 0) >= 2);
    case "SIM_NAO": {
      const extra = extraDaResposta(item, r);
      if (!extra) return false;
      if (extra.foto === "EXIGE" && nArq < 1) return false;
      if (extra.comentario === "EXIGE" && !r.comentario?.trim()) return false;
      return true;
    }
  }
}

/** "1.234,5" e "12.5" valem; lixo vira null. */
export function lerNumero(s: string | undefined): number | null {
  const t = s?.trim();
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export type Contagem = {
  feitos: number;
  total: number;
  /** Obrigatórios ainda sem resposta (só obrigatório vira "faltando"). */
  faltando: ItemEtapa[];
};

export function contar(
  modelo: ModeloEtapa,
  r: RascunhoEtapa | undefined,
  resolvidos: readonly string[] = [],
): Contagem {
  let feitos = 0;
  const faltando: ItemEtapa[] = [];
  for (const item of modelo.itens) {
    const ok = resolvidos.includes(item.chave) || itemRespondido(item, r?.itens[item.chave]);
    if (ok) feitos++;
    else if (item.obrigatorio) faltando.push(item);
  }
  return { feitos, total: modelo.itens.length, faltando };
}

// ---------------------------------------------------------------------------
// Viagens com documentos
// ---------------------------------------------------------------------------

/**
 * Anota a viagem com os formulários que valem AGORA. Só é chamado com a
 * função ligada — por isso o resto do app pode confiar nesta lista sem olhar
 * de novo a capacidade (que pode mudar depois).
 */
export async function registrarViagemComEtapas(v: ViagemComEtapas): Promise<void> {
  const modelos = v.modelos.filter((m) => m.momento !== "EVENTO");
  if (modelos.length === 0) return;
  await mudar((e) => {
    const i = e.viagens.findIndex((x) => x.viagemClientId === v.viagemClientId);
    if (i >= 0) {
      // Já anotada: não troca a versão que ele já viu.
      e.viagens[i] = { ...e.viagens[i]!, ...v, modelos: e.viagens[i]!.modelos };
    } else {
      e.viagens.push({ ...v, modelos });
    }
  });
}

export async function marcarViagemFinalizada(viagemClientId: string, em = new Date().toISOString()) {
  await mudar((e) => {
    const i = e.viagens.findIndex((x) => x.viagemClientId === viagemClientId);
    if (i >= 0) e.viagens[i] = { ...e.viagens[i]!, finalizadaEm: e.viagens[i]!.finalizadaEm ?? em };
  });
}

/** A viagem foi descartada: some tudo dela (os arquivos também). */
export async function esquecerEtapasDaViagem(viagemClientId: string): Promise<void> {
  const apagar: string[] = [];
  await mudar((e) => {
    e.viagens = e.viagens.filter((x) => x.viagemClientId !== viagemClientId);
    for (const [k, r] of Object.entries(e.rascunhos)) {
      if (r.viagemClientId !== viagemClientId) continue;
      for (const it of Object.values(r.itens)) for (const a of it.arquivos) if (a.uri) apagar.push(a.uri);
      delete e.rascunhos[k];
    }
    e.seguiuSem = e.seguiuSem.filter((s) => s.viagemClientId !== viagemClientId);
    for (const k of Object.keys(e.resolvidos)) {
      if (k.startsWith(`${viagemClientId}|`)) delete e.resolvidos[k];
    }
  });
  for (const uri of apagar) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/**
 * Faxina: viagem fora da janela de TODOS os formulários sai da lista, e os
 * arquivos dela saem do aparelho — mas só depois que nada dela está na fila.
 */
export async function limparEtapasVencidas(): Promise<void> {
  const naFila = new Set((await listPendingEtapas()).map((p) => p.viagemClientId));
  const estado = await ler();
  const agora = Date.now();
  const vencidas = estado.viagens.filter(
    (v) =>
      !!v.finalizadaEm &&
      !naFila.has(v.viagemClientId) &&
      v.modelos.every((m) => !dentroDaJanela(v, m, agora - DIA_MS)),
  );
  for (const v of vencidas) await esquecerEtapasDaViagem(v.viagemClientId);
}

// ---------------------------------------------------------------------------
// Rascunho
// ---------------------------------------------------------------------------

export async function pegarRascunho(
  viagemClientId: string,
  modeloId: string,
): Promise<RascunhoEtapa | null> {
  const e = await ler();
  return e.rascunhos[chaveRascunho(viagemClientId, modeloId)] ?? null;
}

/**
 * O rascunho deste formulário — criado agora se ainda não existe. Se o
 * servidor já tem a resposta (outro celular), o rascunho nasce dela.
 */
export async function abrirRascunho(
  viagem: ViagemComEtapas,
  modelo: ModeloEtapa,
  servidor?: RespostaEtapaServidor | null,
): Promise<RascunhoEtapa> {
  return mudar((e) => {
    const k = chaveRascunho(viagem.viagemClientId, modelo.id);
    const existente = e.rascunhos[k];
    if (existente) return existente;
    const agora = new Date().toISOString();
    const novo: RascunhoEtapa = {
      clientId: servidor?.clientId ?? novoId(),
      viagemClientId: viagem.viagemClientId,
      modelo,
      iniciadaEm: agora,
      alteradaEm: agora,
      concluidaEm: servidor?.concluidaEm ?? null,
      incompleta: false,
      // Veio do servidor = nada novo pra mandar.
      enviadoEm: servidor ? agora : null,
      itens: servidor ? itensDoServidor(servidor) : {},
    };
    e.rascunhos[k] = novo;
    return novo;
  });
}

function itensDoServidor(r: RespostaEtapaServidor): Record<string, RespostaItem> {
  const saida: Record<string, RespostaItem> = {};
  for (const i of r.itens) {
    saida[i.chave] = {
      texto: i.texto ?? undefined,
      numero: i.numero != null ? String(i.numero).replace(".", ",") : undefined,
      valorCentavos: i.valor != null ? Math.round(i.valor * 100) : undefined,
      simNao: i.simNao,
      comentario: i.comentario ?? undefined,
      assinaturaSvg: i.assinatura ?? undefined,
      assinanteNome: i.assinanteNome ?? undefined,
      arquivos: i.arquivos.map((a) => ({
        id: `srv-${a.id}`,
        arquivoId: a.id,
        storageKey: a.storageKey,
        mime: a.mime,
        nome: a.nome ?? "arquivo",
      })),
    };
  }
  return saida;
}

/** Grava a resposta de UM item na hora (sem botão Salvar). */
export async function salvarItem(
  viagemClientId: string,
  modeloId: string,
  itemChave: string,
  mudanca: (atual: RespostaItem) => RespostaItem,
): Promise<RascunhoEtapa | null> {
  const apagarDoDisco: string[] = [];
  const r = await mudar((e) => {
    const k = chaveRascunho(viagemClientId, modeloId);
    const atual = e.rascunhos[k];
    if (!atual) return null;
    const antes = atual.itens[itemChave] ?? { arquivos: [] };
    const depois = mudanca({ ...antes, arquivos: [...antes.arquivos] });
    const removidos = [...(depois.removidos ?? antes.removidos ?? [])];
    for (const a of antes.arquivos) {
      if (depois.arquivos.some((x) => x.id === a.id)) continue;
      if (a.uri) apagarDoDisco.push(a.uri);
      // Já tinha subido: o servidor só tira se a gente disser.
      if (a.storageKey && !removidos.includes(a.storageKey)) removidos.push(a.storageKey);
    }
    const agora = new Date().toISOString();
    const novo: RascunhoEtapa = {
      ...atual,
      alteradaEm: agora,
      itens: {
        ...atual.itens,
        [itemChave]: { ...depois, removidos: removidos.slice(-MAX_ARQUIVOS_ITEM), alteradoEm: agora },
      },
    };
    e.rascunhos[k] = novo;
    return novo;
  });
  // O arquivo tirado do rascunho só sai do disco se a fila não precisa dele.
  if (apagarDoDisco.length > 0) {
    const naFila = await listPendingEtapas();
    const emUso = new Set(naFila.flatMap((p) => p.arquivos.map((a) => a.uri).filter(Boolean)));
    for (const uri of apagarDoDisco) {
      if (!emUso.has(uri)) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
  return r;
}

/**
 * A fila avisa quando um arquivo SOBE: a storageKey vai pro rascunho (é ela
 * que permite apagar depois). Se ele já tinha apagado o arquivo enquanto
 * subia, a chave entra direto nos removidos e a resposta volta pra fila.
 */
async function guardarChaveSubida(e: {
  clientId: string;
  itemChave: string;
  arquivoId: string;
  storageKey: string;
}): Promise<void> {
  let reenviar: { viagemClientId: string; modeloId: string } | null = null;
  await mudar((est) => {
    const k = Object.keys(est.rascunhos).find((x) => est.rascunhos[x]!.clientId === e.clientId);
    if (!k) return;
    const r = est.rascunhos[k]!;
    const item = r.itens[e.itemChave];
    if (!item) return;
    if (item.arquivos.some((a) => a.id === e.arquivoId)) {
      est.rascunhos[k] = {
        ...r,
        itens: {
          ...r.itens,
          [e.itemChave]: {
            ...item,
            arquivos: item.arquivos.map((a) => (a.id === e.arquivoId ? { ...a, storageKey: e.storageKey } : a)),
          },
        },
      };
    } else {
      const agora = new Date().toISOString();
      const removidos = [...(item.removidos ?? []), e.storageKey].slice(-MAX_ARQUIVOS_ITEM);
      est.rascunhos[k] = {
        ...r,
        alteradaEm: agora,
        itens: { ...r.itens, [e.itemChave]: { ...item, removidos, alteradoEm: agora } },
      };
      reenviar = { viagemClientId: r.viagemClientId, modeloId: r.modelo.id };
    }
  });
  const alvo = reenviar as { viagemClientId: string; modeloId: string } | null;
  if (alvo) await enviarRascunho(alvo.viagemClientId, alvo.modeloId);
}

aoSubirArquivoEtapa((e) => {
  void guardarChaveSubida(e).catch(() => {});
});

export async function marcarConcluida(
  viagemClientId: string,
  modeloId: string,
  incompleta: boolean,
  gps?: { lat: number; lng: number } | null,
): Promise<RascunhoEtapa | null> {
  return mudar((e) => {
    const k = chaveRascunho(viagemClientId, modeloId);
    const atual = e.rascunhos[k];
    if (!atual) return null;
    const agora = new Date().toISOString();
    const novo: RascunhoEtapa = {
      ...atual,
      alteradaEm: agora,
      concluidaEm: agora,
      incompleta,
      lat: gps?.lat ?? atual.lat,
      lng: gps?.lng ?? atual.lng,
    };
    e.rascunhos[k] = novo;
    return novo;
  });
}

/** Volta a resposta concluída pra edição ("Corrigir"). */
export async function reabrirParaCorrigir(viagemClientId: string, modeloId: string) {
  await mudar((e) => {
    const k = chaveRascunho(viagemClientId, modeloId);
    const atual = e.rascunhos[k];
    if (atual) e.rascunhos[k] = { ...atual, concluidaEm: null };
  });
}

/**
 * Copia o arquivo pra `documentDirectory` ANTES de entrar no rascunho: a
 * câmera e o seletor gravam em `Caches/`, que o iOS esvazia sob pressão — e o
 * documento pode esperar dias por sinal. PDF sobe como está (só imagem é
 * comprimida, e isso já acontece na câmera); teto de 10 MB.
 *
 * Devolve `null` + motivo quando não dá pra usar o arquivo.
 */
export async function guardarArquivo(a: {
  uri: string;
  mime: string;
  nome?: string;
  tamanho?: number;
}): Promise<{ ok: true; arquivo: ArquivoRascunho } | { ok: false; motivo: string }> {
  let tamanho = a.tamanho;
  try {
    const info = await FileSystem.getInfoAsync(a.uri);
    if (info.exists && "size" in info && typeof info.size === "number") tamanho = info.size;
  } catch {
    /* sem info: segue com o que veio */
  }
  if (tamanho != null && tamanho > TAMANHO_MAX_ARQUIVO) {
    return {
      ok: false,
      motivo: "Esse arquivo passa de 10 MB. Tire uma foto da tela do documento no lugar dele.",
    };
  }
  const ehPdf = a.mime.includes("pdf");
  const ext = ehPdf ? "pdf" : a.mime.includes("png") ? "png" : a.mime.includes("webp") ? "webp" : "jpg";
  const id = novoId();
  // Nome novo a cada arquivo: o cache de <Image> guarda por CAMINHO.
  const destino = `${FileSystem.documentDirectory}etapa-${id}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: a.uri, to: destino });
  } catch {
    return { ok: false, motivo: "Não deu pra guardar o arquivo no celular. Tente de novo." };
  }
  return {
    ok: true,
    arquivo: {
      id,
      uri: destino,
      mime: a.mime,
      nome: a.nome ?? (ehPdf ? "documento.pdf" : `foto.${ext}`),
      tamanho,
    },
  };
}

// ---------------------------------------------------------------------------
// Envio pra fila
// ---------------------------------------------------------------------------

function vazio2(s: string | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/**
 * O item como vai no POST. Só os campos do TIPO, e com `null` explícito no
 * que está vazio: "Campo ausente: fica; null: limpa" — ele apagou o texto ou
 * trocou Sim por Não, e o escritório tem que ver isso.
 */
function itemEnviado(item: ItemEtapa, r: RespostaItem): ItemRespostaEnviado {
  const saida: ItemRespostaEnviado = {
    chave: item.chave,
    arquivos: [],
    arquivosRemovidos: r.removidos ?? [],
    respondidoEm: r.alteradoEm ?? new Date().toISOString(),
  };
  switch (item.tipo) {
    case "TEXTO":
    case "TEXTO_FOTO":
      saida.texto = vazio2(r.texto);
      break;
    case "NUMERO":
      saida.numero = lerNumero(r.numero);
      break;
    case "VALOR":
      saida.valor = (r.valorCentavos ?? 0) > 0 ? r.valorCentavos! / 100 : null;
      break;
    case "SIM_NAO":
      saida.simNao = r.simNao ?? null;
      saida.comentario = pedeComentarioAgora(item, r) ? vazio2(r.comentario) : null;
      break;
    case "ASSINATURA":
      saida.assinatura = r.assinaturaSvg || null;
      saida.assinanteNome = item.assinatura.pedeNome ? vazio2(r.assinanteNome) : null;
      break;
    default:
      break;
  }
  return saida;
}

/**
 * Manda o rascunho pra fila (coalescida: substitui o que estava lá). Chamado
 * quando ele sai da tela, conclui ou o app vai pro fundo. Nada novo desde o
 * último envio = não faz nada.
 */
export async function enviarRascunho(
  viagemClientId: string,
  modeloId: string,
  opts?: { forcar?: boolean },
): Promise<void> {
  // Espera as gravações em andamento: o último toque antes de sair da tela
  // tem que ir junto.
  await fila.catch(() => {});
  const estado = await ler();
  const r = estado.rascunhos[chaveRascunho(viagemClientId, modeloId)];
  if (!r) return;
  if (!opts?.forcar && r.enviadoEm === r.alteradaEm) return;
  const viagem = estado.viagens.find((v) => v.viagemClientId === viagemClientId);

  const itens: ItemRespostaEnviado[] = [];
  const arquivos: ArquivoEtapaPendente[] = [];
  for (const item of r.modelo.itens) {
    const resp = r.itens[item.chave];
    // Item que ele nem tocou não vai (ausente = "fica como está").
    if (!resp?.alteradoEm) continue;
    const enviado = itemEnviado(item, resp);
    // Os arquivos que valem pra resposta de AGORA (Sim virou Não e o Não não
    // pede foto → as fotos do Sim não vão; as que já tinham subido saem).
    if (pedeFotosAgora(item, resp)) {
      for (const a of resp.arquivos) {
        arquivos.push({
          id: a.id,
          itemChave: item.chave,
          uri: a.uri,
          mime: a.mime,
          nome: a.nome,
          tamanho: a.tamanho,
          storageKey: a.storageKey,
          arquivoId: a.arquivoId,
        });
      }
    } else {
      const sobem = resp.arquivos.map((a) => a.storageKey).filter((k): k is string => !!k);
      enviado.arquivosRemovidos = [...new Set([...enviado.arquivosRemovidos, ...sobem])].slice(
        -MAX_ARQUIVOS_ITEM,
      );
    }
    itens.push(enviado);
  }
  // Nunca mexeu em nada e não concluiu: não há o que mandar (a pendência
  // existe no servidor mesmo assim — resposta inexistente = tudo faltando).
  if (itens.length === 0 && !r.concluidaEm) return;

  const payload: RespostaEtapaEnviada = {
    clientId: r.clientId,
    viagemClientId,
    modeloId: r.modelo.id,
    versaoId: r.modelo.versaoId,
    itens,
    ...(r.concluidaEm ? { concluida: true, concluidaEm: r.concluidaEm } : {}),
    iniciadaEm: r.iniciadaEm,
    criadoOfflineEm: r.iniciadaEm,
    ...(r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : {}),
  };
  const c = contar(r.modelo, r, estado.resolvidos[chaveRascunho(viagemClientId, modeloId)]);
  await enqueueEtapa({
    clientId: r.clientId,
    viagemClientId,
    modeloId: r.modelo.id,
    payload: payload as unknown as Record<string, unknown>,
    arquivos,
    resumo: {
      modeloNome: r.modelo.nome,
      viagemRotulo: viagem?.rotulo ?? null,
      itensRespondidos: c.feitos,
      itensTotal: c.total,
    },
  });
  await mudar((e) => {
    const k = chaveRascunho(viagemClientId, modeloId);
    const atual = e.rascunhos[k];
    if (atual && atual.alteradaEm === r.alteradaEm) e.rascunhos[k] = { ...atual, enviadoEm: r.alteradaEm };
  });
}

// ---------------------------------------------------------------------------
// "Seguir sem isso"
// ---------------------------------------------------------------------------

export async function registrarSeguiuSem(s: {
  viagemClientId: string;
  modeloId: string;
  item: ItemEtapa;
  motivo: MotivoSeguirSem;
  motivoTexto?: string;
  acao: "FINALIZAR" | "INICIAR";
  gps?: { lat: number; lng: number } | null;
}): Promise<void> {
  const em = new Date().toISOString();
  await mudar((e) => {
    e.seguiuSem = e.seguiuSem.filter(
      (x) => !(x.viagemClientId === s.viagemClientId && x.modeloId === s.modeloId && x.itemChave === s.item.chave),
    );
    e.seguiuSem.push({
      viagemClientId: s.viagemClientId,
      modeloId: s.modeloId,
      itemChave: s.item.chave,
      motivo: s.motivo,
      em,
    });
  });
  const label = MOTIVOS_SEGUIR_SEM.find((m) => m.value === s.motivo)?.label ?? "Outro";
  const codigo = motivoParaServidor(s.motivo, s.motivoTexto);
  await enqueueEtapaSeguiuSem({
    payload: {
      clientId: novoId(),
      viagemClientId: s.viagemClientId,
      modeloId: s.modeloId,
      itens: [s.item.chave],
      motivoCodigo: codigo.motivoCodigo,
      ...(codigo.motivoTexto ? { motivoTexto: codigo.motivoTexto } : {}),
      acao: s.acao === "INICIAR" ? "INICIAR_PROXIMA" : "FINALIZAR",
      ocorridoEm: em,
      ...(s.gps ? { lat: s.gps.lat, lng: s.gps.lng } : {}),
    },
    resumo: {
      itemRotulo: s.item.rotulo,
      motivoLabel: s.motivo === "OUTRO" && s.motivoTexto?.trim() ? s.motivoTexto.trim() : label,
    },
  });
}


// ---------------------------------------------------------------------------
// Barreira ("O escritório precisa deste documento")
// ---------------------------------------------------------------------------

export type ItemBarreira = {
  viagem: ViagemComEtapas;
  modelo: ModeloEtapa;
  item: ItemEtapa;
};

/**
 * Os itens "não seguir viagem sem este" que faltam ANTES da próxima ação.
 * - FINALIZAR: os da carga (INICIO) desta viagem.
 * - INICIAR: os da descarga e do acerto (FIM, AVULSA) da viagem anterior
 *   (a última finalizada, dentro da janela).
 * Já explicado ("seguiu sem") não pergunta de novo.
 */
export function itensDaBarreira(
  estado: Estado,
  acao: "FINALIZAR" | "INICIAR",
  viagemClientIdAtual?: string | null,
): ItemBarreira[] {
  let viagem: ViagemComEtapas | undefined;
  let momentos: ModeloEtapa["momento"][];
  if (acao === "FINALIZAR") {
    viagem = estado.viagens.find((v) => v.viagemClientId === viagemClientIdAtual);
    momentos = ["INICIO"];
  } else {
    viagem = [...estado.viagens]
      .filter((v) => !!v.finalizadaEm && v.viagemClientId !== viagemClientIdAtual)
      .sort((a, b) => (b.finalizadaEm ?? "").localeCompare(a.finalizadaEm ?? ""))[0];
    momentos = ["FIM", "AVULSA"];
  }
  if (!viagem) return [];
  const saida: ItemBarreira[] = [];
  for (const modelo of viagem.modelos) {
    if (!momentos.includes(modelo.momento)) continue;
    if (!dentroDaJanela(viagem, modelo)) continue;
    const k = chaveRascunho(viagem.viagemClientId, modelo.id);
    const r = estado.rascunhos[k];
    const resolvidos = estado.resolvidos[k] ?? [];
    for (const item of modelo.itens) {
      if (item.seFaltar !== "NAO_SEGUIR" || !item.obrigatorio) continue;
      if (resolvidos.includes(item.chave)) continue;
      if (itemRespondido(item, r?.itens[item.chave])) continue;
      const explicou = estado.seguiuSem.some(
        (s) => s.viagemClientId === viagem!.viagemClientId && s.modeloId === modelo.id && s.itemChave === item.chave,
      );
      if (explicou) continue;
      saida.push({ viagem, modelo, item });
    }
  }
  return saida;
}

/**
 * Com sinal, confere no servidor antes de mostrar: se o escritório já anexou
 * ou dispensou, o cartão nem aparece. Sem sinal (ou demorou), vale o celular.
 */
export async function revalidarBarreira(itens: ItemBarreira[]): Promise<ItemBarreira[]> {
  if (itens.length === 0) return itens;
  const porViagem = new Map<string, EtapasDaViagemServidor | null>();
  for (const id of new Set(itens.map((i) => i.viagem.viagemClientId))) {
    porViagem.set(id, await revalidarEtapasDaViagem(id));
  }
  for (const [id, srv] of porViagem) if (srv) await aplicarServidor(id, srv);
  return itens.filter((i) => {
    const srv = porViagem.get(i.viagem.viagemClientId);
    if (!srv) return true;
    const p = srv.pendencias.find((x) => x.modeloId === i.modelo.id && x.itemChave === i.item.chave);
    return !p || p.situacao === "FALTANDO";
  });
}

/**
 * Guarda o que o servidor disse sobre a viagem: itens que o escritório anexou
 * ou dispensou deixam de contar como faltando aqui também (home, cartão,
 * barreira) — inclusive sem sinal, depois.
 */
export async function aplicarServidor(
  viagemClientId: string,
  srv: EtapasDaViagemServidor,
): Promise<void> {
  const porModelo = new Map<string, string[]>();
  for (const p of srv.pendencias) {
    if (p.situacao !== "ANEXADO_ESCRITORIO" && p.situacao !== "DISPENSADO") continue;
    const lista = porModelo.get(p.modeloId) ?? [];
    lista.push(p.itemChave);
    porModelo.set(p.modeloId, lista);
  }
  await mudar((e) => {
    const viagem = e.viagens.find((v) => v.viagemClientId === viagemClientId);
    if (!viagem) return;
    for (const m of viagem.modelos) {
      const k = chaveRascunho(viagemClientId, m.id);
      const novos = porModelo.get(m.id) ?? [];
      if (novos.length > 0) e.resolvidos[k] = novos;
      else delete e.resolvidos[k];
    }
  });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** O estado inteiro, reativo (muda ao gravar e ao subir algo da fila). */
export function useEstadoEtapas(): Estado | null {
  const [estado, setEstado] = useState<Estado | null>(null);
  useEffect(() => {
    let vivo = true;
    const carregar = () => {
      void ler().then((e) => {
        if (vivo) setEstado(e);
      });
    };
    carregar();
    const a = onEtapasChange(carregar);
    return () => {
      vivo = false;
      a();
    };
  }, []);
  return estado;
}

/** A fila de respostas, reativa (pra o selo "na fila" das miniaturas). */
export function usePendingEtapas(): PendingEtapa[] {
  const [itens, setItens] = useState<PendingEtapa[]>([]);
  useEffect(() => {
    let vivo = true;
    const carregar = () => {
      void listPendingEtapas().then((l) => {
        if (vivo) setItens(l);
      });
    };
    carregar();
    const off = onSyncChange(carregar);
    return () => {
      vivo = false;
      off();
    };
  }, []);
  return itens;
}

/** A fila de "seguiu sem", reativa (tela de Pendentes). */
export function usePendingEtapasSeguiuSem(): PendingEtapaSeguiuSem[] {
  const [itens, setItens] = useState<PendingEtapaSeguiuSem[]>([]);
  useEffect(() => {
    let vivo = true;
    const carregar = () => {
      void listPendingEtapasSeguiuSem().then((l) => {
        if (vivo) setItens(l);
      });
    };
    carregar();
    const off = onSyncChange(carregar);
    return () => {
      vivo = false;
      off();
    };
  }, []);
  return itens;
}

export type EtapaAberta = {
  viagem: ViagemComEtapas;
  modelo: ModeloEtapa;
  rascunho: RascunhoEtapa | undefined;
  contagem: Contagem;
};

/** Os formulários disponíveis agora, por viagem (o que o cartão e a home mostram). */
export function etapasAbertas(estado: Estado, viagemClientId?: string): EtapaAberta[] {
  const saida: EtapaAberta[] = [];
  for (const viagem of estado.viagens) {
    if (viagemClientId && viagem.viagemClientId !== viagemClientId) continue;
    for (const modelo of viagem.modelos) {
      if (!etapaDisponivel(viagem, modelo) || !dentroDaJanela(viagem, modelo)) continue;
      const k = chaveRascunho(viagem.viagemClientId, modelo.id);
      const rascunho = estado.rascunhos[k];
      saida.push({ viagem, modelo, rascunho, contagem: contar(modelo, rascunho, estado.resolvidos[k]) });
    }
  }
  return saida;
}

/** O que falta na home: só formulário com obrigatório faltando. */
export function useFaltandoHome(): { total: number; nomes: string[] } {
  const estado = useEstadoEtapas();
  return useMemo(() => {
    if (!estado) return { total: 0, nomes: [] };
    let total = 0;
    const nomes: string[] = [];
    for (const e of etapasAbertas(estado)) {
      // Acerto do frete com a viagem ainda rodando: ainda não é hora.
      if (e.modelo.momento === "AVULSA" && !e.viagem.finalizadaEm) continue;
      const n = e.contagem.faltando.length;
      if (n === 0) continue;
      total += n;
      if (!nomes.includes(e.modelo.nome)) nomes.push(e.modelo.nome);
    }
    return { total, nomes };
  }, [estado]);
}

/** Recarrega quando a tela volta ao foco (pra quem não assina mudanças). */
export function useRecarregarEtapas(): () => void {
  return useCallback(() => avisar(), []);
}
