/**
 * GASTO DE VIAGEM no app — a lógica das telas (sem desenho e sem falar com a
 * API direto: a conversa com o servidor mora em lib/despesas.ts).
 *
 * Tudo aqui funciona offline: o que está no servidor vem do cache (cache-first)
 * e o que ainda está no celular vem do outbox, e os dois se juntam numa lista
 * só ("o que ele vê"). Ligar um gasto a uma viagem aparece na hora, antes de
 * subir: a ligação pendente é aplicada por cima do que o servidor disse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { sugerirViagens } from "@ronan/shared-types";
import {
  cacheGetAt,
  cachePut,
  listPendingAbastecimentos,
  listPendingDespesas,
  listPendingPedagios,
  listPendingViagemIniciar,
  listPendingViagens,
  listPendingVinculosGasto,
  type PendingAbastecimento,
  type PendingDespesa,
  type PendingPedagio,
  type PendingViagem,
  type PendingViagemIniciar,
  type PendingVinculoGasto,
} from "@/db/database";
import {
  buscarMinhasDespesas,
  catalogoTemTiposDespesa,
  CAP_DESPESA_ACOMPANHAR,
  CAP_DESPESA_LANCAR,
  lerTiposDespesa,
  type DespesaApp,
  type TipoDespesaApp,
} from "./despesas";
import { useCapacidadeNova } from "./acessos-app";
import { api } from "./api";
import { getLifecycleLocal, type LifecycleLocal } from "./lifecycle";
import { cacheFirst, useCatalogos, useViagens, type Viagem } from "./queries";
import {
  descartarVinculoGastoPendente,
  enqueueVinculoGasto,
  onSyncChange,
  vincularDespesasPendentes,
} from "./sync";
import { useVisao } from "./visao";

// ---------------------------------------------------------------------------
// Módulo ligado?
// ---------------------------------------------------------------------------

/**
 * O módulo `despesas` contratado E a capacidade ligada pra ele. Capacidade que
 * o servidor não mandou (servidor antigo, empresa sem o módulo) = desligada:
 * sem o módulo a home fica EXATAMENTE como sempre foi.
 */
export function useModuloDespesas(): { lancar: boolean; acompanhar: boolean } {
  const capLancar = useCapacidadeNova(CAP_DESPESA_LANCAR);
  const capAcompanhar = useCapacidadeNova(CAP_DESPESA_ACOMPANHAR);
  // A capacidade sozinha NÃO basta: o corte de CONTRATO do acesso ao app nasce
  // em sombra, então o efetivo traz `app.despesa.*` até pra empresa que não
  // contratou. Quem diz se o módulo vale é o catálogo (`config.despesas`, o
  // mesmo `modulosDaConta` do servidor). Catálogo antigo, sem o campo = não.
  const cat = useCatalogos();
  const contratado = cat.data?.config?.despesas === true;
  // Acompanhar sobrevive ao cancelamento: sem o módulo, "Meus gastos" só
  // aparece pra quem tem gasto lançado (o GET não exige o módulo).
  const historico = useMinhasDespesas(capAcompanhar && !contratado && !!cat.data);
  const temHistorico = (historico.data?.length ?? 0) > 0;
  const lancar = capLancar && contratado;
  return {
    lancar,
    // Quem pode LANÇAR sempre pode ACOMPANHAR o que lançou: lançar e não
    // achar o gasto depois foi exatamente a reclamação do motorista.
    acompanhar: lancar || (capAcompanhar && (contratado || temHistorico)),
  };
}

/**
 * A aba "Gastos" ocupa o lugar da aba "Caderno" (decisão do dono, 06/10/2026)?
 *
 * Só em empresa com o módulo: lá o gasto da estrada é o que volta no acerto, e
 * o caderno pessoal (o que nenhuma empresa vê) desce pro Perfil como "Meu
 * caderno pessoal". Sem o módulo, e pra quem não tem empresa, nada muda.
 *
 * Só a visão "empresa": quem é registrado e NÃO dirige não tem gasto de
 * viagem, e as rotas de despesa são de motorista.
 *
 * Enquanto catálogo e acessos carregam, `useModuloDespesas` responde "não" —
 * então a barra fica como sempre foi (Caderno) até o módulo se confirmar, sem
 * piscar pra uma aba que depois some.
 */
export function useAbaGastos(): boolean {
  const visao = useVisao();
  const modulo = useModuloDespesas();
  return visao === "empresa" && (modulo.lancar || modulo.acompanhar);
}

// ---------------------------------------------------------------------------
// Dinheiro, data e id
// ---------------------------------------------------------------------------

