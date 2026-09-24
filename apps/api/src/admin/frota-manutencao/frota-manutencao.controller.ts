import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AbrirManutencaoDoProblemaInput,
  AtualizarManutencaoInput,
  AvisarProblemaVeiculoInput,
  DescartarProblemaVeiculoInput,
  AtualizarMultaInput,
  CriarManutencaoInput,
  CriarMultaInput,
  CriarPlanoManutencaoInput,
  SalvarDocumentoVeiculoInput,
  SalvarPneuInput,
  STATUS_MANUTENCAO,
  STATUS_MULTA,
  TIPOS_MANUTENCAO,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser, AuthMotorista } from "../../auth/types";
import { RequerCapacidade } from "../../common/acesso-app/capacidade.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { FrotaManutencaoService, MAX_FOTOS_PROBLEMA } from "./frota-manutencao.service";

const ListManutencoes = paginationQuerySchema.extend({
  veiculoId: z.string().uuid().optional(),
  status: z.enum(STATUS_MANUTENCAO).optional(),
  tipo: z.enum(TIPOS_MANUTENCAO).optional(),
});
const ListPneus = paginationQuerySchema.extend({
  veiculoId: z.string().uuid().optional(),
  ativo: z.enum(["true", "false"]).optional(),
});
const ListMultas = paginationQuerySchema.extend({
  status: z.enum(STATUS_MULTA).optional(),
  veiculoId: z.string().uuid().optional(),
  motoristaId: z.string().uuid().optional(),
});

/** Manutenção, plano preventivo e o painel de alertas da frota. */
@ApiTags("admin/manutencao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/manutencao")
export class ManutencaoController {
  constructor(
    private readonly service: FrotaManutencaoService,
    private readonly uploads: UploadsService,
  ) {}

  @EscopoPor("veiculo")
  @RequerPermissao("manutencao.ver")
  @Get("alertas")
  alertas(@CurrentUser() user: AuthAdminUser) {
    return this.service.alertas(user.escopo);
  }

  @EscopoPor("veiculo")
  @RequerPermissao("manutencao.ver")
  @Get()
  list(
    @Query(new ZodValidationPipe(ListManutencoes)) q: z.infer<typeof ListManutencoes>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.listManutencoes(q, user.escopo);
  }

  @RequerPermissao("manutencao.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarManutencaoInput)) body: CriarManutencaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarManutencao(body, user.id);
  }

  @RequerPermissao("manutencao.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarManutencaoInput)) body: AtualizarManutencaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarManutencao(id, body, user.id);
  }

  @RequerPermissao("manutencao.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerManutencao(id);
  }

  /** Os avisos dos motoristas. `?status=` mostra os já decididos. */
  @RequerPermissao("manutencao.ver")
  @Get("problemas")
  problemas(@Query("status") status?: string) {
    return this.service.listarProblemas(status);
  }

  /** A foto do aviso, servida pela API: o bucket não tem domínio público. */
  @RequerPermissao("manutencao.ver")
  @Get("problemas/:id/fotos/:indice")
  async fotoDoProblema(
    @Param("id") id: string,
    @Param("indice") indice: string,
    @Query("mini") mini: string | undefined,
    @Res() res: Response,
  ) {
    const chave = await this.service.fotoDoProblema(id, Number(indice) || 0);
    const mime = chave.endsWith(".png") ? "image/png" : "image/jpeg";
    if (mini) {
      const thumb = await this.uploads.miniatura(chave, mime, null);
      if (thumb) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
        res.end(thumb);
        return;
      }
    }
    const stream = await this.uploads.getObjectStream(chave);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
    stream.pipe(res);
  }

  @RequerPermissao("manutencao.criar")
  @Post("problemas/:id/abrir-manutencao")
  abrirManutencaoDoProblema(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AbrirManutencaoDoProblemaInput)) body: AbrirManutencaoDoProblemaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.abrirManutencaoDoProblema(id, body, user.id);
  }

  @RequerPermissao("manutencao.editar")
  @Post("problemas/:id/descartar")
  descartarProblema(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DescartarProblemaVeiculoInput)) body: DescartarProblemaVeiculoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.descartarProblema(id, body.motivo, user.id);
  }

  @RequerPermissao("manutencao.ver")
  @Get("planos")
  listarPlanos() {
    return this.service.listarPlanos();
  }

  @RequerPermissao("manutencao.criar")
  @Post("planos")
  criarPlano(
    @Body(new ZodValidationPipe(CriarPlanoManutencaoInput)) body: CriarPlanoManutencaoInput,
  ) {
    return this.service.criarPlano(body);
  }

  @RequerPermissao("manutencao.excluir")
  @Delete("planos/:id")
  removerPlano(@Param("id") id: string) {
    return this.service.removerPlano(id);
  }
}

