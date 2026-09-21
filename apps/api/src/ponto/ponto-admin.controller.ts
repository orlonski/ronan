import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PontoAdminService } from "./ponto-admin.service";

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a data no formato AAAA-MM-DD.");
const COMPETENCIA = z.string().regex(/^\d{4}-\d{2}$/, "Use o mês no formato AAAA-MM.");
const HORA = z.string().regex(/^\d{2}:\d{2}$/);

const ContratarInput = z.object({
  nome: z.string().trim().min(3, "Escreva o nome completo."),
  cpf: z.string().trim().min(11, "Informe o CPF."),
  pis: z.string().trim().max(20).optional(),
  matricula: z.string().trim().max(30).optional(),
  cargo: z.string().trim().max(60).optional(),
  uf: z.string().length(2).optional(),
  municipioIbge: z.string().length(7).optional(),
  admitidoEm: DIA,
  modeloJornadaId: z.string().uuid().optional(),
});

const EditarFuncionarioInput = z.object({
  nome: z.string().trim().min(3).optional(),
  pis: z.string().trim().max(20).nullish(),
  matricula: z.string().trim().max(30).nullish(),
  cargo: z.string().trim().max(60).nullish(),
  uf: z.string().length(2).nullish(),
  municipioIbge: z.string().length(7).nullish(),
});

const DesligarInput = z.object({
  desligadoEm: DIA,
  motivo: z.string().trim().min(3, "Escreva o motivo do desligamento."),
});

const ModeloJornadaInput = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(2, "Dê um nome à jornada."),
  tipo: z.enum(["SEMANAL", "CICLO"]).default("SEMANAL"),
  cicloDias: z.number().int().min(2).max(30).optional(),
  ancoraCiclo: DIA.optional(),
  // O teto legal também está no service: aqui é pra tela avisar antes de
  // mandar, lá é porque regra de dinheiro não confia em cliente.
  toleranciaPorMarcacaoMin: z.number().int().min(0).max(5).default(5),
  toleranciaDiariaMin: z.number().int().min(0).max(10).default(10),
  intervaloMinimoMin: z.number().int().min(0).max(240).default(60),
  preAssinalacaoIntervalo: z.boolean().default(false),
  preAssinalacaoMinutos: z.number().int().min(0).max(240).optional(),
  maxDirecaoContinuaMin: z.number().int().min(0).max(1440).optional(),
  interjornadaMin: z.number().int().min(0).max(2880).optional(),
  descansoSemanalMin: z.number().int().min(0).max(10080).optional(),
  dias: z
    .array(
      z.object({
        posicao: z.number().int().min(0).max(30),
        trabalha: z.boolean(),
        entrada: HORA.optional(),
        saida: HORA.optional(),
        intervaloMin: z.number().int().min(0).max(480).default(60),
      }),
    )
    .min(1),
});

const ConfigInput = z.object({
  razaoSocial: z.string().trim().min(2).optional(),
  cnpj: z.string().trim().min(14).optional(),
  fundamento: z.literal("ACORDO_COLETIVO").optional(),
  fundamentoReferencia: z.string().trim().max(200).optional(),
  diaFechamento: z.number().int().min(1).max(31).optional(),
  identificacaoRep: z.string().trim().max(120).optional(),
  // Teto de 180 dias: a tela promete guarda limitada, e um campo sem limite
  // deixaria o cliente digitar 3650 e a promessa virar mentira.
  diasRetencaoLocalizacao: z.number().int().min(0).max(180).optional(),
  avisoLgpdTexto: z.string().trim().max(2000).optional(),
  mesesAcessoAposDesligamento: z.number().int().min(1).max(60).optional(),
});

const LancarCorrecaoInput = z.object({
  funcionarioId: z.string().uuid(),
  dia: DIA,
  tipo: z.enum(["INCLUSAO", "DESCONSIDERACAO", "ANOTACAO"]),
  marcacaoId: z.string().uuid().optional(),
  instantePretendido: z.string().datetime({ offset: true }).optional(),
  motivoCodigo: z.string().min(1),
  motivo: z.string().trim().min(3, "Escreva o motivo da correção."),
});