export function fmtReais(n: number): string {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MAX_DIGITOS_VALOR = 9;

/**
 * Máscara de dinheiro estilo "maquininha": o número cresce pela direita.
 * Compara o texto novo com o que estava no campo, em vez de reler os dígitos
 * do texto inteiro — reler embaralhava quando ele apagava com o cursor no
 * meio (sumia o dígito do meio, ou apagar a vírgula não fazia nada).
 *
 * - Ficou mais curto (backspace, onde quer que o cursor estivesse): sai o
 *   ÚLTIMO dígito. Sem dígito nenhum sobrando: zera.
 * - Ficou mais longo (digitou ou colou): os dígitos inseridos entram no fim.
 */
export function proximoCentavos(anterior: string, novo: string, centavos: number): number {
  const digitosNovos = novo.replace(/\D/g, "");
  if (!digitosNovos) return 0;
  if (novo.length < anterior.length) return Math.floor(centavos / 10);
  // O trecho inserido: o que sobra tirando o começo e o fim em comum.
  let ini = 0;
  while (ini < anterior.length && ini < novo.length && anterior[ini] === novo[ini]) ini++;
  let fim = 0;
  while (
    fim < anterior.length - ini &&
    fim < novo.length - ini &&
    anterior[anterior.length - 1 - fim] === novo[novo.length - 1 - fim]
  )
    fim++;
  const inseridos = novo.slice(ini, novo.length - fim).replace(/\D/g, "");
  if (!inseridos) return centavos;
  const d = `${centavos > 0 ? centavos : ""}${inseridos}`.replace(/^0+/, "").slice(0, MAX_DIGITOS_VALOR);
  return d ? parseInt(d, 10) : 0;
}

const OFFSET_BR_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" do instante no calendário de São Paulo (UTC-3 fixo). */
export function diaSP(iso: string | number | Date): string {
  const t = new Date(iso).getTime();
  const br = new Date((Number.isNaN(t) ? Date.now() : t) - OFFSET_BR_MS);
  return `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, "0")}-${String(br.getUTCDate()).padStart(2, "0")}`;
}

/** "14:32" em Brasília. */
export function horaSP(iso: string): string {
  const t = new Date(iso).getTime();
  const br = new Date((Number.isNaN(t) ? Date.now() : t) - OFFSET_BR_MS);
  return `${String(br.getUTCHours()).padStart(2, "0")}:${String(br.getUTCMinutes()).padStart(2, "0")}`;
}

/** "hoje", "ontem" ou "02/10". */
export function diaFalado(dia: string): string {
  const hoje = diaSP(Date.now());
  if (dia === hoje) return "hoje";
  if (dia === diaSP(Date.now() - 24 * 60 * 60 * 1000)) return "ontem";
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

export function novoClientId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Catálogo de tipos (offline)
// ---------------------------------------------------------------------------

/**
 * Os tipos do catálogo em cache. `chegaram` = o catálogo deste celular já tem
 * o campo (mesmo vazio). Sem ele (instalou e nunca teve sinal, ou servidor
 * antigo), a lista mostra o quadro de "ainda não chegaram".
 */
export function useTiposDespesa(): {
  daEmpresa: TipoDespesaApp[];
  chegaram: boolean;
  carregando: boolean;
  tentarAgora: () => void;
  porId: (id: string | null | undefined) => TipoDespesaApp | undefined;
} {
  const cat = useCatalogos();
  const todos = useMemo(() => lerTiposDespesa(cat.data), [cat.data]);
  // O catálogo só traz tipos da empresa (pedágio e abastecimento são do app).
  const daEmpresa = todos;
  const chegaram = catalogoTemTiposDespesa(cat.data);
  const porId = useCallback((id: string | null | undefined) => todos.find((t) => t.id === id), [todos]);
  return {
    daEmpresa,
    chegaram,
    carregando: cat.isLoading || cat.isFetching,
    tentarAgora: () => void cat.refetch(),
    porId,
  };
}

// ---------------------------------------------------------------------------
// Outbox (o que ainda está no celular)
// ---------------------------------------------------------------------------

function useFilaLocal<T>(listar: () => Promise<T[]>): T[] {
  const [itens, setItens] = useState<T[]>([]);
  useEffect(() => {
    let vivo = true;
    const refresh = async () => {
      try {
        const l = await listar();
        if (vivo) setItens(l);
      } catch {
        /* storage indisponível */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      vivo = false;
      off();
    };
  }, [listar]);
  return itens;
}

export function usePendingDespesas(): PendingDespesa[] {
  return useFilaLocal(listPendingDespesas);
}

export function usePendingVinculosGasto(): PendingVinculoGasto[] {
  return useFilaLocal(listPendingVinculosGasto);
}

// ---------------------------------------------------------------------------
// O que está no servidor (cache-first)
// ---------------------------------------------------------------------------

const CACHE_DESPESAS = "q:despesas";

export function useMinhasDespesas(enabled = true) {
  const buscarRede = async (): Promise<DespesaApp[]> => {
    const fresh = await buscarMinhasDespesas();
    void cachePut(CACHE_DESPESAS, fresh).catch(() => {});
    return fresh;
  };
  return useQuery({
    queryKey: ["despesas"],
    staleTime: 30_000,
    enabled,
    // A lista guardada passou pelo leitor tolerante antes de ir pro disco; o
    // cache antigo (ou lixo) vira lista vazia, nunca crash.
    queryFn: () =>
      cacheFirst<DespesaApp[]>(["despesas"], CACHE_DESPESAS, buscarRede, (x) =>
        Array.isArray(x) ? x : [],
      ),
  });
}

/** Quando a lista do servidor foi guardada (pro "Atualizado às 09:40"). */
export function useDespesasAtualizadasEm(): number | null {
  const q = useMinhasDespesas(false);
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    void cacheGetAt(CACHE_DESPESAS).then((at) => {
      if (vivo) setT(at);
    });
    return () => {
      vivo = false;
    };
  }, [q.dataUpdatedAt]);
  return t;
}

// ---------------------------------------------------------------------------
// A lista que ele vê (servidor + celular)
// ---------------------------------------------------------------------------

export type CorStatus = "cinza" | "azul" | "verde" | "ambar";

export type StatusExibido = {
  texto: string;
  cor: CorStatus;
  /** Frase do escritório (motivo), quando há. */
  motivo: string | null;
  /** Entra no "pra receber de volta"? Com quanto? */
  soma: number;
  /** Aprovado (verde) ou ainda com o escritório/no celular (azul/cinza). */
  grupo: "aprovado" | "escritorio" | "fora";
};

export type GastoVisto = {
  chave: string;
  /**
   * "despesa" = gasto do módulo (soma no "pra receber"). Pedágio e
   * abastecimento só aparecem em Meus gastos › Todos, NUNCA na soma: quem
   * diz se volta é o acerto (ver `useLancamentosDoAcerto`).
   */
  categoria: "despesa" | "pedagio" | "abastecimento";
  /** Linha de baixo no lugar da viagem (ex.: a praça do pedágio, o posto). */
  detalhe?: string | null;
  /** Texto do valor no lugar do R$ (ex.: comboio, que não tem valor). */
  valorTexto?: string | null;
  origem: "celular" | "servidor";
  despesaId: string | null;
  clientId: string | null;
  tipoId: string | null;
  tipoNome: string;
  tipoIcone: string | null;
  data: string;
  dia: string;
  valorInformado: number;
  reembolsa: boolean;
  viagemId: string | null;
  viagemClientId: string | null;
  viagemRotulo: string | null;
  naoFoiEmViagem: boolean;
  /** Ninguém disse de qual viagem foi (nem "não foi em viagem"). */
  semResposta: boolean;
  /** Ainda dá pra corrigir/apagar (no celular, ou com o escritório). */
  editavel: boolean;
  status: StatusExibido;
  servidor: DespesaApp | null;
  pendente: PendingDespesa | null;
};

function fmtDM(iso: string): string {
  const [, m, d] = diaSP(iso).split("-");
  return `${d}/${m}`;
}

/**
 * O texto da tela sai da `situacao` do servidor (10-telas §8). Vermelho nunca:
 * "não vai ser reembolsado" é âmbar, e ele pode responder ao escritório.
 */
export function statusDoServidor(d: DespesaApp): StatusExibido {
  const aprovado = d.valorAprovado ?? d.valorInformado;
  const soma = d.somaPraReceber ? aprovado : 0;
  switch (d.situacao) {
    case "POR_SUA_CONTA":
      return {
        // O tipo devolve, mas o combinado dele com a empresa não: o servidor
        // avisa, pra tela não dizer "Por sua conta" como se fosse o tipo.
        texto: d.naoVoltaNoAcerto ? "Não volta no acerto (combinado da empresa)" : "Por sua conta",
        cor: "cinza",
        motivo: null,
        soma: 0,
        grupo: "fora",
      };
    case "NAO_REEMBOLSADA":
      return { texto: "Não vai ser reembolsado", cor: "ambar", motivo: d.motivo, soma: 0, grupo: "fora" };
    case "PAGO":
      return {
        texto: d.acerto?.pagoEm ? `Pago em ${fmtDM(d.acerto.pagoEm)}` : "Pago",
        cor: "verde",
        motivo: null,
        soma,
        grupo: soma > 0 ? "aprovado" : "fora",
      };
    case "NO_ACERTO":
      return {
        texto: d.acerto?.periodoFim ? `No acerto de ${fmtDM(d.acerto.periodoFim)}` : "No acerto",
        cor: "verde",
        motivo: null,
        soma,
        grupo: soma > 0 ? "aprovado" : "fora",
      };
    case "APROVADA_OUTRO_VALOR":
      return {
        texto: `Aprovado ${fmtReais(aprovado)}`,
        cor: "ambar",
        motivo: d.motivo,
        soma,
        grupo: "aprovado",
      };
    case "PAGO_FORA_DO_ACERTO":
      return {
        texto: "Aprovado — o escritório paga fora do acerto",
        cor: "verde",
        motivo: null,
        soma,
        grupo: "aprovado",
      };
    case "APROVADA":
      return {
        texto: "Aprovado — entra no próximo acerto",
        cor: "verde",
        motivo: null,
        soma,
        grupo: "aprovado",
      };
    default:
      return {
        texto: "Com o escritório",
        cor: "azul",
        motivo: null,
        // Com o escritório sempre conta (o servidor manda `somaPraReceber`; o
        // cache de antes do campo não tem, e aí vale o lançado).
        soma: d.somaPraReceber ? aprovado : d.valorInformado,
        grupo: "escritorio",
      };
  }
}

function valorDoPayload(p: Record<string, unknown>): number {
  const v = typeof p.valor === "number" ? p.valor : Number(p.valor);
  return Number.isFinite(v) ? v : 0;
}

function doCelular(p: PendingDespesa): GastoVisto {
  const pl = p.payload;
  const data = typeof pl.data === "string" ? pl.data : new Date(p.createdAt).toISOString();
  const valor = valorDoPayload(pl);
  const viagemId = typeof pl.viagemId === "string" ? pl.viagemId : null;
  const viagemClientId = typeof pl.viagemClientId === "string" ? pl.viagemClientId : null;
  const fora = pl.foraDeViagem === true;
  const fotoNoCelular = p.fotos.length > 0 && p.fotos.some((f) => !f.fotoKey) && !!p.lastTriedAt;
  const status: StatusExibido = !p.resumo.reembolsa
    ? { texto: "Por sua conta", cor: "cinza", motivo: null, soma: 0, grupo: "fora" }
    : fotoNoCelular
      ? { texto: "Foto ainda no celular", cor: "cinza", motivo: null, soma: valor, grupo: "escritorio" }
      : { texto: "Guardado no celular", cor: "cinza", motivo: null, soma: valor, grupo: "escritorio" };
  return {
    chave: `c:${p.clientId}`,
    categoria: "despesa",
    origem: "celular",
    despesaId: null,
    clientId: p.clientId,
    tipoId: typeof pl.tipoDespesaId === "string" ? pl.tipoDespesaId : null,
    tipoNome: p.resumo.tipoNome,
    tipoIcone: p.resumo.tipoIcone ?? null,
    data,
    dia: diaSP(data),
    valorInformado: valor,
    reembolsa: p.resumo.reembolsa,
    viagemId,
    viagemClientId,
    viagemRotulo: p.resumo.viagemRotulo ?? null,
    naoFoiEmViagem: fora,
    semResposta: !viagemId && !viagemClientId && !fora,
    editavel: true,
    status,
    servidor: null,
    pendente: p,
  };
}

function doServidor(d: DespesaApp, vinculos: PendingVinculoGasto[]): GastoVisto {
  let viagemId = d.viagem?.id ?? d.viagemId;
  let viagemClientId = d.viagem?.clientId ?? d.viagemClientId;
  let rotulo = d.viagem?.resumo ?? null;
  let vinculo = d.vinculo;
  // A ligação que ainda está na fila vale por cima do que o servidor disse —
  // ele ligou agora, tem que ver ligado agora. Em ordem (a última vence).
  for (const v of vinculos) {
    if (!v.despesas.includes(d.id) && !(d.clientId && v.despesas.includes(d.clientId))) continue;
    if (v.acao === "DESFAZER") {
      viagemId = null;
      viagemClientId = null;
      rotulo = null;
      vinculo = "SEM_RESPOSTA";
    } else if (v.acao === "FORA_DE_VIAGEM") {
      viagemId = null;
      viagemClientId = null;
      rotulo = null;
      vinculo = "FORA_DE_VIAGEM";
    } else {
      viagemId = v.viagemId ?? null;
      viagemClientId = v.viagemClientId ?? null;
      rotulo = v.resumo.viagemRotulo ?? null;
      vinculo = "VIAGEM";
    }
  }
  return {
    chave: `s:${d.id}`,
    categoria: "despesa",
    origem: "servidor",
    despesaId: d.id,
    clientId: d.clientId,
    tipoId: d.tipoId,
    tipoNome: d.tipoNome,
    tipoIcone: d.tipoIcone,
    data: d.data,
    dia: diaSP(d.data),
    valorInformado: d.valorInformado,
    reembolsa: d.situacao !== "POR_SUA_CONTA",
    viagemId,
    viagemClientId,
    viagemRotulo: rotulo ?? (vinculo === "VIAGEM" ? "Viagem ainda no celular" : null),
    naoFoiEmViagem: vinculo === "FORA_DE_VIAGEM",
    semResposta: vinculo === "SEM_RESPOSTA",
    editavel: d.editavel,
    status: statusDoServidor(d),
    servidor: d,
    pendente: null,
  };
}

/**
 * Tudo que ele lançou: o que está no celular primeiro, depois o servidor, do
 * mais novo pro mais velho. Um gasto que acabou de subir e ainda está no cache
 * velho do servidor não aparece duas vezes (casa pelo clientId).
 */
export function useGastos(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const q = useMinhasDespesas(enabled);
  const pend = usePendingDespesas();
  const vinc = usePendingVinculosGasto();
  // Gasto que acabou de sair da fila ainda não está no cache do servidor:
  // revalida na hora, senão ele some da lista por um instante.
  // Mesma coisa com a ligação à viagem: enquanto ela está na fila, o vínculo
  // pendente é pintado por cima do cache; quando sobe, ela sai da fila e, sem
  // revalidar, o cache velho fazia o gasto voltar pra "Gastos sem viagem".
  const qtdFila = useRef(pend.length);
  const qtdVinc = useRef(vinc.length);
  useEffect(() => {
    if (enabled && (pend.length < qtdFila.current || vinc.length < qtdVinc.current)) void q.refetch();
    qtdFila.current = pend.length;
    qtdVinc.current = vinc.length;
  }, [pend.length, vinc.length, enabled, q]);
  const gastos = useMemo<GastoVisto[]>(() => {
    const locais = pend.map(doCelular);
    const ids = new Set(pend.map((p) => p.clientId));
    const remotos = (q.data ?? [])
      .filter((d) => !d.clientId || !ids.has(d.clientId))
      .map((d) => doServidor(d, vinc));
    return [...locais, ...remotos].sort((a, b) => b.data.localeCompare(a.data));
  }, [pend, vinc, q.data]);
  return { gastos, query: q };
}

export type ResumoReembolso = {
  total: number;
  aprovado: number;
  comEscritorio: number;
  semViagem: number;
};

export function resumirGastos(gastos: GastoVisto[]): ResumoReembolso {
  let aprovado = 0;
  let comEscritorio = 0;
  for (const g of gastos) {
    if (g.status.grupo === "aprovado") aprovado += g.status.soma;
    else if (g.status.grupo === "escritorio") comEscritorio += g.status.soma;
  }
  return {
    total: aprovado + comEscritorio,
    aprovado,
    comEscritorio,
    semViagem: gastosSemViagem(gastos).length,
  };
}

/** Gastos que pedem "de qual viagem foi?" (sem resposta e ainda mexíveis). */
export function gastosSemViagem(gastos: GastoVisto[]): GastoVisto[] {
  // Gasto que já entrou em acerto fechado sai daqui (não tem mais o que mudar).
  return gastos.filter(
    (g) =>
      g.semResposta &&
      (g.origem === "celular" ||
        (g.servidor && g.servidor.situacao !== "NO_ACERTO" && g.servidor.situacao !== "PAGO")),
  );
}

// ---------------------------------------------------------------------------
// Pedágio e abastecimento em "Meus gastos › Todos"
// ---------------------------------------------------------------------------

/**
 * Pedágio e diesel moram na aba Gastos ("O que você pagou?"), então têm que
 * APARECER em Meus gastos — senão volta o "lancei e não achei". Mas NUNCA
 * entram na soma "Pra receber de volta": quem devolve (ou não) é o acerto,
 * pela régua da empresa (comboio, cartão da empresa, pedágio em dobro...), e
 * o app não sabe a régua. Status neutro até o acerto fechar.
 */
type AcertoDoLancamento = { periodoFim: string | null; status: string | null; pagoEm: string | null } | null;

function lerAcertoDoLancamento(x: unknown): AcertoDoLancamento {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { periodoFim: t(r.periodoFim), status: t(r.status), pagoEm: t(r.pagoEm) };
}

function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function fmtDia(ymd: string): string {
  const [, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}`;
}

const STATUS_CONFERE: StatusExibido = {
  texto: "O escritório confere no acerto",
  cor: "cinza",
  motivo: null,
  soma: 0,
  grupo: "fora",
};

function statusDoAcerto(a: AcertoDoLancamento): StatusExibido {
  if (a?.status === "PAGO") {
    return { texto: a.pagoEm ? `Pago em ${fmtDM(a.pagoEm)}` : "Pago", cor: "verde", motivo: null, soma: 0, grupo: "fora" };
  }
  if (a?.status === "FECHADO") {
    return {
      texto: a.periodoFim ? `No acerto de ${fmtDia(a.periodoFim)}` : "No acerto",
      cor: "verde",
      motivo: null,
      soma: 0,
      grupo: "fora",
    };
  }
  return STATUS_CONFERE;
}

function statusDaFila(p: { status: string; errorStatus?: number; errorPermanenteLocal?: boolean }): StatusExibido {
  const travado =
    p.status === "error" &&
    (p.errorPermanenteLocal || (p.errorStatus != null && p.errorStatus >= 400 && p.errorStatus < 500));
  return travado
    ? { texto: "Precisa corrigir — veja Pendentes", cor: "ambar", motivo: null, soma: 0, grupo: "fora" }
    : { texto: "Guardado no celular", cor: "cinza", motivo: null, soma: 0, grupo: "fora" };
}

function base(chave: string, categoria: "pedagio" | "abastecimento"): Omit<GastoVisto, "data" | "dia" | "valorInformado" | "status" | "origem" | "clientId"> {
  return {
    chave,
    categoria,
    despesaId: null,
    tipoId: null,
    tipoNome: categoria === "pedagio" ? "Pedágio" : "Abastecimento",
    tipoIcone: categoria === "pedagio" ? "pedagio" : "diesel",
    reembolsa: false,
    viagemId: null,
    viagemClientId: null,
    viagemRotulo: null,
    naoFoiEmViagem: false,
    semResposta: false,
    editavel: false,
    servidor: null,
    pendente: null,
  };
}

/** Pedágio é dia (@db.Date): meio-dia de SP pra ordenar junto dos instantes. */
function instanteDoDia(ymd: string): string {
  return `${ymd.slice(0, 10)}T15:00:00.000Z`;
}

function pedagioDoServidor(r: Record<string, unknown>): GastoVisto | null {
  const id = typeof r.id === "string" ? r.id : null;
  const dia = typeof r.data === "string" ? r.data.slice(0, 10) : null;
  if (!id || !dia) return null;
  return {
    ...base(`ps:${id}`, "pedagio"),
    origem: "servidor",
    clientId: typeof r.clientId === "string" ? r.clientId : null,
    data: instanteDoDia(dia),
    dia,
    valorInformado: numero(r.valor) ?? 0,
    detalhe: typeof r.pracaPedagio === "string" ? r.pracaPedagio : null,
    status: statusDoAcerto(lerAcertoDoLancamento(r.acerto)),
  };
}

function abastecimentoDoServidor(r: Record<string, unknown>): GastoVisto | null {
  const id = typeof r.id === "string" ? r.id : null;
  const data = typeof r.data === "string" ? r.data : null;
  if (!id || !data) return null;
  const comboio = r.emComboio === true;
  const valor = numero(r.valorTotal);
  return {
    ...base(`as:${id}`, "abastecimento"),
    origem: "servidor",
    clientId: typeof r.clientId === "string" ? r.clientId : null,
    data,
    dia: diaSP(data),
    valorInformado: valor ?? 0,
    valorTexto: valor == null ? "sem valor" : null,
    detalhe: comboio ? "comboio" : typeof r.postoNome === "string" ? r.postoNome : null,
    // Comboio é diesel da empresa entregue no caminhão-tanque: ele não pagou.
    status: comboio
      ? { texto: "Diesel da empresa", cor: "cinza", motivo: null, soma: 0, grupo: "fora" }
      : statusDoAcerto(lerAcertoDoLancamento(r.acerto)),
  };
}

function pedagioDoCelular(p: PendingPedagio): GastoVisto {
  const pl = p.payload;
  const dia = typeof pl.data === "string" ? pl.data.slice(0, 10) : diaSP(p.createdAt);
  return {
    ...base(`pc:${p.clientId}`, "pedagio"),
    origem: "celular",
    clientId: p.clientId,
    data: instanteDoDia(dia),
    dia,
    valorInformado: numero(pl.valor) ?? 0,
    detalhe: typeof pl.pracaPedagio === "string" ? pl.pracaPedagio : null,
    editavel: true,
    status: statusDaFila(p),
  };
}

function abastecimentoDoCelular(p: PendingAbastecimento): GastoVisto {
  const pl = p.payload;
  const data = typeof pl.data === "string" ? pl.data : new Date(p.createdAt).toISOString();
  const comboio = pl.emComboio === true;
  const valor = numero(pl.valorTotal);
  return {
    ...base(`ac:${p.clientId}`, "abastecimento"),
    origem: "celular",
    clientId: p.clientId,
    data,
    dia: diaSP(data),
    valorInformado: valor ?? 0,
    valorTexto: valor == null ? "sem valor" : null,
    detalhe: comboio ? "comboio" : typeof pl.postoNome === "string" ? pl.postoNome : null,
    editavel: true,
    status: statusDaFila(p),
  };
}

function itensDaLista(raw: unknown): Record<string, unknown>[] {
  const arr =
    raw && typeof raw === "object" && Array.isArray((raw as { itens?: unknown }).itens)
      ? (raw as { itens: unknown[] }).itens
      : Array.isArray(raw)
        ? raw
        : [];
  return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

const CACHE_PEDAGIOS_GASTOS = "q:gastos:pedagios";
const CACHE_ABAST_GASTOS = "q:gastos:abastecimentos";

/**
 * Os últimos 100 de cada (uma página cobre bem mais que um acerto). A chave
 * começa por "pedagios"/"abastecimentos" de propósito: o lançar já invalida
 * esses prefixos.
 */
function useListaDoMotorista(chave: "pedagios" | "abastecimentos", cache: string, enabled: boolean) {
  return useQuery({
    queryKey: [chave, "gastos"],
    staleTime: 60_000,
    enabled,
    queryFn: () =>
      cacheFirst<Record<string, unknown>[]>(
        [chave, "gastos"],
        cache,
        async () => {
          const fresh = itensDaLista(await api.get<unknown>(`/m/${chave}?limit=100`));
          void cachePut(cache, fresh).catch(() => {});
          return fresh;
        },
        (x) => itensDaLista(x),
      ),
  });
}

export function useLancamentosDoAcerto(enabled = true): GastoVisto[] {
  const qp = useListaDoMotorista("pedagios", CACHE_PEDAGIOS_GASTOS, enabled);
  const qa = useListaDoMotorista("abastecimentos", CACHE_ABAST_GASTOS, enabled);
  const pendP = useFilaLocal<PendingPedagio>(listPendingPedagios);
  const pendA = useFilaLocal<PendingAbastecimento>(listPendingAbastecimentos);
  // Saiu da fila = subiu: revalida, senão ele some por um instante.
  const qtd = useRef({ p: pendP.length, a: pendA.length });
  useEffect(() => {
    if (enabled && pendP.length < qtd.current.p) void qp.refetch();
    if (enabled && pendA.length < qtd.current.a) void qa.refetch();
    qtd.current = { p: pendP.length, a: pendA.length };
  }, [pendP.length, pendA.length, enabled, qp, qa]);
  return useMemo(() => {
    if (!enabled) return [];
    const naFila = new Set([...pendP.map((p) => p.clientId), ...pendA.map((a) => a.clientId)]);
    const remotos = [
      ...(qp.data ?? []).map(pedagioDoServidor),
      ...(qa.data ?? []).map(abastecimentoDoServidor),
    ].filter((g): g is GastoVisto => !!g && !(g.clientId && naFila.has(g.clientId)));
    return [...pendP.map(pedagioDoCelular), ...pendA.map(abastecimentoDoCelular), ...remotos];
  }, [enabled, pendP, pendA, qp.data, qa.data]);
}

// ---------------------------------------------------------------------------
// Possível repetido (só com o que está no celular — enviado e guardado)
// ---------------------------------------------------------------------------

export function procurarRepetidos(
  gastos: GastoVisto[],
  alvo: { tipoId: string; valor: number; dia: string; ignorarClientId?: string | null },
): GastoVisto[] {
  return gastos.filter(
    (g) =>
      g.tipoId === alvo.tipoId &&
      g.dia === alvo.dia &&
      Math.abs(g.valorInformado - alvo.valor) < 0.005 &&
      (!alvo.ignorarClientId || g.clientId !== alvo.ignorarClientId),
  );
}

// ---------------------------------------------------------------------------
// Viagens que o celular conhece (pra "Foi nesta viagem?" e pra ligar depois)
// ---------------------------------------------------------------------------

export type ViagemConhecida = {
  chave: string;
  viagemId: string | null;
  clientId: string | null;
  rotulo: string;
  dia: string;
  /** Início (guiada) — ISO. Sem ele, a viagem vale pelo dia inteiro. */
  inicio: string | null;
  emAndamento: boolean;
  /** Status do servidor (CANCELADA nunca é sugerida); null = ainda no celular. */
  status?: string | null;
  veiculoId: string | null;
  placa: string | null;
};

function rotuloDaViagemServidor(v: Viagem): string {
  const carga = v.localCarga?.nome;
  const desc = v.localDescarga?.nome;
  if (carga) return desc ? `${carga} → ${desc}` : carga;
  return v.cliente?.nome ?? "Viagem";
}

/**
 * As viagens que este celular conhece, sem rede: a em andamento (espelho da
 * guiada), as guardadas na fila e as do cache do histórico.
 */
export function useViagensConhecidas(): ViagemConhecida[] {
  const viagens = useViagens();
  const cat = useCatalogos();
  const pendViagens = useFilaLocal<PendingViagem>(listPendingViagens);
  const pendIniciar = useFilaLocal<PendingViagemIniciar>(listPendingViagemIniciar);
  const [andamento, setAndamento] = useState<LifecycleLocal | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void getLifecycleLocal().then((l) => {
        if (vivo) setAndamento(l);
      });
      return () => {
        vivo = false;
      };
    }, []),
  );

  return useMemo(() => {
    const locais = new Map((cat.data?.locais ?? []).map((l) => [l.id, l.nome]));
    const placas = new Map((cat.data?.veiculos ?? []).map((v) => [v.id, v.placa]));
    const out: ViagemConhecida[] = [];
    const vistos = new Set<string>();
    const add = (v: ViagemConhecida) => {
      const k = v.clientId ?? v.viagemId ?? v.chave;
      if (vistos.has(k)) return;
      if (v.viagemId) vistos.add(v.viagemId);
      if (v.clientId) vistos.add(v.clientId);
      vistos.add(k);
      out.push(v);
    };

    if (andamento) {
      add({
        chave: `a:${andamento.clientId}`,
        viagemId: null,
        clientId: andamento.clientId,
        rotulo: andamento.localCargaNome
          ? `${andamento.localCargaNome} → …`
          : andamento.clienteNome ?? "Viagem em andamento",
        dia: diaSP(andamento.iniciadoEm),
        inicio: andamento.iniciadoEm,
        emAndamento: true,
        status: "EM_ANDAMENTO",
        veiculoId: andamento.veiculoId ?? null,
        placa: placas.get(andamento.veiculoId) ?? null,
      });
    }
    for (const p of pendIniciar) {
      const pl = p.payload as Record<string, unknown>;
      const inicio = typeof pl.iniciadoEm === "string" ? pl.iniciadoEm : new Date(p.createdAt).toISOString();
      const veic = typeof pl.veiculoId === "string" ? pl.veiculoId : null;
      add({
        chave: `i:${p.clientId}`,
        viagemId: null,
        clientId: p.clientId,
        rotulo: "Viagem guardada no celular",
        dia: diaSP(inicio),
        inicio,
        emAndamento: false,
        status: null,
        veiculoId: veic,
        placa: veic ? (placas.get(veic) ?? null) : null,
      });
    }
    for (const p of pendViagens) {
      const pl = p.payload as Record<string, unknown>;
      const carga = locais.get(String(pl.localCargaId ?? ""));
      const desc = locais.get(String(pl.localDescargaId ?? ""));
      const dia = typeof pl.data === "string" ? pl.data.slice(0, 10) : diaSP(p.createdAt);
      const veic = typeof pl.veiculoId === "string" ? pl.veiculoId : null;
      add({
        chave: `p:${p.clientId}`,
        viagemId: null,
        clientId: p.clientId,
        rotulo: carga ? (desc ? `${carga} → ${desc}` : carga) : "Viagem guardada no celular",
        dia,
        inicio: null,
        emAndamento: false,
        status: null,
        veiculoId: veic,
        placa: veic ? (placas.get(veic) ?? null) : null,
      });
    }
    for (const v of viagens.data ?? []) {
      add({
        chave: `s:${v.id}`,
        viagemId: v.id,
        clientId: v.clientId ?? null,
        rotulo: rotuloDaViagemServidor(v),
        dia: (v.data ?? "").slice(0, 10),
        // A guiada vem com `iniciadoEm` da API: é ela que dá a janela de horas.
        // Sem isso (manual, ou cache de antes), vale o dia inteiro.
        inicio: typeof v.iniciadoEm === "string" ? v.iniciadoEm : null,
        emAndamento: v.status === "EM_ANDAMENTO",
        status: v.status ?? null,
        veiculoId: v.veiculo?.id ?? null,
        placa: v.veiculo?.placa ?? null,
      });
    }
    return out;
  }, [andamento, pendIniciar, pendViagens, viagens.data, cat.data]);
}

/**
 * A viagem candidata pro "Foi nesta viagem?" — a MESMA regra do painel
 * (`sugerirViagens` do shared-types, pura e sem Intl: roda no Hermes), com o
 * que o celular sabe: a em andamento (espelho local, com `iniciadoEm`), as
 * guardadas na fila e o histórico em cache. Nunca marca nada: só sugere.
 *
 * O que o celular NÃO tem e como fica:
 * - `motoristaId`: não precisa — tudo aqui já é dele.
 * - `veiculoId` do gasto: o gasto não tem caminhão no app, então qualquer
 *   caminhão conta como "o mesmo" (a função trata ausente assim).
 * - `finalizadoEm`: a viagem não guarda; a função cai no fim do dia (igual ao
 *   painel). Guiada que ainda está na fila de "Iniciar" (sem status do
 *   servidor) também fica até o fim do dia.
 * - `iniciadoEm` de viagem do cache gravado antes deste campo: ausente → a
 *   viagem é lida como manual (dia inteiro) até o cache revalidar.
 *
 * A em andamento continua sendo a primeira quando o gasto cai na janela dela
 * (do Iniciar − tolerância até agora + tolerância); fora disso, vale a ordem
 * da função oficial.
 */
export function sugerirViagem(viagens: ViagemConhecida[], instanteISO: string): ViagemConhecida | null {
  const r = sugerirViagens(
    { data: instanteISO },
    viagens.map((v) => ({
      id: v.chave,
      veiculoId: v.veiculoId,
      data: v.dia || null,
      iniciadoEm: v.inicio,
      status: v.emAndamento ? "EM_ANDAMENTO" : v.status,
      conhecida: v,
    })),
  );
  const andando = r.find((s) => s.viagem.conhecida.emAndamento && s.forca === "FORTE");
  return (andando ?? r[0])?.viagem.conhecida ?? null;
}

/** As viagens dos últimos `dias` dias (pra "Em qual viagem foi?"). */
export function viagensRecentes(viagens: ViagemConhecida[], dias: number): ViagemConhecida[] {
  const limite = diaSP(Date.now() - dias * 24 * 60 * 60 * 1000);
  return viagens.filter((v) => v.dia >= limite);
}

// ---------------------------------------------------------------------------
// "Gasto guardado" — a faixa verde da tela de onde ele veio
// ---------------------------------------------------------------------------

export type AvisoGastoSalvo = {
  clientId: string;
  /**
   * De qual fila ele é: cada um tem a sua no outbox, e a faixa só diz
   * "enviado" depois de olhar a fila CERTA (olhar só a de despesas fazia o
   * pedágio sem sinal aparecer como enviado). Ausente = despesa.
   */
  tipo?: "despesa" | "pedagio" | "abastecimento";
  /** Pra o "Lançar outro" abrir a lista no mesmo contexto. */
  params: Record<string, string>;
  em: number;
};

let avisoSalvo: AvisoGastoSalvo | null = null;

/** Quem salva marca; a tela de onde ele veio mostra a faixa (uma vez, 4 s). */
export function marcarGastoSalvo(a: Omit<AvisoGastoSalvo, "em">): void {
  avisoSalvo = { ...a, em: Date.now() };
}

/** Pega o aviso (e consome). Aviso de mais de 10 s atrás não vale mais. */
export function pegarAvisoGastoSalvo(): AvisoGastoSalvo | null {
  const a = avisoSalvo;
  avisoSalvo = null;
  if (!a || Date.now() - a.em > 10_000) return null;
  return a;
}

// ---------------------------------------------------------------------------
// Ligar gastos a uma viagem (offline: pela fila do celular)
// ---------------------------------------------------------------------------

export type DestinoGasto =
  | { tipo: "viagem"; viagem: ViagemConhecida }
  | { tipo: "fora" }
  | { tipo: "desfazer" };

/** O que foi feito, pro "Desfazer". */
export type LigacaoFeita = {
  gastos: GastoVisto[];
  /** Operação na fila (gastos já enviados), se houve. */
  opId: string | null;
};

/**
 * Liga os gastos ao destino. Os que ainda estão no celular são editados ali
 * mesmo; os já enviados viram UM item de ligação em lote na fila.
 */
export async function ligarGastos(gs: GastoVisto[], destino: DestinoGasto): Promise<LigacaoFeita> {
  const doCel = gs.filter((g) => g.origem === "celular" && g.clientId).map((g) => g.clientId!);
  const enviados = gs.filter((g) => g.origem === "servidor" && g.despesaId);
  if (doCel.length > 0) {
    await vincularDespesasPendentes(
      doCel,
      destino.tipo === "viagem"
        ? {
            viagemId: destino.viagem.viagemId,
            viagemClientId: destino.viagem.clientId,
            rotulo: destino.viagem.rotulo,
          }
        : destino.tipo === "fora"
          ? { foraDeViagem: true }
          : null,
    );
  }
  let opId: string | null = null;
  if (enviados.length > 0) {
    opId = await enqueueVinculoGasto({
      despesas: enviados.map((g) => g.despesaId!),
      acao: destino.tipo === "viagem" ? "VIAGEM" : destino.tipo === "fora" ? "FORA_DE_VIAGEM" : "DESFAZER",
      viagemId: destino.tipo === "viagem" ? destino.viagem.viagemId : null,
      viagemClientId:
        destino.tipo === "viagem" && !destino.viagem.viagemId ? destino.viagem.clientId : null,
      resumo: {
        quantos: enviados.length,
        valor: enviados.reduce((s, g) => s + g.valorInformado, 0),
        viagemRotulo: destino.tipo === "viagem" ? destino.viagem.rotulo : null,
      },
    });
  }
  return { gastos: gs, opId };
}

/**
 * "Desfazer": volta os gastos pra "sem resposta". Se a ligação ainda não
 * subiu, só tira ela da fila (o servidor nunca soube).
 */
export async function desfazerLigacao(l: LigacaoFeita): Promise<void> {
  const doCel = l.gastos.filter((g) => g.origem === "celular" && g.clientId).map((g) => g.clientId!);
  if (doCel.length > 0) await vincularDespesasPendentes(doCel, null);
  const enviados = l.gastos.filter((g) => g.origem === "servidor" && g.despesaId);
  if (enviados.length === 0) return;
  const naFila = l.opId ? (await listPendingVinculosGasto()).find((v) => v.clientId === l.opId) : null;
  if (naFila && naFila.status !== "syncing") {
    await descartarVinculoGastoPendente(naFila.clientId);
    return;
  }
  await enqueueVinculoGasto({
    despesas: enviados.map((g) => g.despesaId!),
    acao: "DESFAZER",
    resumo: {
      quantos: enviados.length,
      valor: enviados.reduce((s, g) => s + g.valorInformado, 0),
      viagemRotulo: null,
    },
  });
}
