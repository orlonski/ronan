import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../auth/types";

/**
 * Captura a versão do app que cada motorista está rodando, lendo headers que
 * o app nativo injeta em toda request (ver apps/motorista-app/lib/api.ts):
 *   x-app-version    → Constants.expoConfig.version (ex: "1.2.0")
 *   x-app-update-id  → Updates.updateId (id do bundle OTA)
 *   x-app-built-at   → Updates.createdAt em ISO (quando o bundle foi publicado)
 *   x-app-channel    → canal EAS Update (ex: "production")
 *
 * Grava no registro do motorista. Como roda em TODA request, usa um cache em
 * memória pra evitar marteladas no banco: só escreve quando o updateId muda
 * OU quando faz mais de STALE_MS desde a última escrita (pra manter o
 * "appVistoEm" / visto online razoavelmente fresco). A escrita é
 * fire-and-forget — nunca atrasa nem derruba a resposta da request.
 */
@Injectable()
export class AppVersionInterceptor implements NestInterceptor {
  // Refresca o "visto online" no máximo a cada 15 min por motorista.
  private static readonly STALE_MS = 15 * 60 * 1000;
  private readonly ultimaGravacao = new Map<string, { updateId: string; ts: number }>();

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    try {
      const req = context.switchToHttp().getRequest<{
        user?: AuthUser;
        headers: Record<string, string | string[] | undefined>;
      }>();
      const user = req.user;
      if (user?.kind === "MOTORISTA") {
        this.capturar(user.id, req.headers);
      }
    } catch {
      /* captura de versão nunca pode quebrar a request */
    }
    return next.handle();
  }

  private capturar(
    motoristaId: string,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const appVersion = header(headers, "x-app-version");
    const appPlatform = normalizarPlatform(header(headers, "x-app-platform"));
    const appUpdateId = header(headers, "x-app-update-id");
    const builtAtRaw = header(headers, "x-app-built-at");
    const appCanal = header(headers, "x-app-channel");
    // Sem nenhum header de versão (ex: PWA, request antiga) → nada a fazer.
    if (!appVersion && !appUpdateId && !builtAtRaw) return;

    const now = Date.now();
    const prev = this.ultimaGravacao.get(motoristaId);
    const chave = appUpdateId ?? appVersion ?? "";
    if (prev && prev.updateId === chave && now - prev.ts < AppVersionInterceptor.STALE_MS) {
      return; // mesma versão e gravado há pouco — pula
    }
    this.ultimaGravacao.set(motoristaId, { updateId: chave, ts: now });

    const appBuiltAt = builtAtRaw ? safeDate(builtAtRaw) : undefined;
    void this.prisma.motorista
      .update({
        where: { id: motoristaId },
        data: {
          appVersion: appVersion ?? undefined,
          appPlatform: appPlatform ?? undefined,
          appUpdateId: appUpdateId ?? undefined,
          appBuiltAt: appBuiltAt ?? undefined,
          appCanal: appCanal ?? undefined,
          appVistoEm: new Date(),
        },
      })
      .catch(() => {
        // Motorista pode ter sido deletado mid-flight, ou DB hiccup.
        // Limpa o cache pra tentar de novo na próxima e segue a vida.
        this.ultimaGravacao.delete(motoristaId);
      });
  }
}

/** Só aceita "ios"/"android" (Platform.OS). Qualquer outra coisa vira undefined. */
function normalizarPlatform(v: string | undefined): "ios" | "android" | undefined {
  const s = v?.toLowerCase();
  return s === "ios" || s === "android" ? s : undefined;
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

function safeDate(iso: string): Date | undefined {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
