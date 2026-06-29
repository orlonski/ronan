import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { GeocodingService } from "./geocoding.service";

@ApiTags("geocoding")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER", "MOTORISTA")
@Controller("geocoding")
export class GeocodingController {
  constructor(private readonly service: GeocodingService) {}

  @Get("cep")
  cep(@Query("cep") cep: string) {
    return this.service.buscarPorCep(cep);
  }

  @Get("buscar")
  buscar(
    @Query("q") q: string,
    @Query("lat") lat?: string,
    @Query("lng") lng?: string,
  ) {
    const latN = lat ? Number(lat) : undefined;
    const lngN = lng ? Number(lng) : undefined;
    const bias =
      latN != null &&
      lngN != null &&
      Number.isFinite(latN) &&
      Number.isFinite(lngN)
        ? { lat: latN, lng: lngN }
        : undefined;
    return this.service.buscarPorTexto(q ?? "", bias);
  }

  @Get("place")
  place(@Query("placeId") placeId: string) {
    return this.service.resolverPlace(placeId ?? "");
  }

  @Get("reverso")
  reverso(@Query("lat") lat: string, @Query("lng") lng: string) {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (
      !Number.isFinite(latN) ||
      !Number.isFinite(lngN) ||
      latN < -90 ||
      latN > 90 ||
      lngN < -180 ||
      lngN > 180
    ) {
      return null;
    }
    return this.service.reverseGeocoding(latN, lngN);
  }
}