@ApiTags("admin/pneus")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/pneus")
export class PneusController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @RequerPermissao("pneus.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListPneus)) q: z.infer<typeof ListPneus>) {
    return this.service.listPneus(q);
  }

  @RequerPermissao("pneus.criar")
  @Post()
  create(@Body(new ZodValidationPipe(SalvarPneuInput)) body: SalvarPneuInput) {
    return this.service.salvarPneu(body);
  }

  @RequerPermissao("pneus.editar")
  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(SalvarPneuInput)) body: SalvarPneuInput) {
    return this.service.salvarPneu(body, id);
  }

  @RequerPermissao("pneus.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerPneu(id);
  }
}

@ApiTags("admin/multas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/multas")
export class MultasController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @RequerPermissao("multas.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListMultas)) q: z.infer<typeof ListMultas>) {
    return this.service.listMultas(q);
  }

  @RequerPermissao("multas.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarMultaInput)) body: CriarMultaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarMulta(body, user.id);
  }

  @RequerPermissao("multas.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMultaInput)) body: AtualizarMultaInput,
  ) {
    return this.service.atualizarMulta(id, body);
  }
}

@ApiTags("admin/documentos-veiculo")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/documentos-veiculo")
export class DocumentosVeiculoController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @RequerPermissao("documentos-veiculo.ver")
  @Get()
  list(@Query("veiculoId") veiculoId?: string) {
    return this.service.listDocumentos(veiculoId);
  }

  @RequerPermissao("documentos-veiculo.editar")
  @Post()
  salvar(
    @Body(new ZodValidationPipe(SalvarDocumentoVeiculoInput)) body: SalvarDocumentoVeiculoInput,
  ) {
    return this.service.salvarDocumento(body);
  }

  @RequerPermissao("documentos-veiculo.editar")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerDocumento(id);
  }
}

/**
 * O motorista avisando problema no caminhão, pelo app.
 *
 * `@RequerCapacidade` não checa aprovação (e o guard de acesso só roda com
 * `@AcessoMotorista`), então o cadastro aprovado é conferido aqui na mão — ver
 * CLAUDE.md, "Guards do motorista".
 */
@ApiTags("motorista/problemas-veiculo")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/problemas-veiculo")
@RequerCapacidade("app.problema.avisar")
export class ProblemasVeiculoMotoristaController {
  constructor(
    private readonly service: FrotaManutencaoService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor("fotos", MAX_FOTOS_PROBLEMA, { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async avisar(
    @CurrentUser() user: AuthMotorista,
    @Body() corpo: Record<string, unknown>,
    @UploadedFiles() fotos: Express.Multer.File[] | undefined,
  ) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: user.id },
      select: { status: true },
    });
    if (m?.status !== "APROVADO") {
      throw new ForbiddenException("Seu cadastro ainda está em análise.");
    }
    // Multipart chega como texto: o Zod converte a data e valida o resto.
    const r = AvisarProblemaVeiculoInput.safeParse({
      ...corpo,
      veiculoId: corpo.veiculoId ? corpo.veiculoId : null,
    });
    if (!r.success) throw new BadRequestException({ issues: r.error.issues });
    return this.service.avisarProblema(
      user.id,
      r.data,
      (fotos ?? []).map((f) => ({
        buffer: f.buffer,
        mimetype: f.mimetype,
        size: f.size,
        originalname: f.originalname,
      })),
    );
  }
}
