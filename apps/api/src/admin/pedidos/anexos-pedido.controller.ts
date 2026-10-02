import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AtualizarAnexoPedidoInput, LIMITE_ANEXO_PEDIDO } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { AnexosPedidoService } from "./anexos-pedido.service";

/**
 * Os papéis do pedido no painel. Sem chave nova: ver anexo é ver o pedido,
 * mexer em anexo é editar o pedido — é o mesmo trabalho de quem negocia com o
 * cliente.
 */
@ApiTags("admin/pedidos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/pedidos/:pedidoId/anexos")
export class AnexosPedidoController {
  constructor(private readonly service: AnexosPedidoService) {}

  @RequerPermissao("pedidos.ver")
  @Get()
  listar(@Param("pedidoId") pedidoId: string) {
    return this.service.listar(pedidoId);
  }

  @RequerPermissao("pedidos.editar")
  @Post()
  @UseInterceptors(
    // O teto do Multer corta o upload no meio em vez de deixar o arquivo
    // inteiro chegar à memória pra só então recusar.
    FileInterceptor("arquivo", { limits: { fileSize: LIMITE_ANEXO_PEDIDO.bytes, files: 1 } }),
  )
  anexar(
    @Param("pedidoId") pedidoId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.anexar(
      pedidoId,
      arquivo && {
        buffer: arquivo.buffer,
        mimetype: arquivo.mimetype,
        size: arquivo.size,
        originalname: arquivo.originalname,
      },
      user.id,
    );
  }

  @RequerPermissao("pedidos.ver")
  @Get(":anexoId/arquivo")
  async arquivo(
    @Param("pedidoId") pedidoId: string,
    @Param("anexoId") anexoId: string,
    @Res() res: Response,
  ) {
    const a = await this.service.doPainel(pedidoId, anexoId);
    await this.service.servir(a, res);
  }

  @RequerPermissao("pedidos.editar")
  @Patch(":anexoId")
  alterar(
    @Param("pedidoId") pedidoId: string,
    @Param("anexoId") anexoId: string,
    @Body(new ZodValidationPipe(AtualizarAnexoPedidoInput)) body: AtualizarAnexoPedidoInput,
  ) {
    return this.service.alterarVisibilidade(pedidoId, anexoId, body.visivelMotorista);
  }

  @RequerPermissao("pedidos.editar")
  @Delete(":anexoId")
  excluir(@Param("pedidoId") pedidoId: string, @Param("anexoId") anexoId: string) {
    return this.service.excluir(pedidoId, anexoId);
  }
}
