import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import type { AuthFuncionario, AuthMotorista } from "../auth/types";
import { PontoAdminService } from "./ponto-admin.service";
import { PontoService } from "./ponto.service";
import { CapacidadeLivre, RequerCapacidade } from "../common/acesso-app/capacidade.decorator";

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const COMPETENCIA = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * Resolve o cadastro de funcionário a partir do token, seja ele qual for.
 *
 * Devolve sempre a MESMA forma pro service, pra ele não ter que saber com que
 * tipo de token a requisição chegou.
 */
function funcionarioDe(user: AuthFuncionario | AuthMotorista): AuthFuncionario {
  if (user.kind === "FUNCIONARIO") return user;
  if (!user.funcionarioId) {
    throw new ForbiddenException(
      "Você não tem cadastro de funcionário nesta empresa. O ponto é de quem é registrado em carteira.",
    );
  }
  return {
    kind: "FUNCIONARIO",
    id: user.id,
    nome: user.nome,
    cpf: user.cpf,
    funcionarioId: user.funcionarioId,
    contaId: user.contaId,
    contaSomenteLeitura: user.contaSomenteLeitura,
  };
}

const ConferirEspelhoInput = z.object({
  competencia: COMPETENCIA,
  concorda: z.boolean(),
  observacao: z.string().trim().max(1000).optional(),
  hash: z.string().min(16),
});

/**
 * O que o FUNCIONÁRIO REGISTRADO faz pelo app.
 *
 * ⚠️ Aceita os DOIS papéis, e isso não afrouxa nada. `FUNCIONARIO` é quem só
 * é registrado (mecânico, escritório); `MOTORISTA` é quem tem cadastro de
 * motorista E é CLT — o motorista da própria transportadora, que lança viagem
 * e bate ponto no mesmo dia. A exclusividade que `RegimeVigente` garante é
 * entre OBRA E DIÁRIA e PONTO, não entre os dois cadastros.
 *
 * Quem passa no papel mas não tem cadastro de funcionário não entra: é o
 * `funcionarioDe()` abaixo que cobra isso, e a mensagem diz o porquê.
 */
@ApiTags("motorista/ponto")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("FUNCIONARIO", "MOTORISTA")
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
  @RequerCapacidade("app.ponto.bater")
  marcar(
    @CurrentUser() user: AuthFuncionario | AuthMotorista,
    @Body(new ZodValidationPipe(MarcacaoPontoInput)) body: MarcacaoPontoInput,
    @AppInfo() appInfo: AppInfoHeaders,
  ) {
    return this.service.registrar(funcionarioDe(user), body, { appVersao: appInfo.appVersao });
  }

  @Get("hoje")
  @RequerCapacidade({ algum: ["app.ponto.bater", "app.ponto.espelho"] })
  hoje(@CurrentUser() user: AuthFuncionario | AuthMotorista, @Query(new ZodValidationPipe(z.object({ dia: DIA }))) q: { dia: string }) {
    return this.service.hoje(funcionarioDe(user), q.dia);
  }

  @Get("catalogo")
  @RequerCapacidade({ algum: ["app.ponto.bater", "app.ponto.espelho"] })
  catalogo() {
    return this.service.catalogo();
  }

  @Get("espelho")
  @RequerCapacidade("app.ponto.espelho")
  espelho(
    @CurrentUser() user: AuthFuncionario | AuthMotorista,
    @Query("competencia", new ZodValidationPipe(COMPETENCIA)) competencia: string,
  ) {
    return this.service.meuEspelho(funcionarioDe(user), competencia, this.admin);
  }

  @PermiteSomenteLeitura()
  @Post("espelho/conferir")
  @RequerCapacidade("app.ponto.espelho")
  conferir(
    @CurrentUser() user: AuthFuncionario | AuthMotorista,
    @Body(new ZodValidationPipe(ConferirEspelhoInput)) body: z.infer<typeof ConferirEspelhoInput>,
    @Req() req: Request,
  ) {
    return this.service.conferirEspelho(funcionarioDe(user), body, {
      ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @PermiteSomenteLeitura()
  @Post("correcoes")
  @RequerCapacidade("app.ponto.corrigir")
  pedirCorrecao(
    @CurrentUser() user: AuthFuncionario | AuthMotorista,
    @Body(new ZodValidationPipe(CorrecaoPontoInput)) body: CorrecaoPontoInput,
  ) {
    return this.service.pedirCorrecao(funcionarioDe(user), body);
  }

  /** Cancelar o PRÓPRIO pedido, enquanto ninguém decidiu. */
  @PermiteSomenteLeitura()
  @Delete("correcoes/:id")
  @RequerCapacidade("app.ponto.corrigir")
  cancelarCorrecao(
    @CurrentUser() user: AuthFuncionario | AuthMotorista,
    @Param("id") id: string,
  ) {
    return this.service.cancelarCorrecao(funcionarioDe(user), id);
  }

  @PermiteSomenteLeitura()
  @Post("correcoes/:id/ciencia")
  @CapacidadeLivre("Ciência de correção feita pelo escritório: direito do trabalhador, não se desliga.")
  ciencia(@CurrentUser() user: AuthFuncionario | AuthMotorista, @Param("id") id: string) {
    return this.service.darCiencia(funcionarioDe(user), id);
  }
}
