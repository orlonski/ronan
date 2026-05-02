import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { GeocodingService } from "./geocoding.service";

@ApiTags("geocoding")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR", "MOTORISTA")
@Controller("geocoding")
export class GeocodingController {
  constructor(private readonly service: GeocodingService) {}

  @Get("cep")
  cep(@Query("cep") cep: string) {
    return this.service.buscarPorCep(cep);
  }

  @Get("buscar")
  buscar(@Query("q") q: string) {
    return this.service.buscarPorTexto(q ?? "");
  }

  @Get("place")
  place(@Query("placeId") placeId: string) {
    return this.service.resolverPlace(placeId ?? "");
  }
}
