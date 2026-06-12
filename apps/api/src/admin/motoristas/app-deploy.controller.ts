import { Controller, Get, Headers, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { AppUpdateNotifierService } from "./app-update-notifier.service";

/**
 * Gatilho de "saiu versão nova" disparado pelo PRÓPRIO comando de publicar
 * (não tem login admin — é chamado por script de deploy). Protegido por um
 * segredo compartilhado no header `x-deploy-secret` (env DEPLOY_NOTIFY_SECRET).
 *
 * Uso (de apps/motorista-app, após publicar o OTA):
 *   eas update --branch production --message "..." && pnpm ota:avisar
 */
@ApiExcludeController()
@Controller("app/deploy")
export class AppDeployController {
  constructor(private readonly notifier: AppUpdateNotifierService) {}

  /**
   * Diagnóstico TEMPORÁRIO (remover depois): diz se o segredo está configurado
   * no servidor e se bate com o `probe` (hash do meu segredo), sem expor o valor.
   */
  @Get("diag")
  diag(@Query("probe") probe?: string) {
    const v = process.env.DEPLOY_NOTIFY_SECRET;
    const sha8 = v ? createHash("sha256").update(v).digest("hex").slice(0, 8) : null;
    return { configured: !!v, len: v?.length ?? 0, matches: !!probe && probe === sha8 };
  }

  @Post("nova-versao")
  async novaVersao(@Headers("x-deploy-secret") secret?: string) {
    const esperado = process.env.DEPLOY_NOTIFY_SECRET;
    if (!esperado || secret !== esperado) {
      throw new UnauthorizedException("segredo de deploy inválido");
    }
    const avisados = await this.notifier.notificarTodos();
    return { ok: true, avisados };
  }
}
