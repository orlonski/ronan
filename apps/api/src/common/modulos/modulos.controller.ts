import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ModuloChaveSchema } from "@ronan/shared-types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { ZodValidationPipe } from "../zod-validation.pipe";
import type { AuthAdminUser } from "../../auth/types";
import { ModulosService } from "./modulos.service";

const DefinirModuloInput = z.object({
  ativo: z.boolean(),
  /** Fim do contrato/teste do módulo. Null = sem prazo. */
  vigenteAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  observacao: z.string().trim().max(300).nullish(),
});
type DefinirModuloInput = z.infer<typeof DefinirModuloInput>;

/**
 * O que cada empresa contratou.
 *
 * Atrás do `PlataformaGuard`, não da matriz de permissões: o dono da empresa não
 * escolhe o próprio contrato. Mesma régua que já vale pra preço do SaaS e pra
 * gestão de contas.
 */
@ApiTags("admin/modulos")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@Controller("admin/contas/:contaId/modulos")
export class ModulosController {
  constructor(private readonly service: ModulosService) {}

  @Get()
  listar(@Param("contaId") contaId: string) {
    return this.service.daConta(contaId);
  }

  @Put(":chave")
  definir(
    @Param("contaId") contaId: string,
    @Param("chave") chave: string,
    @Body(new ZodValidationPipe(DefinirModuloInput)) body: DefinirModuloInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.definir({
      contaId,
      chave: ModuloChaveSchema.parse(chave),
      ativo: body.ativo,
      vigenteAte: body.vigenteAte ?? null,
      observacao: body.observacao ?? null,
      usuarioId: user.id,
    });
  }
}
