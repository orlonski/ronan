import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CriarComprovantePessoalInput, EstimarFreteInput } from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthIdentidade } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { FretePessoalService } from "./frete-pessoal.service";

/**
 * "Vale a pena esse frete?" e o comprovante do que ele rodou.
 *
 * Sob `m/eu` porque é da PESSOA — vale com ou sem empresa. Ver
 * docs/motorista-sem-empresa.md.
 */
@ApiTags("motorista")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("IDENTIDADE")
@Controller("m/eu/frete")
export class FretePessoalController {
  constructor(private readonly service: FretePessoalService) {}

  @HttpCode(200)
  @Post("estimar")
  estimar(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(EstimarFreteInput)) body: EstimarFreteInput,
  ) {
    return this.service.estimar(
      user.id,
      { lat: body.origemLat, lng: body.origemLng },
      { lat: body.destinoLat, lng: body.destinoLng },
    );
  }

  @HttpCode(200)
  @Post("comprovante")
  criarComprovante(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(CriarComprovantePessoalInput))
    body: CriarComprovantePessoalInput,
  ) {
    return this.service.criarComprovante(user.id, body.inicio, body.fim, body.destinatario);
  }

  @Delete("comprovante/:token")
  revogarComprovante(@CurrentUser() user: AuthIdentidade, @Param("token") token: string) {
    return this.service.revogarComprovante(user.id, token);
  }
}

/**
 * A página que o contratante abre — sem cadastro, sem login.
 *
 * `@Public` + prefixo próprio, longe de `m/*`: rota pública que lesse dado de
 * empresa quebraria por falta de conta no contexto (já aconteceu aqui com o
 * comprovante de viagem e a recuperação de senha). Tudo o que esta rota lê é da
 * pessoa, e sai campo a campo.
 */
@ApiTags("publico")
@Controller("publico/comprovante")
export class ComprovantePessoalPublicoController {
  constructor(private readonly service: FretePessoalService) {}

  @Public()
  @Get(":token")
  ver(@Param("token") token: string) {
    return this.service.comprovantePublico(token);
  }
}
