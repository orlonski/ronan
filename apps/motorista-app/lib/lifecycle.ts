/**
 * Lifecycle guiado de viagem (Iniciar → eventos → Finalizar).
 *
 * - Espelho LOCAL (AsyncStorage) da viagem em andamento: fonte de verdade
 *   offline; o app renderiza a máquina de estados a partir dele + do catálogo.
 * - Máquina de estados: funções puras que, dado o catálogo e os eventos já
 *   registrados, dizem qual é o PRÓXIMO passo (botão primário) e os extras.
 * - Ações de alto nível: montam o payload e enfileiram no outbox (sync.ts).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FonteGps, KmFonte, TipoEventoViagem, TrechoViagemInput } from "@ronan/shared-types";
import {
  listPendingEventosViagem,
  listPendingViagemCancelar,
  listPendingViagemFinalizar,
  listPendingViagemIniciar,
} from "@/db/database";
import { api } from "./api";
import { reportarEvento } from "./event-reporter";
import {
  enqueueEventoViagem,
  enqueueViagemCancelar,
  enqueueViagemFinalizar,
  enqueueViagemIniciar,
  enqueueLocal,
  removerItensLifecycleDaViagem,
} from "./sync";

export type LocalSnapshotLifecycle = { nome: string; lat: number; lng: number };

/** Evento já registrado localmente (espelho pra UI offline). */
export type EventoLocal = {
  id: string;
  tipoSlug: string;
  nome: string;
  ocorridoEm: string; // ISO
  localNome?: string;
};

/** Rascunho da tela de finalizar (persistido pra não perder ao voltar/sair). */
export type FinalizarDraft = {
  localDescargaId?: string;
  descargaNome?: string;
  /** Quando o motorista marcou a descarga (ISO). Pra mostrar data/hora no
   * espelho da viagem em andamento, igual à carga. */
  descargaEm?: string;
  descargaCaptura?: {
    lat: number;
    lng: number;
    precisao: number | null;
    fonte?: FonteGps;
    raioUsadoM?: number;
    distanciaMetros: number | null;
    buscaOffline: boolean;
  } | null;
  materialId?: string;
  toneladas?: string;
  ticket?: string;
  km?: string;
  kmEditadoManual?: boolean;
  /** Bota-fora (limpeza): motorista voltou pro local de carga. */
  teveBotaFora?: boolean;
  /** Polyline da rota escolhida no seletor de mapa (rota real p/ o painel). */
  rotaGeometria?: string;
  /** Índice da rota escolhida entre as alternativas (restaura o seletor). */
  rotaIdx?: number;
  valorPedagio?: string;
  observacao?: string;
  fotoUri?: string;
  fotoMime?: string;
};

/** Viagem em andamento no espelho local. */
export type LifecycleLocal = {
  clientId: string;
  veiculoId: string;
  clienteId: string;
  clienteNome?: string;
  iniciadoEm: string; // ISO
  localCargaId?: string;
  localCargaNome?: string;
  finalizarDraft?: FinalizarDraft;
  eventos: EventoLocal[];
};

const KEY = "ronan.viagem-lifecycle";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Espelho local ----

export async function getLifecycleLocal(): Promise<LifecycleLocal | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LifecycleLocal) : null;
  } catch {
    return null;
  }
}

async function setLifecycleLocal(v: LifecycleLocal): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(v));
}

