import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  ExtrairTicketInput,
  type ExtrairTicketResult,
} from "@ronan/shared-types";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { IaService } from "../ia/ia.service";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("motorista/ia")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@Controller("m/ia")
export class IaTicketController {
  constructor(
    private readonly ia: IaService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("extrair-ticket")
  @AcessoMotorista("podeUsarOcrTicket")
  async extrair(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(ExtrairTicketInput))
    body: { fotoBase64: string; mime: string },
  ): Promise<ExtrairTicketResult> {
    if (!this.ia.habilitada) {
      throw new HttpException(
        "Serviço de IA indisponível no momento",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const motoristaRow = await this.prisma.motorista.findUnique({
      where: { id: user.id },
      select: {
        veiculos: {
          select: {
            veiculo: { select: { id: true, placa: true, modelo: true } },
          },
        },
      },
    });
    const veiculos = (motoristaRow?.veiculos ?? []).map((v) => v.veiculo);

    const [clientes, materiais] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { ativa: true },
        select: { id: true, nome: true, apelidos: true },
      }),
      this.prisma.material.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, apelidos: true },
      }),
    ]);

    try {
      return await this.ia.extrairTicket({
        fotoBase64: body.fotoBase64,
        mime: body.mime,
        catalogos: { clientes, materiais, veiculos },
      });
    } catch {
      throw new HttpException(
        "Falha ao processar a foto com IA",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
