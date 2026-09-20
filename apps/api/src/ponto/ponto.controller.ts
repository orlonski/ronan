import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { CorrecaoPontoInput, MarcacaoPontoInput } from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PermiteSomenteLeitura } from "../auth/decorators/permite-somente-leitura.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AppInfo, type AppInfoHeaders } from "../auth/decorators/app-info.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { AuthFuncionario } from "../auth/types";
import { PontoAdminService } from "./ponto-admin.service";
import { PontoService } from "./ponto.service";

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const COMPETENCIA = z.string().regex(/^\d{4}-\d{2}$/);

const ConferirEspelhoInput = z.object({
  competencia: COMPETENCIA,
  concorda: z.boolean(),
  observacao: z.string().trim().max(1000).optional(),
  hash: z.string().min(16),
});

/**
 * O que o FUNCIONÁRIO registrado faz pelo app.
 *
 * ⚠️ `@Roles("FUNCIONARIO")`, nunca `MOTORISTA`: motorista é o vínculo de
 * parceiro autônomo do módulo mensal. Misturar os dois papéis desfaria a
 * separação que `RegimeVigente` garante no banco.
 */
@ApiTags("motorista/ponto")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("FUNCIONARIO")
@Controller("m/ponto")
export class PontoMotoristaController {
  constructor(
    private readonly service: PontoService,
    private readonly admin: PontoAdminService,
  ) {}

  /**
   * ⚠️ O ENDPOINT MAIS PROTEGIDO DO SISTEMA — CONTRA NÓS MESMOS.
   *
   * Sem `@AcessoMotorista`, sem checagem de cadastro aprovado, sem guard de
   * módulo, sem feature flag. E com `@PermiteSomenteLeitura()`: a empresa com
   * a mensalidade em atraso entra em somente-leitura, e um guard global
   * recusaria esta escrita — impedindo o registro de jornada de um empregado
   * por causa de uma conta comercial nossa.
   *
   * Recusar aqui produz o pior documento possível numa reclamatória: a prova
   * de que a empresa impediu o registro de sobrejornada. Qualquer restrição
   * inventada neste handler vira argumento contra o nosso cliente.
   */
  @PermiteSomenteLeitura()
  @Post("marcacoes")
  marcar(
    @CurrentUser() user: AuthFuncionario,
    @Body(new ZodValidationPipe(MarcacaoPontoInput)) body: MarcacaoPontoInput,
    @AppInfo() appInfo: AppInfoHeaders,
  ) {
    return this.service.registrar(user, body, { appVersao: appInfo.appVersao });
  }

  @Get("hoje")
  hoje(@CurrentUser() user: AuthFuncionario, @Query(new ZodValidationPipe(z.object({ dia: DIA }))) q: { dia: string }) {
    return this.service.hoje(user, q.dia);
  }

  @Get("catalogo")
  catalogo() {
    return this.service.catalogo();
  }

  @Get("espelho")
  espelho(
    @CurrentUser() user: AuthFuncionario,
    @Query("competencia", new ZodValidationPipe(COMPETENCIA)) competencia: string,
  ) {
    return this.service.meuEspelho(user, competencia, this.admin);
  }

  @PermiteSomenteLeitura()
  @Post("espelho/conferir")
  conferir(
    @CurrentUser() user: AuthFuncionario,
    @Body(new ZodValidationPipe(ConferirEspelhoInput)) body: z.infer<typeof ConferirEspelhoInput>,
    @Req() req: Request,
  ) {
    return this.service.conferirEspelho(user, body, {
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @PermiteSomenteLeitura()
  @Post("correcoes")
  pedirCorrecao(
    @CurrentUser() user: AuthFuncionario,
    @Body(new ZodValidationPipe(CorrecaoPontoInput)) body: CorrecaoPontoInput,
  ) {
    return this.service.pedirCorrecao(user, body);
  }

  @PermiteSomenteLeitura()
  @Post("correcoes/:id/ciencia")
  ciencia(@CurrentUser() user: AuthFuncionario, @Param("id") id: string) {
    return this.service.darCiencia(user, id);
  }
}
