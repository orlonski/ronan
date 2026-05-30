import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PedagiosRodoviaService } from "./pedagios-rodovia.service";

const CriarInput = z.object({
  nome: z.string().min(1).max(200),
  concessionaria: z.string().max(120).nullable().optional(),
  rodovia: z.string().max(40).nullable().optional(),
  cidade: z.string().max(120).nullable().optional(),
  uf: z.string().length(2).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  valorBase: z.number().nonnegative().nullable().optional(),
});

const AtualizarInput = CriarInput.partial().extend({
  ativo: z.boolean().optional(),
});

const ListQuery = paginationQuerySchema.extend({
  uf: z.string().length(2).optional(),
  ativo: z.enum(["true", "false"]).optional(),
});

@ApiTags("admin/pedagios-rodovia")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/pedagios-rodovia")
export class PedagiosRodoviaController {
  private readonly log = new Logger(PedagiosRodoviaController.name);
  constructor(private readonly service: PedagiosRodoviaService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.service.list(q);
  }

  @Get("mapa")
  mapa() {
    return this.service.listarParaMapa();
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @Post()
  criar(@Body(new ZodValidationPipe(CriarInput)) body: z.infer<typeof CriarInput>) {
    return this.service.criar(body);
  }

  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarInput)) body: z.infer<typeof AtualizarInput>,
  ) {
    return this.service.atualizar(id, body);
  }

  @Roles("ADMIN")
  @Delete(":id")
  @HttpCode(204)
  async excluir(@Param("id") id: string) {
    await this.service.excluir(id);
  }

  /**
   * Importa pedágios do OpenStreetMap via Overpass API. Roda síncrono
   * porque o volume é pequeno (~poucas centenas pra BR todo). Idempotente.
   */
  @Roles("ADMIN")
  @Post("importar-osm")
  async importarOSM() {
    try {
      return await this.service.importarOSM();
    } catch (err) {
      const msg = (err as Error).message ?? "Erro desconhecido";
      this.log.error(`Importação OSM falhou: ${msg}`, (err as Error).stack);
      // Expõe o motivo real ao admin (ex.: "Overpass API 504", "timeout")
      // pra ele saber se é flutuação do servidor público ou bug nosso.
      throw new BadGatewayException(`Falha ao importar do OSM: ${msg}`);
    }
  }
}
