import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AtualizarViagemInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { ViagensAdminService } from "./viagens.service";

const RotacaoFotoInput = z.object({
  rotacao: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
type RotacaoFotoInput = z.infer<typeof RotacaoFotoInput>;

const PreValidarInput = z
  .object({
    status: z.enum(["OK", "DIVERGENTE", "DESFAZER"]),
    motivo: z.string().min(2).max(500).optional(),
    /** Tipo da divergência. Default "OUTRO". Tipos estruturados desbloqueiam
     * UI dedicada no app motorista (input de valor, botão de tirar foto, etc). */
    tipo: z.enum(["PEDAGIO_SEM_VALOR", "FOTO_ILEGIVEL", "OUTRO"]).optional(),
  })
  .refine(
    (d) => d.status !== "DIVERGENTE" || (d.motivo && d.motivo.trim().length >= 2),
    {
      message: "Motivo obrigatório quando divergente.",
      path: ["motivo"],
    },
  );
type PreValidarInput = z.infer<typeof PreValidarInput>;

const CadastrarLocalDescargaInput = z.object({
  nome: z.string().min(2).max(120),
});

const ListViagensQuery = paginationQuerySchema.extend({
  motoristaId: z.string().uuid().optional(),
  veiculoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  localId: z.string().uuid().optional(),
  status: z
    .enum(["RASCUNHO_OFFLINE", "ENVIADA", "EM_CONFERENCIA", "DIVERGENTE", "AJUSTADA", "OK"])
    .optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type ListViagensQuery = z.infer<typeof ListViagensQuery>;

@ApiTags("admin/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/viagens")
export class ViagensAdminController {
  constructor(private readonly service: ViagensAdminService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListViagensQuery)) query: ListViagensQuery) {
    return this.service.list(query);
  }

  /**
   * Audita viagens cujo local de descarga provavelmente foi escolhido errado
   * com o raio antigo (maior). Lista com sugestão do local mais próximo do GPS
   * real, pra admin revisar e corrigir 1 a 1 (via PATCH :id). Não altera nada.
   * Declarado antes de :id pra não ser capturado pela rota dinâmica.
   */
  @Get("descargas-suspeitas")
  descargasSuspeitas() {
    return this.service.descargasSuspeitas();
  }

  /**
   * Caso "sem local cadastrado" da auditoria: admin digita o nome, cria o
   * local no GPS de lançamento da viagem e já atribui. Reusa atualizar.
   */
  @Post("descargas-suspeitas/:id/cadastrar-local")
  cadastrarLocalDescarga(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CadastrarLocalDescargaInput))
    body: z.infer<typeof CadastrarLocalDescargaInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.cadastrarLocalDescarga(id, body.nome, user.id);
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @Get(":id/historico")
  historico(@Param("id") id: string) {
    return this.service.historico(id);
  }

  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarViagemInput))
    body: AtualizarViagemInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizar(id, body, user.id);
  }

  @Post(":id/recalcular-trajeto")
  recalcularTrajeto(
    @Param("id") id: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.recalcularTrajeto(id, user.id);
  }

  @Post(":id/pre-validar")
  preValidar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(PreValidarInput)) body: PreValidarInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.preValidar(id, body, user.id);
  }

  @Roles("ADMIN")
  @Delete(":id")
  @HttpCode(204)
  async excluir(@Param("id") id: string) {
    await this.service.excluir(id);
  }

  @Get(":id/fotos/:fotoId")
  async foto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.fotoBuffer(id, fotoId);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  @Patch(":id/fotos/:fotoId")
  rotacionarFoto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Body(new ZodValidationPipe(RotacaoFotoInput)) body: RotacaoFotoInput,
  ) {
    return this.service.rotacionarFoto(id, fotoId, body.rotacao);
  }

  /**
   * Apaga uma TicketFoto específica (admin removendo foto ruim depois
   * de recortar uma melhor, por exemplo). Remove o objeto no MinIO e
   * a linha no DB.
   */
  @Delete(":id/fotos/:fotoId")
  @HttpCode(204)
  async excluirFoto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
  ): Promise<void> {
    await this.service.excluirFoto(id, fotoId);
  }

  /**
   * Admin anexa foto a viagem existente. Multipart direto (sem 2-step),
   * já que admin no dashboard sempre tem rede. Registra auditoria.
   */
  @Post(":id/fotos")
  @UseInterceptors(FileInterceptor("foto"))
  async adicionarFoto(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthAdminUser,
  ) {
    if (!file) throw new BadRequestException("Foto não enviada");
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo não permitido: ${file.mimetype}`);
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException("Foto maior que 10MB");
    }
    return this.service.adicionarFoto(id, file.buffer, file.mimetype, user.id);
  }
}
