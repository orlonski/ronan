import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** Versão do app extraída dos headers (null pra PWA / request antiga). */
export type AppInfoHeaders = {
  appVersao: string | null;
  appUpdateId: string | null;
};

/**
 * Extrai a versão do app que o motorista roda, dos headers que o app nativo
 * injeta em toda request (x-app-version / x-app-update-id — ver
 * apps/motorista-app/lib/api.ts e AppVersionInterceptor). Usado pra carimbar a
 * versão na CRIAÇÃO da viagem. PWA / request antiga → campos null.
 */
export const AppInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AppInfoHeaders => {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const pick = (name: string): string | null => {
      const v = req.headers?.[name];
      const s = Array.isArray(v) ? v[0] : v;
      return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
    };
    return {
      appVersao: pick("x-app-version"),
      appUpdateId: pick("x-app-update-id"),
    };
  },
);
