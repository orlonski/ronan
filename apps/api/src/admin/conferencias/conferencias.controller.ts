import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { ConferenciaFilaService } from "../../conferencia-ticket/conferencia-fila.service";
import { ConferenciaConfig } from "../../conferencia-ticket/conferencia.config";

/**
 * O que a conferência automática andou fazendo. Leitura pura — quem decide
 * sobre a viagem continua sendo a tela de viagens.
 *
 * Gateado por `viagens.ver`: quem enxerga as viagens enxerga a conferência
 * delas. Chave nova de permissão pra isso só somaria linha na matriz.
 */
@ApiTags("admin/conferencias")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/conferencias")
export class ConferenciasController {
  constructor(
    private readonly fila: ConferenciaFilaService,
    private readonly config: ConferenciaConfig,
  ) {}

  @Get("resumo")
  @RequerPermissao("viagens.ver")
  async resumo() {
    const r = await this.fila.resumo();
    return {
      ...r,
      // A tela precisa dizer em voz alta quando está em sombra: veredito
      // gravado com viagem intocada é fácil de confundir com "não funcionou".
      modoSombra: this.config.modoSombra,
      ativa: this.config.habilitado,
    };
  }

  @Get()
  @RequerPermissao("viagens.ver")
  listar(@Query("limite") limite?: string) {
    return this.fila.listar(limite ? Number(limite) : 50);
  }
}
