import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { RegistrarChecklistInput, SalvarModeloChecklistInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser, AuthMotorista } from "../../auth/types";
import { RequerCapacidade } from "../../common/acesso-app/capacidade.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { ChecklistService } from "./checklist.service";

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const HistoricoQuery = z
  .object({ de: YMD, ate: YMD, veiculoId: z.string().uuid().optional() })
  .refine((q) => q.de <= q.ate, { message: "A data final não pode ser antes da inicial.", path: ["ate"] })
  .refine((q) => Date.parse(q.ate) - Date.parse(q.de) <= 93 * 86_400_000, {
    message: "Período máximo de 3 meses.",
    path: ["de"],
  });

/** Checklist do caminhão: o modelo (o que se confere) e o que os motoristas fizeram. */
@ApiTags("admin/checklists")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/checklists")
export class ChecklistController {
  constructor(private readonly service: ChecklistService) {}

  @RequerPermissao("checklists.ver")
  @Get("modelos")
  modelos() {
    return this.service.listarModelos();
  }

  @RequerPermissao("checklists.editar")
  @Post("modelos/sugerido")
  criarSugerido() {
    return this.service.criarSugerido();
  }

  @RequerPermissao("checklists.editar")
  @Post("modelos")
  criar(@Body(new ZodValidationPipe(SalvarModeloChecklistInput)) body: SalvarModeloChecklistInput) {
    return this.service.salvarModelo(null, body);
  }

  @RequerPermissao("checklists.editar")
  @Put("modelos/:id")
  salvar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SalvarModeloChecklistInput)) body: SalvarModeloChecklistInput,
  ) {
    return this.service.salvarModelo(id, body);
  }

  @EscopoPor("veiculo")
  @RequerPermissao("checklists.ver")
  @Get()
  historico(
    @Query(new ZodValidationPipe(HistoricoQuery)) q: z.infer<typeof HistoricoQuery>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.historico(q, user.escopo);
  }

  @RequerPermissao("checklists.ver")
  @Get("respostas/:id/foto")
  async foto(@Param("id") id: string, @Res() res: Response) {
    const buf = await this.service.foto(id);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  }
}

/**
 * O motorista fazendo o checklist pelo app. `@RequerCapacidade` não checa
 * aprovação, então o cadastro aprovado é conferido aqui na mão (CLAUDE.md,
 * "Guards do motorista").
 */
@ApiTags("motorista/checklists")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/checklists")
@RequerCapacidade("app.checklist.fazer")
export class ChecklistMotoristaController {
  constructor(
    private readonly service: ChecklistService,
    private readonly prisma: PrismaService,
  ) {}

  private async exigirAprovado(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({ where: { id: motoristaId }, select: { status: true } });
    if (m?.status !== "APROVADO") throw new ForbiddenException("Seu cadastro ainda está em análise.");
  }

  /** O modelo que a empresa montou (null = não montou), o que ele fez hoje e nos últimos 7 dias. */
  @Get()
  async meu(@CurrentUser() user: AuthMotorista, @Query("hoje") hoje?: string) {
    await this.exigirAprovado(user.id);
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(hoje ?? "") ? hoje! : new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const [modelo, feitosHoje, recentes] = await Promise.all([
      this.service.modeloAtivo(),
      this.service.feitosHoje(user.id, dia),
      this.service.recentes(user.id, dia),
    ]);
    // `feitosHoje` fica pela versão do app que ainda não lê `recentes`.
    return { modelo, feitosHoje, recentes };
  }

  /** Multipart: `dados` (JSON do RegistrarChecklistInput) + `foto_<índice da resposta>`. */
  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 10 * 1024 * 1024, files: 30 } }))
  async registrar(
    @CurrentUser() user: AuthMotorista,
    @Body() corpo: Record<string, unknown>,
    @UploadedFiles() fotos: Express.Multer.File[] | undefined,
  ) {
    await this.exigirAprovado(user.id);
    let dados: unknown;
    try {
      dados = typeof corpo.dados === "string" ? JSON.parse(corpo.dados) : corpo.dados;
    } catch {
      throw new BadRequestException({ issues: [{ path: ["dados"], message: "Checklist ilegível." }] });
    }
    const r = RegistrarChecklistInput.safeParse(dados);
    if (!r.success) throw new BadRequestException({ issues: r.error.issues });
    return this.service.registrar(
      user.id,
      r.data,
      (fotos ?? []).map((f) => ({
        buffer: f.buffer,
        mimetype: f.mimetype,
        size: f.size,
        originalname: f.originalname,
        fieldname: f.fieldname,
      })),
    );
  }
}
