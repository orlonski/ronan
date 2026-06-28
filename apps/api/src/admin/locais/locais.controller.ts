import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CriarLocalInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { LocaisService } from "./locais.service";

const ListLocaisQuery = paginationQuerySchema.extend({
  clienteId: z.string().uuid().optional(),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]).optional(),
  ativo: z.enum(["true", "false"]).optional(),
  nivelConfianca: z
    .enum(["RASCUNHO", "PRESENCA_PONTUAL", "DWELL_CONFIRMADO", "RECORRENTE", "HUMANO"])
    .optional(),
  emValidacao: z.enum(["true", "false"]).optional(),
});
type ListLocaisQuery = z.infer<typeof ListLocaisQuery>;

const MesclarInput = z.object({ destinoId: z.string().uuid() });

@ApiTags("admin/locais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/locais")
export class LocaisController {
  constructor(private readonly service: LocaisService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListLocaisQuery)) query: ListLocaisQuery) {
    return this.service.list(query);
  }

  /**
   * Lista enxuta pra exibir no mapa (sem paginação). Definida ANTES de :id
   * pra Nest não interpretar "mapa" como id.
   */
  @Get("mapa")
  mapa() {
    return this.service.mapa();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  /**
   * Pontos de lançamento (lat/lng da viagem) das viagens deste local — pra
   * plotar no mapa do "ver local". Mais recentes primeiro, limitado.
   */
  @Get(":id/lancamentos")
  lancamentos(@Param("id") id: string) {
    return this.service.lancamentos(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CriarLocalInput)) body: CriarLocalInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CriarLocalInput.partial())) body: Partial<CriarLocalInput>,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  /**
   * Admin homologa o local — sobe pra HUMANO. Usado pela aba "Em validação"
   * pra confirmar locais que vieram com evidência boa.
   */
  @Post(":id/homologar")
  homologar(@Param("id") id: string) {
    return this.service.homologar(id);
  }

  /**
   * Mescla duplicata: move viagens do local atual pra destinoId e apaga o
   * atual. Pra quando o pre-check de 200m não pegou duplicata.
   */
  @Post(":id/mesclar")
  mesclar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MesclarInput)) body: z.infer<typeof MesclarInput>,
  ) {
    return this.service.mesclar(id, body.destinoId);
  }
}
