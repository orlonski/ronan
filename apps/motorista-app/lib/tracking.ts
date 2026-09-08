import { useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import { showConfirm } from "./alert";
import {
  clearViagemAndamento,
  getViagemAndamento,
  setViagemAndamento,
  type Ponto,
  type ViagemEmAndamento,
} from "./tracking-storage";
import { registerTrackingTask, TRACKING_TASK } from "./tracking-task";

const REFRESH_MS = 5_000;
const NOTIFICATION_BODY_INICIAL =
  "Tocando KM real percorrido. Toque pra finalizar.";

/** True se o foreground service de tracking está ativo. */
export async function isTrackingAtivo(): Promise<boolean> {
  const Location = await import("expo-location");
  return Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
}

/**
 * Pre-prompt explicativo antes do popup nativo de "Permitir o tempo todo".
 * Apple exige isso na review da App Store; também melhora a taxa de aceitação
 * no Android. Retorna true se motorista aceitou continuar (vai disparar o
 * popup nativo logo em seguida), false se cancelou.
 *
 * O destino do dado MUDA entre os dois fluxos, e dizer errado é grave: no frete
 * por conta própria nenhum ponto sai do aparelho (só o km vai junto do frete),
 * e o texto antigo — "seus dados vão SOMENTE pro servidor da empresa" — era
 * falso pra quem não tem empresa nenhuma, além de ser exatamente a frase que a
 * Apple cita numa recusa por localização em segundo plano.
 */
function prePromptBackgroundLocation(pessoal: boolean): Promise<boolean> {
  return showConfirm({
    title: "Medir o km com a tela apagada?",
    message: pessoal
      ? 'O app usa o GPS pra medir quantos km você rodou neste frete, mesmo com o celular no bolso ou a tela bloqueada.\n\nO trajeto fica no seu aparelho — nenhuma empresa vê. Do frete, só fica o km que você registrar. A medição para sozinha quando você toca em "Cheguei".\n\nNa próxima tela, escolha "Permitir o tempo todo".'
      : 'Pra registrar o trajeto da sua viagem mesmo com o celular no bolso ou a tela bloqueada, o app precisa da localização em segundo plano.\n\nO trajeto vai só pro sistema da transportadora pra qual essa viagem é, e não é compartilhado com terceiros. A captura para automaticamente quando você finaliza a viagem.\n\nNa próxima tela, escolha "Permitir o tempo todo".',
    confirmLabel: "Continuar",
    cancelLabel: "Agora não",
  });
}

export type TrackingResumo = {
  kmReal: number;
  duracaoMin: number;
  velocidadeMediaKmh: number;
  pontos: Ponto[];
  iniciadoEm: string;
  id: string;
};

/**
 * Inicia tracking GPS em background (foreground service no Android).
 * Pede permissão de background location se necessário. Retorna false
 * se motorista negou permissão.
 */
type IniciarOpts = {
  distanciaMinMetros?: number;
  intervaloMaxSegundos?: number;
  precisaoAlta?: boolean;
  accuracyMaxMetros?: number;
  velocidadeMaxKmh?: number;
  /**
   * Frete por conta própria: muda o texto da permissão e o da notificação, e
   * guarda o destino junto do trajeto pra tela conseguir se recuperar depois de
   * o SO matar o app.
   */
  pessoal?: boolean;
  destino?: { texto: string; lat: number; lng: number };
  /** A tela já conversou sobre o "o tempo todo" — não repetir o pedido aqui. */
  pularPedidoSempre?: boolean;
};

/**
 * Por que o rastreio não começou. Boolean sozinho não bastava: a tela precisa
 * saber se ele NEGOU (aí o caminho é os Ajustes do sistema) ou se só recusou o
 * "o tempo todo" (aí dá pra rodar com o app aberto).
 */
export type FalhaTracking =
  | "sem-permissao-uso"
  | "sem-permissao-sempre"
  /** O SO não pergunta mais: só ligando na mão, nos Ajustes. */
  | "sempre-so-nos-ajustes"
  | "ja-tem-frete";

/**
 * Dá pra conseguir o "o tempo todo" a partir daqui?
 *
 * O iPhone mostra o alerta de "Permitir sempre" **uma vez só**. Depois disso,
 * `requestBackgroundPermissionsAsync()` retorna na hora, sem desenhar nada na
 * tela — foi o "cliquei em continuar e não muda nada". Quando é esse o caso, o
 * único caminho honesto é mandar o motorista pros Ajustes, não repetir um
 * pedido que o sistema já decidiu ignorar.
 */
/**
 * A permissão de uso (foreground) — a que realmente decide se há km ou não.
 *
 * Vem SEMPRE antes do "o tempo todo": o iOS não concede o "Sempre" a quem não
 * tem o "Durante o uso", e pedir na ordem errada faz o sistema mostrar só o
 * primeiro alerta — o motorista responde uma coisa e acha que respondeu outra.
 */
export async function garantirPermissaoUso(): Promise<
  "concedido" | "negado" | "so-nos-ajustes"
> {
  const Location = await import("expo-location");
  const atual = await Location.getForegroundPermissionsAsync();
  if (atual.status === "granted") return "concedido";
  if (!atual.canAskAgain) return "so-nos-ajustes";
  const r = await Location.requestForegroundPermissionsAsync();
  if (r.status === "granted") return "concedido";
  return r.canAskAgain ? "negado" : "so-nos-ajustes";
}

export async function estadoPermissaoSempre(): Promise<
  "concedido" | "pode-pedir" | "so-nos-ajustes"
> {
  const Location = await import("expo-location");
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status === "granted") return "concedido";
  return bg.canAskAgain ? "pode-pedir" : "so-nos-ajustes";
}