const ConfirmarImportacaoInput = z.object({
  linhas: z
    .array(
      z.object({
        nome: z.string().trim().min(3),
        cpf: z.string().trim().min(11),
        cargo: z.string().trim().max(60).optional(),
        matricula: z.string().trim().max(30).optional(),
        admitidoEm: DIA.optional(),
        jornada: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(500),
});

const DecidirInput = z.object({ motivo: z.string().trim().max(500).optional() });
const ReabrirInput = z.object({ motivo: z.string().trim().min(3, "Escreva por que está reabrindo.") });

/**
 * O PAINEL do módulo de ponto.
 *
 * ⚠️ TODO handler tem `@RequerPermissao` — o boot-check derruba a subida sem
 * isso, e a dívida conhecida (`endpoints-sem-permissao.ts`) só encolhe.
 */
@ApiTags("admin/ponto")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/ponto")
export class PontoAdminController {
  constructor(private readonly service: PontoAdminService) {}

  @RequerPermissao("ponto.ver")
  @Get("dia")
  dia(@Query("data", new ZodValidationPipe(DIA)) data: string) {
    return this.service.dia(data);
  }

  @RequerPermissao("ponto.ver-localizacao")
  @Get("marcacoes/:id/localizacao")
  localizacao(@Param("id") id: string, @CurrentUser() user: { id: string }) {
    return this.service.localizacaoDaMarcacao(id, user.id);
  }

  @RequerPermissao("espelho-ponto.ver")
  @Get("competencia")
  competencia(@Query("competencia", new ZodValidationPipe(COMPETENCIA)) c: string) {
    return this.service.competencia(c);
  }

  @RequerPermissao("espelho-ponto.ver")
  @Get("espelho/:funcionarioId")
  espelho(
    @Param("funcionarioId") funcionarioId: string,
    @Query("competencia", new ZodValidationPipe(COMPETENCIA)) c: string,
  ) {
    return this.service.espelho(funcionarioId, c);
  }

  @RequerPermissao("funcionarios.ver")
  @Get("funcionarios")
  funcionarios(@Query("inativos") inativos?: string) {
    return this.service.listarFuncionarios(inativos === "true");
  }

  @RequerPermissao("funcionarios.criar")
  @Post("funcionarios")
  contratar(
    @Body(new ZodValidationPipe(ContratarInput)) body: z.infer<typeof ContratarInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.contratar({ ...body, usuarioId: user.id });
  }

  @RequerPermissao("funcionarios.editar")
  @Patch("funcionarios/:id")
  editar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EditarFuncionarioInput)) body: z.infer<typeof EditarFuncionarioInput>,
  ) {
    return this.service.editarFuncionario(id, body);
  }

  @RequerPermissao("funcionarios.desligar")
  @Post("funcionarios/:id/desligar")
  desligar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DesligarInput)) body: z.infer<typeof DesligarInput>,
  ) {
    return this.service.desligar(id, body);
  }

  @RequerPermissao("funcionarios.importar")
  @Get("funcionarios/modelo")
  async modeloFuncionarios(@Res() res: Response) {
    const buffer = await this.service.modeloFuncionarios();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", 'attachment; filename="modelo-funcionarios.xlsx"');
    res.send(buffer);
  }

  /** Lê e devolve o que dá e o que não dá. NÃO grava — a confirmação é outra. */
  @RequerPermissao("funcionarios.importar")
  @Post("funcionarios/importacao/previa")
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: 10 * 1024 * 1024 } }))
  previaFuncionarios(@UploadedFile() arquivo: Express.Multer.File | undefined) {
    if (!arquivo) throw new BadRequestException("Anexe a planilha.");
    return this.service.previaFuncionarios(arquivo.buffer, arquivo.originalname);
  }

  @RequerPermissao("funcionarios.importar")
  @Post("funcionarios/importacao/confirmar")
  confirmarFuncionarios(
    @Body(new ZodValidationPipe(ConfirmarImportacaoInput)) body: z.infer<typeof ConfirmarImportacaoInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.confirmarFuncionarios(body.linhas, user.id);
  }

  @RequerPermissao("jornadas.ver")
  @Get("jornadas")
  jornadas() {
    return this.service.listarModelos();
  }

  @RequerPermissao("jornadas.editar")
  @Put("jornadas")
  salvarJornada(@Body(new ZodValidationPipe(ModeloJornadaInput)) body: z.infer<typeof ModeloJornadaInput>) {
    return this.service.salvarModelo(body);
  }

  @RequerPermissao("jornadas.editar")
  @Put("funcionarios/:id/jornada")
  definirJornada(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(z.object({ modeloId: z.string().uuid(), vigenteDe: DIA })))
    body: { modeloId: string; vigenteDe: string },
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.definirJornada(id, body.modeloId, body.vigenteDe, user.id);
  }

  @RequerPermissao("config-ponto.ver")
  @Get("config")
  config() {
    return this.service.config();
  }

  @RequerPermissao("config-ponto.editar")
  @Put("config")
  salvarConfig(
    @Body(new ZodValidationPipe(ConfigInput)) body: z.infer<typeof ConfigInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarConfig({ ...body, usuarioId: user.id });
  }

  @RequerPermissao("correcoes-ponto.ver")
  @Get("correcoes")
  correcoes(@Query("status") status?: "PENDENTE" | "APROVADA" | "RECUSADA") {
    return this.service.listarCorrecoes(status);
  }

  @RequerPermissao("correcoes-ponto.lancar")
  @Post("correcoes")
  lancarCorrecao(
    @Body(new ZodValidationPipe(LancarCorrecaoInput)) body: z.infer<typeof LancarCorrecaoInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.lancarCorrecao({ ...body, usuarioId: user.id });
  }

  @RequerPermissao("correcoes-ponto.decidir")
  @Post("correcoes/:id/aprovar")
  aprovar(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.decidirCorrecao(id, "APROVADA", user.id);
  }

  @RequerPermissao("correcoes-ponto.decidir")
  @Post("correcoes/:id/recusar")
  recusar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DecidirInput)) body: z.infer<typeof DecidirInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.decidirCorrecao(id, "RECUSADA", user.id, body.motivo);
  }

  @RequerPermissao("correcoes-ponto.decidir")
  @Post("correcoes/:id/ciencia-presencial")
  cienciaPresencial(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DecidirInput)) body: z.infer<typeof DecidirInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.cienciaPresencial(id, user.id, body.motivo);
  }

  @RequerPermissao("fechamento-ponto.ver")
  @Get("fechamentos")
  fechamentos() {
    return this.service.listarFechamentos();
  }

  @RequerPermissao("fechamento-ponto.fechar")
  @Post("fechamentos/fechar")
  fechar(
    @Body(new ZodValidationPipe(z.object({ competencia: COMPETENCIA }))) body: { competencia: string },
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.fechar(body.competencia, user.id);
  }

  @RequerPermissao("fechamento-ponto.reabrir")
  @Post("fechamentos/:id/reabrir")
  reabrir(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ReabrirInput)) body: z.infer<typeof ReabrirInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.reabrir(id, user.id, body.motivo);
  }
}