export async function clearLifecycleLocal(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/**
 * Salva o rascunho da tela de finalizar no espelho local (merge). Sobrevive a
 * voltar/reabrir/sair do app; limpo junto com clearLifecycleLocal no fim.
 */
export async function salvarFinalizarDraft(draft: FinalizarDraft): Promise<void> {
  const atual = await getLifecycleLocal();
  if (!atual) return;
  await setLifecycleLocal({ ...atual, finalizarDraft: draft });
}

/**
 * Descarta a viagem em andamento: limpa a fila local (iniciar/eventos/
 * finalizar), enfileira o cancelamento no servidor (idempotente) e apaga o
 * espelho local. Resolve o caso do 409 "já tem viagem em andamento".
 */
export async function descartarViagemGuiada(clientId: string): Promise<void> {
  await removerItensLifecycleDaViagem(clientId);
  await enqueueViagemCancelar(clientId);
  const atual = await getLifecycleLocal();
  if (!atual || atual.clientId === clientId) {
    await clearLifecycleLocal();
  }
}

/**
 * Auto-limpa a "casca órfã": uma viagem EM_ANDAMENTO no servidor que o motorista
 * abandonou logo depois de tocar "Iniciar" — 0 eventos, e que o device não está
 * mais tocando (não é o espelho local nem tem nada no outbox). Essa casca ocupa
 * a vaga de "1 em andamento por motorista" e trava o envio de TODAS as viagens
 * guiadas novas (que tomam 409). Aqui ela é cancelada no servidor (idempotente),
 * liberando a vaga — o backlog do outbox drena sozinho depois.
 *
 * Só age em casca de **0 eventos** (começo abandonado, sem nada a perder). Uma
 * viagem com eventos reais tem progresso → NÃO é apagada; segue pro "Retomar"
 * normal via hidratarViagemDoServidor.
 *
 * Best-effort e silencioso: chamado ao focar a Home (com podeViagemLifecycle).
 */
export async function autoLimparCascaOrfa(): Promise<void> {
  try {
    const resp = await api.get<ServerAndamento>("/m/viagem/andamento");
    const v = resp?.viagem ?? null;
    if (!v) return;
    // É a viagem que o motorista está tocando agora? Então não é órfã.
    const atual = await getLifecycleLocal();
    if (atual?.clientId === v.clientId) return;
    // Tem algo dela no outbox (offline/erro)? Deixa o fluxo normal cuidar.
    if (await lifecycleTemPendentes(v.clientId)) return;
    // Tem evento real = progresso; não apaga (vira "Retomar").
    if ((v.eventosViagem?.length ?? 0) > 0) return;
    // Casca vazia bloqueando a vaga → cancela no servidor.
    await enqueueViagemCancelar(v.clientId);
    void reportarEvento(
      "viagem_guiada_casca_orfa_limpa",
      { iniciadoEm: v.iniciadoEm, localCargaId: v.localCarga?.id },
      { viagemClientId: v.clientId },
    );
  } catch {
    // Offline / erro de rede: tenta no próximo foco.
  }
}

// Forma da resposta de GET /m/viagem/andamento (só o que usamos aqui).
type ServerAndamento = {
  viagem: {
    clientId: string;
    veiculoId: string;
    clienteId: string | null;
    cliente: { id: string; nome: string } | null;
    iniciadoEm: string | null;
    localCarga: { id: string; nome: string } | null;
    eventosViagem: { id: string; tipoSlug: string; ocorridoEm: string }[];
  } | null;
};

/**
 * Itens desse ciclo ainda no outbox (offline OU com erro): finalizar/cancelar/
 * iniciar/eventos. Enquanto houver qualquer um, a fonte de verdade é o
 * LOCAL/outbox — não deixamos o servidor mandar no espelho (nem pra ressuscitar
 * nem pra apagar). Cobre: viagem offline em curso E viagem sendo fechada (o
 * finalize/cancel pendente NÃO pode reabrir o "Retomar").
 */
async function lifecycleTemPendentes(clientId: string): Promise<boolean> {
  const [fin, can, ini, ev] = await Promise.all([
    listPendingViagemFinalizar(),
    listPendingViagemCancelar(),
    listPendingViagemIniciar(),
    listPendingEventosViagem(),
  ]);
  return (
    fin.some((x) => x.clientId === clientId) ||
    can.some((x) => x.clientId === clientId) ||
    ini.some((x) => x.clientId === clientId) ||
    ev.some((x) => x.viagemClientId === clientId)
  );
}

/**
 * Reconciliação bidirecional entre o espelho local e o servidor:
 * - Espelho vazio + servidor tem viagem EM_ANDAMENTO (órfã) → reconstrói pra o
 *   motorista poder retomar/descartar — a menos que haja finalize/cancel
 *   pendente dessa viagem (ela está sendo fechada; não reabrir o "Retomar").
 * - Espelho presente SEM pendências no outbox → valida contra o servidor: se ele
 *   não tem mais essa viagem EM_ANDAMENTO (finalizou, virou aguardando peso ou
 *   foi cancelada), o espelho é FANTASMA → limpa.
 * - Espelho presente COM pendências → viagem em curso (talvez offline): mantém,
 *   nem consulta o servidor. Best-effort: offline mantém o que tem.
 */
export async function hidratarViagemDoServidor(): Promise<LifecycleLocal | null> {
  const atual = await getLifecycleLocal();

  // Tem pendência no outbox = fonte de verdade é o local. Nem toca no servidor.
  if (atual && (await lifecycleTemPendentes(atual.clientId))) return atual;

  try {
    const resp = await api.get<ServerAndamento>("/m/viagem/andamento");
    const v = resp?.viagem ?? null;

    // Espelho presente (e sem pendências): valida contra o servidor.
    if (atual) {
      if (v && v.clientId === atual.clientId) return atual; // ainda EM_ANDAMENTO
      await clearLifecycleLocal(); // fantasma → limpa
      return null;
    }

    // Espelho vazio: reconstrói do servidor, exceto se essa viagem está sendo
    // fechada (finalize/cancel pendente) — senão o banner "Retomar" reabria.
    if (!v) return null;
    if (await lifecycleTemPendentes(v.clientId)) return null;
    const novo: LifecycleLocal = {
      clientId: v.clientId,
      veiculoId: v.veiculoId,
      clienteId: v.clienteId ?? "",
      clienteNome: v.cliente?.nome,
      iniciadoEm: v.iniciadoEm ?? nowIso(),
      localCargaId: v.localCarga?.id,
      localCargaNome: v.localCarga?.nome,
      eventos: (v.eventosViagem ?? []).map((e) => ({
        id: e.id,
        tipoSlug: e.tipoSlug,
        nome: e.tipoSlug,
        ocorridoEm: e.ocorridoEm,
      })),
    };
    await setLifecycleLocal(novo);
    return novo;
  } catch {
    // Offline / erro de rede: mantém o que já tínhamos (não arrisca sumir um
    // "Retomar" legítimo nem ressuscitar nada). Reconcilia no próximo online.
    return atual;
  }
}

// ---- Máquina de estados (puras) ----

/**
 * Tipos ativos ordenados pela sequência guiada.
 *
 * Carga e descarga são bookends FIXOS do app (carga = tela Iniciar; descarga =
 * tela Finalizar), não botões do meio da viagem — então os tipos ehCarga/
 * ehDescarga NUNCA entram na lista guiada, mesmo que existam no catálogo. O
 * catálogo guiado é só dos EXTRAS opcionais (parada, balança, abastecimento…).
 */
export function tiposOrdenados(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return [...catalogo]
    .filter((t) => t.ativo && !t.ehCarga && !t.ehDescarga)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

/** Espinha = tipos obrigatórios em ordem. */
export function espinha(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return tiposOrdenados(catalogo).filter((t) => t.obrigatorio);
}

/** Extras = tipos opcionais (botões secundários, disponíveis a qualquer hora). */
export function extras(catalogo: TipoEventoViagem[]): TipoEventoViagem[] {
  return tiposOrdenados(catalogo).filter((t) => !t.obrigatorio);
}

/**
 * Próximo passo obrigatório ainda não registrado (botão primário grande).
 * Retorna null quando todos os marcos foram feitos → pronto pra finalizar.
 */
export function proximoPassoObrigatorio(
  catalogo: TipoEventoViagem[],
  slugsRegistrados: string[],
): TipoEventoViagem | null {
  const feitos = new Set(slugsRegistrados);
  for (const t of espinha(catalogo)) {
    if (!feitos.has(t.slug)) return t;
  }
  return null;
}

export function prontoParaFinalizar(
  catalogo: TipoEventoViagem[],
  slugsRegistrados: string[],
): boolean {
  return proximoPassoObrigatorio(catalogo, slugsRegistrados) === null;
}

// ---- Ações de alto nível (montam payload + enfileiram + atualizam espelho) ----

/** Abre a viagem: cria localmente, enfileira o POST /iniciar. Retorna clientId. */
export async function iniciarViagemGuiada(input: {
  veiculoId: string;
  clienteId: string;
  clienteNome?: string;
  coords?: { lat: number; lng: number; precisao?: number; fonte?: FonteGps };
  localCarga?: { id: string; nome: string; lat?: number; lng?: number; criarOffline?: boolean };
  // Captura da escolha do local de carga: GPS REAL do motorista + distância/raio
  // até o local. Grava cargaLat/cargaLng/etc na Viagem (raio virou ordenação).
  cargaCaptura?: {
    gpsLat?: number;
    gpsLng?: number;
    precisao?: number | null;
    fonte?: FonteGps;
    distanciaMetros?: number | null;
    raioUsadoM?: number;
    buscaOffline?: boolean;
  };
}): Promise<string> {
  const clientId = uuid();
  const iniciadoEm = nowIso();
  const lc = input.localCarga;

  // Local de carga novo (lugar fora do cadastro): enfileira antes pro drain
  // criar o Local antes da viagem (ordem locais → lifecycle). Raro — a carga
  // normalmente já existe no cadastro.
  if (lc?.criarOffline && lc.lat != null && lc.lng != null) {
    await enqueueLocal({
      clientId: lc.id,
      payload: {
        nome: lc.nome,
        lat: lc.lat,
        lng: lc.lng,
        precisao: input.coords?.precisao,
        fonte: input.coords?.fonte,
        tipo: "CARGA",
      },
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
  }
  const localCargaDados: LocalSnapshotLifecycle | undefined =
    lc && lc.lat != null && lc.lng != null ? { nome: lc.nome, lat: lc.lat, lng: lc.lng } : undefined;

  await enqueueViagemIniciar({
    clientId,
    veiculoId: input.veiculoId,
    clienteId: input.clienteId,
    iniciadoEm,
    lat: input.coords?.lat,
    lng: input.coords?.lng,
    precisao: input.coords?.precisao,
    localCargaId: lc?.id,
    localCargaDados,
    criadoOfflineEm: iniciadoEm,
    // Captura do local de carga (espelha descarga*). Chaves extras no payload
    // fluem direto pro body de /m/viagem/iniciar (IniciarViagemInput).
    cargaLat: input.cargaCaptura?.gpsLat,
    cargaLng: input.cargaCaptura?.gpsLng,
    cargaPrecisao: input.cargaCaptura?.precisao ?? undefined,
    cargaFonte: input.cargaCaptura?.fonte,
    cargaDistanciaMetros: input.cargaCaptura?.distanciaMetros ?? undefined,
    cargaRaioUsadoM: input.cargaCaptura?.raioUsadoM,
    cargaBuscaOffline: input.cargaCaptura?.buscaOffline,
  });
  await setLifecycleLocal({
    clientId,
    veiculoId: input.veiculoId,
    clienteId: input.clienteId,
    clienteNome: input.clienteNome,
    iniciadoEm,
    localCargaId: lc?.id,
    localCargaNome: lc?.nome,
    eventos: [],
  });
  void reportarEvento(
    "viagem_guiada_iniciada",
    {
      localCargaId: lc?.id,
      cargaFonte: input.cargaCaptura?.fonte,
      cargaPrecisao: input.cargaCaptura?.precisao,
      cargaDistanciaMetros: input.cargaCaptura?.distanciaMetros,
      cargaBuscaOffline: input.cargaCaptura?.buscaOffline,
    },
    { viagemClientId: clientId },
  );
  return clientId;
}

/**
 * Registra um evento (carga/descarga/parada...) na viagem em andamento.
 * Se veio de um local criado offline, o caller já deve ter enfileirado o
 * local (enqueueLocal); aqui passamos localId + snapshot pra auto-recovery.
 */
export async function registrarEventoGuiado(input: {
  tipo: TipoEventoViagem;
  coords?: { lat: number; lng: number; precisao?: number; fonte?: FonteGps };
  raioUsadoM?: number;
  local?: { id: string; nome: string; lat?: number; lng?: number; criarOffline?: boolean };
  foto?: { uri: string; mime: string };
  toneladas?: number;
  valor?: number;
  ticket?: string;
  observacao?: string;
}): Promise<void> {
  const atual = await getLifecycleLocal();
  if (!atual) throw new Error("Nenhuma viagem em andamento.");

  const id = uuid();
  const ocorridoEm = nowIso();

  // Local criado offline (lugar novo): enfileira antes pro drain criar o Local
  // antes do evento (mesma ordem locais → lifecycle no drain).
  if (input.local?.criarOffline && input.local.lat != null && input.local.lng != null) {
    await enqueueLocal({
      clientId: input.local.id,
      payload: {
        nome: input.local.nome,
        lat: input.local.lat,
        lng: input.local.lng,
        precisao: input.coords?.precisao,
        fonte: input.coords?.fonte,
        tipo: input.tipo.ehDescarga ? "DESCARGA" : input.tipo.ehCarga ? "CARGA" : "AMBOS",
      },
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
  }

  const localDados: LocalSnapshotLifecycle | undefined =
    input.local && input.local.lat != null && input.local.lng != null
      ? { nome: input.local.nome, lat: input.local.lat, lng: input.local.lng }
      : undefined;

  await enqueueEventoViagem(
    atual.clientId,
    {
      id,
      tipoSlug: input.tipo.slug,
      ocorridoEm,
      lat: input.coords?.lat,
      lng: input.coords?.lng,
      precisao: input.coords?.precisao,
      fonte: input.coords?.fonte,
      raioUsadoM: input.raioUsadoM,
      localId: input.local?.id,
      localDados,
      toneladas: input.toneladas,
      valor: input.valor,
      ticket: input.ticket,
      observacao: input.observacao,
      criadoOfflineEm: ocorridoEm,
    },
    input.foto,
  );

  // Espelho local
  const eventos = [
    ...atual.eventos,
    { id, tipoSlug: input.tipo.slug, nome: input.tipo.nome, ocorridoEm, localNome: input.local?.nome },
  ];
  const patch: LifecycleLocal = { ...atual, eventos };
  if (input.tipo.ehCarga && input.local) {
    patch.localCargaId = input.local.id;
    patch.localCargaNome = input.local.nome;
  }
  await setLifecycleLocal(patch);
  void reportarEvento(
    "viagem_guiada_evento",
    {
      tipoSlug: input.tipo.slug,
      ehCarga: input.tipo.ehCarga,
      ehDescarga: input.tipo.ehDescarga,
      temFoto: !!input.foto,
      temToneladas: input.toneladas != null,
    },
    { viagemClientId: atual.clientId },
  );
}

/** Finaliza: enfileira o POST /finalizar e limpa o espelho local. */
export async function finalizarViagemGuiada(input: {
  clienteId: string;
  materialId: string;
  data: string; // ISO ou YYYY-MM-DD
  // Opcional no modo "aguardando peso" (romaneio no fim do dia).
  toneladas?: number;
  aguardandoPeso?: boolean;
  km: number;
  kmCalculado?: number;
  kmEditadoManual?: boolean;
  kmFonte?: KmFonte;
  justificativaKm?: string;
  rotaGeometria?: string;
  trechos?: TrechoViagemInput[];
  ticket?: string;
  localDescargaId: string;
  localDescargaDados?: LocalSnapshotLifecycle;
  descargaLat?: number;
  descargaLng?: number;
  descargaPrecisao?: number;
  descargaFonte?: FonteGps;
  descargaRaioUsadoM?: number;
  descargaDistanciaMetros?: number;
  valorPedagioTotal?: number;
  observacao?: string;
  foto?: { uri: string; mime: string };
}): Promise<void> {
  const atual = await getLifecycleLocal();
  if (!atual) throw new Error("Nenhuma viagem em andamento.");

  await enqueueViagemFinalizar(
    atual.clientId,
    {
      clienteId: input.clienteId,
      materialId: input.materialId,
      data: input.data,
      toneladas: input.toneladas,
      aguardandoPeso: input.aguardandoPeso,
      km: input.km,
      kmCalculado: input.kmCalculado,
      kmEditadoManual: input.kmEditadoManual,
      kmFonte: input.kmFonte,
      justificativaKm: input.justificativaKm,
      rotaGeometria: input.rotaGeometria,
      trechos: input.trechos,
      ticket: input.ticket,
      localDescargaId: input.localDescargaId,
      localDescargaDados: input.localDescargaDados,
      descargaLat: input.descargaLat,
      descargaLng: input.descargaLng,
      descargaPrecisao: input.descargaPrecisao,
      descargaFonte: input.descargaFonte,
      descargaRaioUsadoM: input.descargaRaioUsadoM,
      descargaDistanciaMetros: input.descargaDistanciaMetros,
      valorPedagioTotal: input.valorPedagioTotal,
      observacao: input.observacao,
    },
    input.foto,
  );
  void reportarEvento(
    "viagem_guiada_finalizada",
    {
      km: input.km,
      temTicket: !!input.ticket,
      temToneladas: input.toneladas != null,
      aguardandoPeso: !!input.aguardandoPeso,
      nEventos: atual.eventos.length,
    },
    { viagemClientId: atual.clientId },
  );
  await clearLifecycleLocal();
}
