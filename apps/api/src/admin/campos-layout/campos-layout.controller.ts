import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CamposLayoutService } from "./campos-layout.service";

const TIPOS = ["TEXTO", "NUMERO", "DATA"] as const;

const CriarCampoSchema = z.object({
  label: z.string().min(2).max(80),
  slug: z.string().min(1).max(40).optional(),
  ordem: z.number().int().min(1).max(999).optional(),
  tipo: z.enum(TIPOS).optional(),
  descricao: z.string().max(300).optional(),
});

const AtualizarCampoSchema = CriarCampoSchema.partial().extend({
  ativo: z.boolean().optional(),
});

@ApiTags("admin/campos-layout")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/campos-layout")
export class CamposLayoutController {
  constructor(private readonly service: CamposLayoutService) {}

  @Roles("ADMIN", "OPERADOR")
  @Get()
  list() {
    return this.service.list();
  }

  @Roles("ADMIN")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Roles("ADMIN")
  @RequerPermissao("config-campos-layout.editar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarCampoSchema))
    body: z.infer<typeof CriarCampoSchema>,
  ) {
    return this.service.create(body);
  }

  @Roles("ADMIN")
  @RequerPermissao("config-campos-layout.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarCampoSchema))
    body: z.infer<typeof AtualizarCampoSchema>,
  ) {
    return this.service.update(id, body);
  }

  @Roles("ADMIN")
  @RequerPermissao("config-campos-layout.editar")
  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string) {
    await this.service.remove(id);
  }
}