/**
 * Mostra o pre-prompt e, se ele topar, o pedido do sistema.
 * Devolve se o "o tempo todo" ficou concedido.
 */
export async function pedirPermissaoSempre(pessoal: boolean): Promise<boolean> {
  const Location = await import("expo-location");
  if (!(await prePromptBackgroundLocation(pessoal))) return false;
  const r = await Location.requestBackgroundPermissionsAsync();
  return r.status === "granted";
}

export async function iniciarTracking(opts: IniciarOpts = {}): Promise<boolean> {
  return (await iniciarTrackingDetalhado(opts)) === true;
}

/**
 * Igual, mas dizendo o que houve — e podendo seguir sem a permissão "o tempo
 * todo" (`exigirSempre: false`).
 *
 * No iPhone a primeira resposta é sempre "Durante o uso do app": o "Sempre" só
 * aparece depois, e muita gente toca em "Permitir uma vez". Tratar isso como
 * falha e parar ali deixava o motorista sem medir km NENHUM, quando medir com o
 * app aberto já resolve boa parte do frete.
 */
export async function iniciarTrackingDetalhado(
  opts: IniciarOpts & { exigirSempre?: boolean } = {},
): Promise<true | FalhaTracking> {
  // Garante que a task está registrada (idempotente)
  await registerTrackingTask();
  const Location = await import("expo-location");

  // 1) foreground primeiro (precondição pra background)
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    const r = await Location.requestForegroundPermissionsAsync();
    if (r.status !== "granted") return "sem-permissao-uso";
  }

  // 2) background — Android pede tela "Permitir o tempo todo".
  // Antes de mostrar o popup do sistema, explica POR QUÊ — Apple exige
  // pre-prompt explicativo, e melhora taxa de aceitação no Android também.
  //
  // `pularPedidoSempre` existe pra quem já negociou isso na tela: mostrar o
  // pre-prompt aqui de novo daria dois diálogos seguidos pedindo a mesma coisa.
  const exigirSempre = opts.exigirSempre !== false;
  if (!opts.pularPedidoSempre) {
    const estado = await estadoPermissaoSempre();
    if (estado === "so-nos-ajustes") {
      // O SO NÃO vai mostrar popup nenhum. Insistir aqui é o que fazia o
      // "Continuar" não fazer nada: o pre-prompt aparecia, ele aceitava, e
      // `requestBackgroundPermissionsAsync` voltava calado, sem UI nenhuma.
      if (exigirSempre) return "sempre-so-nos-ajustes";
    } else if (estado === "pode-pedir") {
      const aceitou = await prePromptBackgroundLocation(opts.pessoal === true);
      if (!aceitou && exigirSempre) return "sem-permissao-sempre";
      if (aceitou) {
        const r = await Location.requestBackgroundPermissionsAsync();
        if (r.status !== "granted" && exigirSempre) {
          return r.canAskAgain ? "sem-permissao-sempre" : "sempre-so-nos-ajustes";
        }
      }
    }
  }

  // 3) cria registro local da viagem em andamento (com config snapshot
  //    pra task de background filtrar consistente, mesmo se config mudar
  //    durante a viagem).
  //
  // Antes de escrever: se já existe uma corrida com trajeto, PERGUNTA. Sem esta
  // trava, quem voltasse pro app depois de o SO matá-lo e tocasse em "Começar"
  // apagava horas de km medido sem nem ver um aviso.
  const emCurso = await getViagemAndamento();
  if (emCurso && emCurso.pontos.length > 0) {
    const km = somarKm(emCurso.pontos);
    const trocar = await showConfirm({
      title: "Já tem um frete rodando",
      message: `O GPS mediu ${km.toFixed(1)} km neste frete. Começar outro agora descarta esse trajeto.`,
      confirmLabel: "Descartar e começar",
      cancelLabel: "Voltar pro frete",
      destructive: true,
    });
    if (!trocar) return "ja-tem-frete";
  }

  const novo: ViagemEmAndamento = {
    id: makeUuid(),
    iniciadoEm: new Date().toISOString(),
    pontos: [],
    config: {
      accuracyMaxMetros: opts.accuracyMaxMetros ?? 100,
      velocidadeMaxKmh: opts.velocidadeMaxKmh ?? 200,
    },
    ...(opts.destino ? { destino: opts.destino } : {}),
  };
  await setViagemAndamento(novo);

  // 4) inicia a task em background com foreground service (Android)
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }

  const distancia = opts.distanciaMinMetros ?? 50;
  const intervaloMs = (opts.intervaloMaxSegundos ?? 30) * 1000;
  const accuracy = opts.precisaoAlta
    ? Location.Accuracy.High
    : Location.Accuracy.Balanced;

  await Location.startLocationUpdatesAsync(TRACKING_TASK, {
    accuracy,
    distanceInterval: distancia,
    timeInterval: intervaloMs,
    deferredUpdatesInterval: intervaloMs,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      // "Tocando KM real percorrido" é jargão de quem escreveu o código. Na
      // barra de notificação de quem trabalha por conta própria, o que faz
      // sentido é o que ele está fazendo: um frete rodando.
      notificationTitle: opts.pessoal ? "Frete em andamento" : "Viagem em andamento",
      notificationBody: opts.pessoal
        ? "Medindo o km do seu frete. Toque pra abrir."
        : NOTIFICATION_BODY_INICIAL,
      notificationColor: "#ea580c",
    },
  });

  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return true;
}

