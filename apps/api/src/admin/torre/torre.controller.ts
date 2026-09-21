import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TorreService } from "./torre.service";

/**
 * A régua da torre.
 *
 * Os limites eram sete constantes chumbadas em `common/torre.ts` — e pedreira e
 * obra não têm o mesmo relógio: 2h parado na fila de uma pedreira é terça-feira,
 * e numa entrega urbana é problema.
 */
const AtualizarConfigTorreSchema = z.object({
  paradaLongaMin: z.number().int().min(15).max(1440).optional(),
  paradaLongaAltaMin: z.number().int().min(15).max(2880).optional(),
  viagemEsquecidaMin: z.number().int().min(60).max(10080).optional(),
  semSinalMin: z.number().int().min(15).max(1440).optional(),
  horaInicio: z.number().int().min(0).max(23).optional(),
  horaFim: z.number().int().min(0).max(23).optional(),
  notificaDomingo: z.boolean().optional(),
  fecharAbandonadaHoras: z.number().int().min(0).max(720).optional(),
});

const RegistrarOcorrenciaInput = z.object({
  viagemId: z.string().uuid(),
  tipoEventoId: z.string().uuid(),
  observacao: z.string().trim().max(500).nullish(),
});

/**
 * A torre: o que está fora do esperado agora.
 *
 * Fica sob `programacao` porque é a mesma pessoa que monta o dia e acompanha o
 * dia — criar uma chave própria só multiplicaria a matriz sem separar trabalho
 * nenhum.
 */
@ApiTags("admin/torre")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/torre")
export class TorreController {
  constructor(private readonly service: TorreService) {}

  @EscopoPor("motorista")
  @RequerPermissao("programacao.ver")
  @Get()
  alertas(@CurrentUser() user: AuthAdminUser) {
    return this.service.alertas(user.escopo);
  }

  @RequerPermissao("programacao.ver")
  @Get("config")
  config() {
    return this.service.config();
  }

  @RequerPermissao("programacao.editar")
  @Put("config")
  atualizarConfig(
    @Body(new ZodValidationPipe(AtualizarConfigTorreSchema))
    body: z.infer<typeof AtualizarConfigTorreSchema>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarConfig(body, user.id);
  }

  @RequerPermissao("programacao.editar")
  @Post("alertas/:id/resolver")
  resolver(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.resolverAlerta(id, user.id);
  }

  // O supervisor que atende a ligação "quebrei na BR-376" precisa registrar
  // pelo painel — antes disso, o único ponto que criava evento exigia token de
  // motorista e viagem com lifecycle aberto.
  @RequerPermissao("programacao.editar")
  @Post("ocorrencias")
  registrar(
    @Body(new ZodValidationPipe(RegistrarOcorrenciaInput))
    body: z.infer<typeof RegistrarOcorrenciaInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.registrarOcorrencia({ ...body, usuarioId: user.id });
  }

  @RequerPermissao("programacao.editar")
  @Post("ocorrencias/:id/encerrar")
  encerrar(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.encerrarOcorrencia(id, user.id);
  }
}
