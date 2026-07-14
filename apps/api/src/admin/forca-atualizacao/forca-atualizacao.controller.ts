import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { MODOS_FORCA_ATUALIZACAO } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { ForcaAtualizacaoService } from "./forca-atualizacao.service";

// Versão vazia vira null (limpa o override → volta pro automático).
const versaoOpt = z
  .string()
  .trim()
  .max(20)
  .regex(/^\d+(\.\d+)*$/, "Use o formato x.y.z")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const AtualizarSchema = z.object({
  modo: z.enum(MODOS_FORCA_ATUALIZACAO).optional(),
  versaoMinimaIos: versaoOpt,
  versaoMinimaAndroid: versaoOpt,
  // Allowlist de teste: IDs de motoristas. Vazio = vale pra todos.
  motoristasAlvo: z.array(z.string()).optional(),
});

@ApiTags("admin/forca-atualizacao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/forca-atualizacao")
export class ForcaAtualizacaoController {
  constructor(private readonly service: ForcaAtualizacaoService) {}

  /** Config atual + versões detectadas automaticamente por plataforma. */
  @Roles("ADMIN_USER")
  @RequerPermissao("config-forca-atualizacao.ver")
  @Get()
  async get() {
    const [config, detectadas] = await Promise.all([
      this.service.getConfig(),
      this.service.detectarVersoes(),
    ]);
    return { config, detectadas };
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("config-forca-atualizacao.editar")
  @Put()
  update(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(AtualizarSchema)) body: z.infer<typeof AtualizarSchema>,
  ) {
    return this.service.update(body, user.id);
  }
}
