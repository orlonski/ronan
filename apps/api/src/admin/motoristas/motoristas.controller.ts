import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AprovarMotoristaInput,
  AtualizarMotoristaInput,
  CriarMotoristaInput,
  EnviarPushInput,
  cpfDigits,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { MotoristasService } from "./motoristas.service";
import { ResumoMotoristaService } from "../../motorista/resumo-motorista.service";

const ListMotoristasQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
  status: z.enum(["PENDENTE_APROVACAO", "APROVADO", "REJEITADO"]).optional(),
  // Filtra pela versão do app reportada. "sem-versao" = nunca abriu o app.
  appVersion: z.string().min(1).optional(),
  transportadoraId: z.string().uuid().optional(),
  semTransportadora: z.enum(["true"]).optional(),
});
type ListMotoristasQuery = z.infer<typeof ListMotoristasQuery>;

const AcessosInput = z.object({
  podeLancarViagem: z.boolean().optional(),
  podeIniciarViagem: z.boolean().optional(),
  podeViagemLifecycle: z.boolean().optional(),
  podeLancarPedagio: z.boolean().optional(),
  podeLancarAbastecimento: z.boolean().optional(),
  podeUsarOcrTicket: z.boolean().optional(),
  podeVerStories: z.boolean().optional(),
  podeVerTodosLocais: z.boolean().optional(),
  podeReferenciaKm: z.boolean().optional(),
  podeTelemetria: z.boolean().optional(),
  podeChat: z.boolean().optional(),
  receberResumoDiario: z.boolean().optional(),
});
type AcessosInput = z.infer<typeof AcessosInput>;

const EnviarWhatsappInput = z.object({
  mensagem: z.string().trim().min(1, "Escreva a mensagem.").max(4096),
});
type EnviarWhatsappInput = z.infer<typeof EnviarWhatsappInput>;

@ApiTags("admin/motoristas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/motoristas")
export class MotoristasController {
  constructor(
    private readonly service: MotoristasService,
    private readonly resumo: ResumoMotoristaService,
  ) {}

  @EscopoPor("motorista")
  @RequerPermissao("motoristas.ver")
  @Get()
  list(
    @Query(new ZodValidationPipe(ListMotoristasQuery)) query: ListMotoristasQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.list(query, user.escopo);
  }

  // Antes do :id pra não ser capturado como id="versoes".
  @EscopoPor("motorista")
  @RequerPermissao("motoristas.ver")
  @Get("versoes/resumo")
  resumoVersoes(@CurrentUser() user: AuthAdminUser) {
    return this.service.resumoVersoes(user.escopo);
  }

  // Versões distintas reportadas pelos motoristas (popula o filtro do painel).
  @EscopoPor("motorista")
  @RequerPermissao("motoristas.ver")
  @Get("versoes/lista")
  versoesDisponiveis(@CurrentUser() user: AuthAdminUser) {
    return this.service.versoesDisponiveis(user.escopo);
  }

  /**
   * Esse CPF já tem cadastro em outra empresa? Serve pro form esconder o campo
   * de senha (ele já tem uma). Devolve só o booleano — nunca qual empresa.
   * Antes do :id pra não ser capturado como id.
   */
  @RequerPermissao("motoristas.criar")
  @Get("checar-cpf")
  async checarCpf(@Query("cpf") cpf?: string) {
    const digitos = cpfDigits(cpf ?? "");
    if (digitos.length !== 11) return { existeEmOutraEmpresa: false };
    return { existeEmOutraEmpresa: await this.service.cpfEmOutraEmpresa(digitos) };
  }

  @EscopoPor("motorista")
  @RequerPermissao("motoristas.ver")
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.findOne(id, user.escopo);
  }

  @RequerPermissao("motoristas.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarMotoristaInput)) body: CriarMotoristaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("motoristas.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMotoristaInput)) body: AtualizarMotoristaInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("motoristas.editar")
  @Patch(":id/acessos")
  atualizarAcessos(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AcessosInput)) body: AcessosInput,
  ) {
    return this.service.atualizarAcessos(id, body);
  }

  @RequerPermissao("motoristas.aprovar")
  @Patch(":id/aprovacao")
  aprovar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AprovarMotoristaInput)) body: AprovarMotoristaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.definirAprovacao(id, body.status, user.id);
  }

  @RequerPermissao("motoristas.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @RequerPermissao("motoristas.editar")
  @Post(":id/push")
  enviarPush(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarPushInput)) body: EnviarPushInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.enviarPush(id, body, user.id);
  }

  /** Envia o resumo diário do motorista AGORA no WhatsApp (pra testar). */
  @RequerPermissao("motoristas.editar")
  @Post(":id/enviar-resumo")
  enviarResumo(@Param("id") id: string) {
    return this.resumo.enviarAgora(id);
  }

  /** Manda uma mensagem de WhatsApp personalizada pro motorista. */
  @RequerPermissao("motoristas.editar")
  @Post(":id/whatsapp")
  enviarWhatsapp(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarWhatsappInput)) body: EnviarWhatsappInput,
  ) {
    return this.service.enviarWhatsapp(id, body.mensagem);
  }
}
