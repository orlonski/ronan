import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ResgatarLancamentoInput } from "@ronan/shared-types";
import { AppInfo, type AppInfoHeaders } from "../auth/decorators/app-info.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { LancamentosResgatadosService } from "../lancamentos-resgatados/lancamentos-resgatados.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";

/**
 * Onde o app deposita o lançamento que ele não conseguiu enviar.
 *
 * SEM `@AcessoMotorista(...)` de propósito: o resgate não é uma feature em
 * rollout, é a rede que impede o lançamento de sumir. Gatear por flag deixaria
 * justamente quem ainda não tem a flag sem rede nenhuma. Continua exigindo
 * motorista autenticado — o `AcessoMotoristaGuard` fica de fora porque, sem
 * decorator, ele passaria direto de qualquer jeito.
 */
@ApiTags("motorista/lancamentos-travados")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/lancamentos-travados")
export class LancamentosResgatadosMotoristaController {
  constructor(private readonly service: LancamentosResgatadosService) {}

  @Post()
  guardar(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(ResgatarLancamentoInput)) body: ResgatarLancamentoInput,
    @AppInfo() appInfo: AppInfoHeaders,
  ) {
    return this.service.guardar(
      { id: user.id, nome: user.nome },
      body,
      appInfo.appVersao,
    );
  }
}
