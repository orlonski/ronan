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
  Put,
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
import {
  ConfigMensalInput,
  LancarMedicaoInput,
  CriarAlocacaoInput,
  EditarAlocacaoInput,
  EncerrarAlocacaoInput,
  LancarPresencaPainelInput,
  RegistrarPresencaInput,
  RemoverPresencaInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser, AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { MensalService } from "./mensal.service";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";

const GradeQuery = z.object({
  clienteId: z.string().uuid().optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type GradeQuery = z.infer<typeof GradeQuery>;

/**
 * O mensal do lado do escritório: quem está em qual obra e quem marcou presença.
 *
 * Fora de `admin/assinaturas` de propósito — aquilo é a mensalidade que a
 * Movatruck cobra da transportadora, isto é o contrato da transportadora com a
 * obra. Mesmo nome, dois balcões diferentes.
 */
@ApiTags("admin/mensal")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/mensal")
export class MensalAdminController {
  constructor(private readonly service: MensalService) {}

  @RequerPermissao("alocacoes.ver")
  @Get("alocacoes")
  listar(@Query("clienteId") clienteId?: string, @Query("ativas") ativas?: string) {
    return this.service.listarAlocacoes({
      clienteId,
      ativas: ativas === undefined ? undefined : ativas === "true",
    });
  }

  @RequerPermissao("alocacoes.criar")
  @Post("alocacoes")
  criar(
    @Body(new ZodValidationPipe(CriarAlocacaoInput)) body: CriarAlocacaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarAlocacao(body, user.id);
  }

  @RequerPermissao("alocacoes.editar")
  @Patch("alocacoes/:id")
  editar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EditarAlocacaoInput)) body: EditarAlocacaoInput,
  ) {
    return this.service.editarAlocacao(id, body);
  }

  /** Para de contar diária. Não apaga o que já foi registrado. */
  @RequerPermissao("alocacoes.encerrar")
  @Post("alocacoes/:id/encerrar")
  encerrar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EncerrarAlocacaoInput)) body: EncerrarAlocacaoInput,
  ) {
    return this.service.encerrarAlocacao(id, body.motivo);
  }

  /**
   * O espelho da competência. É o documento que vai pra conversa do dia 20.
   *
   * `competencia` é "AAAA-MM" — o mês em que a medição chega. O período que
   * ela cobre sai do dia de corte DO CONTRATANTE, não daqui.
   */
  @RequerPermissao("espelhos.ver")
  @Get("espelho")
  espelho(
    @Query("competencia") competencia: string,
    @Query("clienteId") clienteId?: string,
    @Query("empresaId") empresaId?: string,
  ) {
    return this.service.espelho(competencia, { clienteId, empresaId });
  }

  /** O nosso espelho contra a medição do contratante. */
  @RequerPermissao("espelhos.ver")
  @Get("medicao")
  conferir(@Query("empresaId") empresaId: string, @Query("competencia") competencia: string) {
    return this.service.conferirMedicao(empresaId, competencia);
  }

  /**
   * O modelo em branco pra mandar pro contratante.
   *
   * Vem antes do importador na ordem de uso e na de importância: é ele que
   * torna o formato previsível. Sem modelo, cada contratante manda um arquivo
   * diferente e o parser vira adivinhação.
   */
  @RequerPermissao("espelhos.ver")
  @Get("medicao/modelo")
  async modelo(
    @Query("empresaId") empresaId: string,
    @Query("competencia") competencia: string,
    @Res() res: Response,
  ) {
    const { buffer, nomeArquivo } = await this.service.modeloDeMedicao(empresaId, competencia);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.send(buffer);
  }

  /**
   * Lê a planilha que voltou. NÃO grava — devolve o que leu pra conferência.
   *
   * O que ele não reconheceu sai na resposta, nunca no lixo: importador que
   * descarta linha em silêncio fecha o número na tela com gente faltando na
   * conta, e ninguém procura o que não sabe que existe.
   */
  @RequerPermissao("espelhos.configurar")
  @Post("medicao/importar")
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async importar(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body("empresaId") empresaId: string,
    @Body("competencia") competencia: string,
  ) {
    if (!arquivo) throw new BadRequestException("Anexe a planilha.");
    if (!empresaId || !competencia) {
      throw new BadRequestException("Diga o contratante e a competência.");
    }
    return this.service.importarMedicao(empresaId, competencia, arquivo.buffer, arquivo.originalname);
  }

  /** Lança o que a medição diz. Guardado como veio, sem correção nossa. */
  @RequerPermissao("espelhos.configurar")
  @Put("medicao")
  lancarMedicao(
    @Body(new ZodValidationPipe(LancarMedicaoInput)) body: LancarMedicaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.lancarMedicao(body, user.id);
  }

  /** O combinado com um contratante: dia de corte e calendário da obra. */
  @RequerPermissao("espelhos.ver")
  @Get("config/:empresaId")
  config(@Param("empresaId") empresaId: string) {
    return this.service.configDoContratante(empresaId);
  }

  @RequerPermissao("espelhos.configurar")
  @Put("config/:empresaId")
  salvarConfig(
    @Param("empresaId") empresaId: string,
    @Body(new ZodValidationPipe(ConfigMensalInput)) body: ConfigMensalInput,
  ) {
    return this.service.salvarConfigDoContratante(empresaId, body);
  }

  /** A grade do período: quem esteve em que dia, e quem marcou. */
  @RequerPermissao("presenca.ver")
  @Get("presenca")
  grade(@Query(new ZodValidationPipe(GradeQuery)) q: GradeQuery) {
    return this.service.grade(q.clienteId, q.de, q.ate);
  }

  @RequerPermissao("presenca.lancar")
  @Post("presenca")
  lancar(
    @Body(new ZodValidationPipe(LancarPresencaPainelInput)) body: LancarPresencaPainelInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.lancarPelaPainel(body, user.id);
  }

  @RequerPermissao("presenca.corrigir")
  @Delete("presenca/:id")
  remover(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RemoverPresencaInput)) body: RemoverPresencaInput,
  ) {
    return this.service.removerPresenca(id, body.motivo);
  }
}

