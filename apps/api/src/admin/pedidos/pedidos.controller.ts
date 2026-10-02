import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarPedidoInput,
  AtualizarViagemPlanejadaInput,
  CriarPedidoInput,
  CriarViagemPlanejadaInput,
  PublicarProgramacaoInput,
  CopiarProgramacaoInput,
  ExtrairPedidoTextoInput,
  LIMITE_DOCUMENTO_PEDIDO,
  STATUS_PEDIDO,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { PedidoDocumentoService } from "./pedido-documento.service";
import { PedidosService } from "./pedidos.service";
import { ProgramacaoService } from "./programacao.service";

const ListPedidosQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  status: z.enum(STATUS_PEDIDO).optional(),
  abertos: z.enum(["true", "false"]).optional(),
});
type ListPedidosQuery = z.infer<typeof ListPedidosQuery>;

const DiaQuery = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type DiaQuery = z.infer<typeof DiaQuery>;

/** O que o cliente pediu. */
@ApiTags("admin/pedidos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/pedidos")
export class PedidosController {
  constructor(
    private readonly service: PedidosService,
    private readonly documento: PedidoDocumentoService,
  ) {}

  /**
   * Lê um pedido de um documento (PDF, foto ou texto de e-mail colado) e
   * devolve a SUGESTÃO pro formulário de novo pedido. Não grava nada: quem
   * confere e salva é a pessoa, pelo `POST admin/pedidos` de sempre — por isso
   * a chave é a de criar pedido, e não uma nova.
   *
   * Multipart: `arquivo` (opcional) e/ou `texto` (opcional); um dos dois.
   * Declarado ANTES de `:id` por clareza — o verbo é outro, mas a leitura da
   * rota fica óbvia.
   */
  @RequerPermissao("pedidos.criar")
  @HttpCode(200)
  @Post("extrair")
  @UseInterceptors(
    // O teto do Multer corta o upload no meio (413) em vez de deixar 50 MB
    // inteiros chegarem à memória pra só então recusar.
    FileInterceptor("arquivo", { limits: { fileSize: LIMITE_DOCUMENTO_PEDIDO.bytes, files: 1 } }),
  )
  extrair(
    @Body(new ZodValidationPipe(ExtrairPedidoTextoInput)) body: ExtrairPedidoTextoInput,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    return this.documento.extrair({ arquivo, texto: body.texto });
  }

  @RequerPermissao("pedidos.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListPedidosQuery)) query: ListPedidosQuery) {
    return this.service.list(query);
  }

  @RequerPermissao("pedidos.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("pedidos.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarPedidoInput)) body: CriarPedidoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("pedidos.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarPedidoInput)) body: AtualizarPedidoInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("pedidos.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}

/**
 * O quadro do dia: quem leva o quê.
 *
 * Chave própria (`programacao`) e não `pedidos`: quem monta a escala nem sempre
 * é quem negocia o pedido com o cliente.
 */
@ApiTags("admin/programacao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/programacao")
export class ProgramacaoController {
  constructor(private readonly service: ProgramacaoService) {}

  @EscopoPor("motorista")
  @RequerPermissao("programacao.ver")
  @Get()
  doDia(
    @Query(new ZodValidationPipe(DiaQuery)) query: DiaQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.doDia(query.data, user.escopo);
  }

  @RequerPermissao("programacao.editar")
  @Post()
  criar(
    @Body(new ZodValidationPipe(CriarViagemPlanejadaInput)) body: CriarViagemPlanejadaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criar(body, user.id);
  }

  @RequerPermissao("programacao.editar")
  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarViagemPlanejadaInput))
    body: AtualizarViagemPlanejadaInput,
  ) {
    return this.service.atualizar(id, body);
  }

  @RequerPermissao("programacao.editar")
  @Delete(":id")
  remover(@Param("id") id: string) {
    return this.service.remover(id);
  }

  /** Repete o quadro de outro dia. `simular: true` (padrão) só mostra o que entraria. */
  @EscopoPor("motorista")
  @RequerPermissao("programacao.editar")
  @Post("copiar")
  copiar(
    @Body(new ZodValidationPipe(CopiarProgramacaoInput)) body: CopiarProgramacaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.copiar(body, user.id, user.escopo);
  }

  // Publicar é chave separada: montar o quadro é rascunho, publicar avisa o
  // motorista e vira combinado.
  @RequerPermissao("programacao.publicar")
  @Post("publicar")
  publicar(
    @Body(new ZodValidationPipe(PublicarProgramacaoInput)) body: PublicarProgramacaoInput,
  ) {
    return this.service.publicar(body);
  }
}
