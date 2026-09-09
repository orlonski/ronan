import { API_URL } from "./api";

/**
 * Contagem de navegação do site institucional.
 *
 * Desenhada pra NÃO ser dado pessoal, e a diferença é deliberada:
 *
 *  - sem cookie (por isso não existe banner de consentimento aqui);
 *  - o id de sessão vive em `sessionStorage` e morre quando a aba fecha, então
 *    não liga duas visitas da mesma pessoa;
 *  - nada de IP, user-agent, resolução ou qualquer coisa que sirva de
 *    fingerprint;
 *  - a query string nunca é enviada — ela pode carregar e-mail, telefone, o que
 *    o link tiver. Só o caminho vai.
 *
 * Respeita "Do Not Track" e Global Privacy Control: se o visitante pediu pra não
 * ser rastreado, a gente não conta. Perder a estatística de quem não quer ser
 * contado é o preço certo a pagar.
 */

const CHAVE_SESSAO = "mv_sessao";

type Navegador = Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };

/** true quando o visitante sinalizou que não quer rastreio. */
function recusouRastreio(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navegador;
  if (nav.globalPrivacyControl === true) return true;
  if (nav.doNotTrack === "1" || nav.msDoNotTrack === "1") return true;
  if (typeof window !== "undefined" && (window as { doNotTrack?: string }).doNotTrack === "1") {
    return true;
  }
  return false;
}

/**
 * Id da visita. Aleatório, curto, sem significado — só serve pra saber que
 * cinco pageviews são de uma pessoa só. Some ao fechar a aba.
 */
function idSessao(): string | undefined {
  try {
    const existente = sessionStorage.getItem(CHAVE_SESSAO);
    if (existente) return existente;
    const novo = Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(CHAVE_SESSAO, novo);
    return novo;
  } catch {
    // Navegador com armazenamento bloqueado: segue sem sessão, o evento ainda conta.
    return undefined;
  }
}

/** Só o host de quem indicou. A URL inteira do referrer pode conter dado alheio. */
function hostDeOrigem(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const url = new URL(document.referrer);
    if (url.host === location.host) return undefined;
    return url.host;
  } catch {
    return undefined;
  }
}

/**
 * Marcação de campanha da URL, guardada na sessão — o visitante clica no anúncio,
 * navega três páginas e só então preenche o formulário; sem guardar, a origem
 * do lead se perderia no caminho.
 */
type Utm = { utmSource?: string; utmMedium?: string; utmCampaign?: string };

const CHAVE_UTM = "mv_utm";

export function utmAtual(): Utm {
  try {
    const params = new URLSearchParams(location.search);
    const daUrl: Utm = {
      utmSource: params.get("utm_source") ?? undefined,
      utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined,
    };

    if (daUrl.utmSource || daUrl.utmMedium || daUrl.utmCampaign) {
      sessionStorage.setItem(CHAVE_UTM, JSON.stringify(daUrl));
      return daUrl;
    }

    const guardado = sessionStorage.getItem(CHAVE_UTM);
    return guardado ? (JSON.parse(guardado) as Utm) : {};
  } catch {
    return {};
  }
}

export type TipoEvento =
  | "PAGEVIEW"
  | "CTA_WHATSAPP"
  | "CTA_FORMULARIO_ABRIU"
  | "CTA_FORMULARIO_ENVIOU"
  | "CTA_APP"
  | "SECAO_VISTA";

/**
 * Registra um evento. Nunca lança e nunca bloqueia a navegação — usa
 * `sendBeacon` quando existe, que sobrevive à página sendo fechada no meio.
 */
export function registrar(tipo: TipoEvento, rotulo?: string): void {
  if (recusouRastreio()) return;

  const corpo = JSON.stringify({
    tipo,
    caminho: location.pathname,
    rotulo,
    referenciaHost: hostDeOrigem(),
    sessao: idSessao(),
    ...utmAtual(),
  });

  const url = `${API_URL}/publico/captacao/evento`;

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([corpo], { type: "application/json" }));
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics jamais derruba a página de ninguém.
  }
}

/** Chamado uma vez no boot. */
export function iniciarAnalytics(): void {
  registrar("PAGEVIEW");
}