/**
 * O que o motorista faz: chegou na obra.
 *
 * SEM `@AcessoMotorista(...)` de propósito, pelo mesmo motivo do acerto: isto
 * não é feature em rollout, é como ele registra o próprio trabalho. Gatear por
 * flag deixaria alguém alocado numa obra sem conseguir marcar o dia que vai
 * pagar o mês dele. Como o guard de acesso não roda sem decorator, a checagem
 * de cadastro aprovado é feita aqui na mão (ver CLAUDE.md).
 *
 * Quem decide se ele vê o botão é a ALOCAÇÃO, não uma flag: sem alocação
 * ativa, `hoje` volta nulo e o app mostra a home de sempre.
 */
@ApiTags("motorista/obra")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/obra")
@RequerCapacidade("app.obra.presenca")
export class ObraMotoristaController {
  constructor(
    private readonly service: MensalService,
    private readonly prisma: PrismaService,
  ) {}

  private async exigirAprovado(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { status: true },
    });
    if (m?.status !== "APROVADO") {
      throw new ForbiddenException("Seu cadastro ainda está em análise.");
    }
  }

  /** A obra de hoje, se houver, e os dias que ficaram em branco. */
  @Get("hoje")
  async hoje(@CurrentUser() user: AuthMotorista) {
    await this.exigirAprovado(user.id);
    return this.service.obraDeHoje(user.id);
  }

  /** Os dias que ele já marcou no mês. Sem valor em dinheiro, de propósito. */
  @Get("meus-dias")
  async meusDias(@CurrentUser() user: AuthMotorista, @Query("mes") mes: string) {
    await this.exigirAprovado(user.id);
    return this.service.meusDias(user.id, mes);
  }

  /**
   * Desfazer o próprio toque. É o que torna honesto não perguntar "tem
   * certeza?" antes de marcar.
   */
  @Delete("cheguei/:data")
  async desmarcar(@CurrentUser() user: AuthMotorista, @Param("data") data: string) {
    await this.exigirAprovado(user.id);
    return this.service.desmarcarPresenca(user.id, data);
  }

  /** O toque. Idempotente: tocar de novo devolve o mesmo dia, nunca erro. */
  @Post("cheguei")
  async cheguei(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(RegistrarPresencaInput)) body: RegistrarPresencaInput,
  ) {
    await this.exigirAprovado(user.id);
    return this.service.registrarPresenca(user.id, body);
  }
}