/**
 * Para o tracking e devolve resumo (KM, duração, etc). NÃO limpa o
 * AsyncStorage — caller decide (Finalizar limpa, Cancelar limpa, mas
 * a navegação pra nova-viagem precisa dos pontos antes de limpar).
 */
export async function pararTracking(): Promise<TrackingResumo | null> {
  const Location = await import("expo-location");

  const isRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }

  const v = await getViagemAndamento();
  if (!v) return null;

  return calcularResumo(v);
}

/** Cancela e descarta a viagem em andamento (sem salvar nada). */
export async function cancelarTracking(): Promise<void> {
  const Location = await import("expo-location");
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }
  await clearViagemAndamento();
}

export function calcularResumo(v: ViagemEmAndamento): TrackingResumo {
  const kmReal = somarKm(v.pontos);
  const duracaoMs = Date.now() - new Date(v.iniciadoEm).getTime();
  const duracaoMin = Math.max(0, duracaoMs / 60_000);
  const velocidadeMediaKmh = duracaoMin > 0 ? (kmReal / duracaoMin) * 60 : 0;
  return {
    id: v.id,
    iniciadoEm: v.iniciadoEm,
    pontos: v.pontos,
    kmReal,
    duracaoMin,
    velocidadeMediaKmh,
  };
}

/** Soma das distâncias Haversine entre pontos consecutivos (em km). */
export function somarKm(pontos: Ponto[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    total += haversineKm(pontos[i - 1], pontos[i]);
  }
  return total;
}

function haversineKm(a: Ponto, b: Ponto): number {
  const R = 6371; // raio da Terra em km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Hook reativo que lê AsyncStorage a cada 5s pra atualizar a UI da
 * tela "viagem em andamento". Não é mais sofisticado que isso — a
 * tela só precisa refletir os pontos que o task em background salva.
 */
export function useViagemAndamento(active = true): {
  data: ViagemEmAndamento | null;
  resumo: TrackingResumo | null;
} {
  const [data, setData] = useState<ViagemEmAndamento | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;

    const tick = async () => {
      const v = await getViagemAndamento();
      if (alive) setData(v);
    };

    void tick();
    const id = setInterval(() => void tick(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);

  return { data, resumo: data ? calcularResumo(data) : null };
}
