import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { CartaoCombustivelService } from "./cartao-combustivel.service";

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");
const ConciliacaoQuery = z
  .object({
    de: YMD,
    ate: YMD,
    situacao: z.enum(["CONFERE", "DIVERGE", "SO_NO_CARTAO", "PLACA_DESCONHECIDA"]).optional(),
  })
  .refine((q) => q.de <= q.ate, { message: "A data final não pode ser antes da inicial.", path: ["ate"] })
  .refine((q) => Date.parse(q.ate) - Date.parse(q.de) <= 93 * 86_400_000, {
    message: "Período máximo de 3 meses.",
    path: ["de"],
  });

const ImportarBody = z.object({ operadora: z.string().max(60).optional() });

const UPLOAD = FileInterceptor("arquivo", { limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * Cartão combustível: o extrato da operadora ao lado do que o motorista lançou.
 * Chave própria (`cartao-combustivel`): importar extrato é escritório
 * financeiro; ver a conciliação é de quem confere abastecimento.
 */
@ApiTags("admin/cartao-combustivel")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/cartao-combustivel")
export class CartaoCombustivelController {
  constructor(private readonly service: CartaoCombustivelService) {}

  @EscopoPor("veiculo")
  @RequerPermissao("cartao-combustivel.ver")
  @Get("conciliacao")
  conciliacao(
    @Query(new ZodValidationPipe(ConciliacaoQuery)) q: z.infer<typeof ConciliacaoQuery>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.conciliacao(q, user.escopo);
  }

  @RequerPermissao("cartao-combustivel.ver")
  @Get("extratos")
  extratos() {
    return this.service.listarExtratos();
  }

  /** Lê o arquivo e diz o que entraria. Não grava nada. */
  @RequerPermissao("cartao-combustivel.importar")
  @Post("previa")
  @UseInterceptors(UPLOAD)
  previa(@UploadedFile() arquivo: Express.Multer.File | undefined) {
    return this.service.previa(arquivo);
  }

  @RequerPermissao("cartao-combustivel.importar")
  @Post("importar")
  @UseInterceptors(UPLOAD)
  importar(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(ImportarBody)) body: z.infer<typeof ImportarBody>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.importar(arquivo, body.operadora ?? null, user.id);
  }

  @RequerPermissao("cartao-combustivel.importar")
  @Delete("extratos/:id")
  excluir(@Param("id") id: string) {
    return this.service.excluirExtrato(id);
  }
}
