import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LocaisMotoristaService } from "./locais.service";

const CriarLocalInput = z.object({
  nome: z.string().min(3).max(120),
  logradouro: z.string().min(3),
  numero: z.string().max(20).optional(),
  bairro: z.string().max(80).optional(),
  cidade: z.string().min(2),
  uf: z.string().length(2),
  cep: z.string().max(15).optional(),
  pontoReferencia: z.string().max(200).optional(),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]),
  obraId: z.string().uuid().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

@ApiTags("motorista/locais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/locais")
export class LocaisMotoristaController {
  constructor(private readonly service: LocaisMotoristaService) {}

  @Post()
  criar(@Body(new ZodValidationPipe(CriarLocalInput)) body: z.infer<typeof CriarLocalInput>) {
    return this.service.criar(body);
  }
}
