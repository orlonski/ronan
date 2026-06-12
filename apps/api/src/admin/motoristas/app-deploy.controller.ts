import { Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
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
