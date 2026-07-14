import { Injectable } from "@nestjs/common";
import {
  compararVersao,
  storeUrls,
  type AcaoAtualizacao,
  type AppPlatform,
  type ModoForcaAtualizacao,
  type VersaoAppResponse,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

const SINGLETON_ID = "default";

// Uma versão só vira "a última" (piso de bloqueio) depois de vista rodando em
// pelo menos este tanto de motoristas DISTINTOS. Trava de segurança contra um
// device com clock/versão maluca (ou sideload) que sozinho trancaria a frota.
const MIN_DEVICES_PRA_FIRMAR = 2;

// Só considera versões reportadas recentemente — motorista sumido há meses não
// deve puxar o piso pra cima (nem segurar num número velho).
const JANELA_DIAS = 90;

export type AtualizarForcaInput = {
  modo?: ModoForcaAtualizacao;
  versaoMinimaIos?: string | null;
  versaoMinimaAndroid?: string | null;
  motoristasAlvo?: string[];
};

/** Versão detectada automaticamente pra uma plataforma (pro painel). */
type VersaoDetectada = {
  versao: string;
  motoristas: number; // devices distintos que reportaram (firmou se >= MIN)
};

@Injectable()
export class ForcaAtualizacaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garante o singleton e retorna a config. */
  async getConfig() {
    return this.prisma.configuracaoForcaAtualizacao.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  async update(input: AtualizarForcaInput, userId: string) {
    return this.prisma.configuracaoForcaAtualizacao.upsert({
      where: { id: SINGLETON_ID },
      update: { ...input, alteradoPorId: userId },
      create: { id: SINGLETON_ID, ...input, alteradoPorId: userId },
    });
  }

  /**
   * Maior versão firmada (vista em >= MIN motoristas) por plataforma, dentro da
   * janela. Retorna também a contagem, pro dashboard mostrar "detectado: 1.0.3
   * (em 8 motoristas)". Usa só o que o interceptor já grava — zero dependência
   * de loja/API externa.
   */
  async detectarVersoes(): Promise<Record<AppPlatform, VersaoDetectada | null>> {
    const desde = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    const linhas = await this.prisma.motorista.groupBy({
      by: ["appPlatform", "appVersion"],
      where: {
        appVistoEm: { gte: desde },
        appVersion: { not: null },
        appPlatform: { in: ["ios", "android"] },
      },
      _count: { _all: true },
    });

    const out: Record<AppPlatform, VersaoDetectada | null> = {
      ios: null,
      android: null,
    };
    for (const plataforma of ["ios", "android"] as const) {
      let melhor: VersaoDetectada | null = null;
      for (const l of linhas) {
        if (l.appPlatform !== plataforma || !l.appVersion) continue;
        const n = l._count._all;
        if (n < MIN_DEVICES_PRA_FIRMAR) continue; // ainda não firmou
        if (!melhor || (compararVersao(l.appVersion, melhor.versao) ?? 0) > 0) {
          melhor = { versao: l.appVersion, motoristas: n };
        }
      }
      out[plataforma] = melhor;
    }
    return out;
  }

  /**
   * Decisão pra UM device: recebe a plataforma e a versão que ELE reportou e
   * devolve o que o app deve fazer. Fail-safe por construção:
   *  - modo off / plataforma desconhecida → nunca age;
   *  - versão do device ou alvo ilegível → nunca age (compararVersao = null);
   *  - só bloqueia/recomenda quando o device está COMPROVADAMENTE atrás de uma
   *    versão que existe (detectada em motoristas reais ou override manual).
   */
  async decidir(
    plataformaRaw: string | undefined,
    minhaVersao: string | null,
    motoristaId?: string,
  ): Promise<VersaoAppResponse> {
    const plataforma = normalizarPlataforma(plataformaRaw);
    // Store URL sempre calculável (default android — só usada quando age).
    const urls = storeUrls(plataforma ?? "android");
    const nada = (
      ultimaVersao: string | null,
      acao: AcaoAtualizacao = "nenhuma",
    ): VersaoAppResponse => ({
      acao,
      ultimaVersao,
      minhaVersao,
      storeUrl: urls.deepLink,
      storeUrlWeb: urls.web,
    });

    if (!plataforma) return nada(null);

    const config = await this.getConfig();
    const modo = config.modo as ModoForcaAtualizacao;
    if (modo === "off") return nada(null);

    // Allowlist de teste: se preenchida, só os motoristas listados são avaliados
    // (o resto nunca age). Vazia = vale pra todos. Permite testar o bloqueio em
    // produção mirando só a própria conta, sem tocar na frota.
    if (
      config.motoristasAlvo.length > 0 &&
      (!motoristaId || !config.motoristasAlvo.includes(motoristaId))
    ) {
      return nada(null);
    }

    // Alvo: override manual vence; senão a versão detectada automaticamente.
    const override =
      plataforma === "ios" ? config.versaoMinimaIos : config.versaoMinimaAndroid;
    let alvo = override ?? null;
    if (!alvo) {
      const detectadas = await this.detectarVersoes();
      alvo = detectadas[plataforma]?.versao ?? null;
    }
    if (!alvo) return nada(null); // nada firmou ainda → não age

    // O device está atrás do alvo? compararVersao devolve null se qualquer uma
    // for ilegível → tratamos como "não age" (fail-safe).
    const cmp =
      minhaVersao != null ? compararVersao(minhaVersao, alvo) : null;
    const desatualizado = cmp != null && cmp < 0;
    if (!desatualizado) return nada(alvo);

    // Está atrás. Ação depende do modo (observar = detecta mas não age).
    const acao: AcaoAtualizacao =
      modo === "bloquear"
        ? "bloquear"
        : modo === "nudge"
          ? "recomendar"
          : "nenhuma"; // observar
    return nada(alvo, acao);
  }
}

function normalizarPlataforma(v: string | undefined): AppPlatform | undefined {
  const s = v?.toLowerCase();
  return s === "ios" || s === "android" ? s : undefined;
}
