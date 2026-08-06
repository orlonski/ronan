import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { EscopoPor } from "../common/escopo/escopo.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CompartilhamentoService, DIAS_VALIDADE } from "./compartilhamento.service";

const GerarLinkInput = z.object({
  diasValidade: z
    .union([z.literal(DIAS_VALIDADE[0]), z.literal(DIAS_VALIDADE[1]), z.literal(DIAS_VALIDADE[2])])
    .default(30),
});
type GerarLinkInput = z.infer<typeof GerarLinkInput>;

const EnviarWhatsappInput = z.object({
  telefone: z.string().min(10).max(20),
  mensagemExtra: z.string().max(300).optional(),
});
type EnviarWhatsappInput = z.infer<typeof EnviarWhatsappInput>;

/**
 * O comprovante público expõe km e toneladas FATURADOS (mínimo aplicado), que
 * `admin/viagens/comercial.ts` esconde de quem não tem `viagens.ver-comercial`.
 * Sem esta checagem, um usuário sem a chave geraria um link que mostra mais do
 * que ele mesmo enxerga no painel — escalada de privilégio pela porta lateral.
 *
 * Vive aqui e não no decorator porque `@RequerPermissao` é OR entre chaves; o
 * que precisamos é AND com `viagens.compartilhar`.
 */
function exigirComercial(user: AuthAdminUser) {
  if (!user.permissoes.includes("viagens.ver-comercial")) {
    throw new ForbiddenException(
      "Compartilhar o comprovante expõe km e toneladas faturados — exige a permissão de dados comerciais.",
    );
  }
}

@ApiTags("admin/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/viagens/:viagemId/compartilhamentos")
export class CompartilhamentoAdminController {
  constructor(private readonly service: CompartilhamentoService) {}

  @EscopoPor("viagem")
  @RequerPermissao("viagens.compartilhar")
  @Get()
  listar(@Param("viagemId") viagemId: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.listar(viagemId, user.escopo);
  }

  @EscopoPor("viagem")
  @RequerPermissao("viagens.compartilhar")
  @Post()
  gerar(
    @Param("viagemId") viagemId: string,
    @Body(new ZodValidationPipe(GerarLinkInput)) body: GerarLinkInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    exigirComercial(user);
    return this.service.gerar(viagemId, body.diasValidade, user.id, user.escopo);
  }

  @EscopoPor("viagem")
  @RequerPermissao("viagens.compartilhar")
  @Post(":id/enviar-whatsapp")
  enviar(
    @Param("viagemId") viagemId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarWhatsappInput)) body: EnviarWhatsappInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    exigirComercial(user);
    return this.service.enviarWhatsapp(viagemId, id, body, user.id, user.escopo);
  }

  @EscopoPor("viagem")
  @RequerPermissao("viagens.compartilhar")
  @Delete(":id")
  @HttpCode(204)
  async revogar(
    @Param("viagemId") viagemId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.service.revogar(viagemId, id, user.id, user.escopo);
  }
}
