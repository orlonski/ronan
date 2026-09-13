import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { CteService } from "./cte.service";

const ConfigInput = z.object({
  cteEmissor: z.enum(["SIMULADOR", "GATEWAY"]).optional(),
  cteAmbiente: z.union([z.literal(1), z.literal(2)]).optional(),
  cteSerie: z.number().int().min(0).max(999).optional(),
  cteNaturezaCfop: z.string().trim().regex(/^\d{3}$/, "Use os 3 últimos dígitos, ex.: 353").nullish(),
  cteNaturezaOperacao: z.string().trim().max(60).nullish(),
  cteIcmsTipo: z.enum(["SN", "00", "20", "45", "60", "90"]).nullish(),
  cteIcmsAliquota: z.coerce.number().min(0).max(100).nullish(),
  cteIcmsReducao: z.coerce.number().min(0).max(100).nullish(),
  cteIcmsCst: z.enum(["40", "41", "51"]).nullish(),
  cteGatewayUrl: z.string().trim().url().nullish().or(z.literal("")),
  /** Vazio = não mexi. O servidor nunca devolve o token, então em branco não
   *  pode significar "apague" — significaria perder a credencial a cada save. */
  cteGatewayToken: z.string().trim().max(500).nullish(),
});

const CancelarInput = z.object({
  // A SEFAZ exige 15 caracteres. Cobrar aqui evita gastar o evento de
  // cancelamento — que é contado e aparece na consulta do documento.
  justificativa: z.string().trim().min(15, "A justificativa precisa ter ao menos 15 letras").max(255),
});

/**
 * Emissão de CT-e.
 *
 * Recurso próprio na matriz, e não `viagens.editar`: emitir documento fiscal é
 * ato com consequência jurídica — quem lança uma viagem não deveria, por isso,
 * poder emitir em nome da empresa.
 */
@ApiTags("admin/cte")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/cte")
export class CteController {
  constructor(private readonly service: CteService) {}

  @RequerPermissao("cte.ver")
  @Get()
  listar(@Query("status") status?: string, @Query("viagemId") viagemId?: string) {
    return this.service.listar({ status, viagemId });
  }

  /**
   * O que sairia, e o que falta pra sair. NÃO consome número nem grava nada:
   * buraco na numeração é coisa que a SEFAZ pergunta, e gastar um número num
   * documento que a validação local já sabia que ia falhar cria um.
   */
  @RequerPermissao("cte.ver")
  @Get("previa/:viagemId")
  previa(@Param("viagemId") viagemId: string) {
    return this.service.previa(viagemId);
  }

  /**
   * A configuração de emissão. Declarada ANTES de `:id` — senão a rota
   * `/admin/cte/config` cairia no detalhe de um documento chamado "config".
   */
  @RequerPermissao("cte.ver")
  @Get("config")
  config() {
    return this.service.configuracao();
  }

  @RequerPermissao("cte.emitir")
  @Patch("config")
  salvarConfig(
    @Body(new ZodValidationPipe(ConfigInput)) body: z.infer<typeof ConfigInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarConfiguracao(user.contaId, body as never);
  }

  @RequerPermissao("cte.ver")
  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @RequerPermissao("cte.emitir")
  @HttpCode(200)
  @Post("emitir/:viagemId")
  emitir(@Param("viagemId") viagemId: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.emitir(viagemId, user.id);
  }

  @RequerPermissao("cte.cancelar")
  @HttpCode(200)
  @Post(":id/cancelar")
  cancelar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CancelarInput)) body: z.infer<typeof CancelarInput>,
  ) {
    return this.service.cancelar(id, body.justificativa);
  }
}
