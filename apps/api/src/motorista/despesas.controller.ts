import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarDespesaInput,
  CriarDespesaInput,
  ListarDespesasMotoristaQuery,
  VincularDespesasInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { contaIdAtual } from "../common/conta/conta-context";
import { exigirModuloDespesas, exigirMotoristaAprovado } from "../common/despesa-acesso";
import { DespesasMotoristaService } from "./despesas.service";

const LER = { algum: ["app.despesa.acompanhar", "app.despesa.lancar"] } as const;

/**
 * Gasto de viagem do motorista (módulo `despesas`).
 *
 * SEM `@AcessoMotorista(...)`: esse guard só checa aprovação quando há flag, e
 * o `CapacidadeAppGuard` começa em sombra. As duas portas que importam ficam
 * explícitas em cada handler (B6 do QA):
 *   - cadastro APROVADO em todas;
 *   - módulo `despesas` contratado nas ESCRITAS. A leitura não exige o módulo:
 *     o que ele já lançou é dele, mesmo com o módulo cancelado.
 * Os dois erros são 403 tipados (4xx): o item vai pros Pendentes, sem loop.
 */
@ApiTags("motorista/despesas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/despesas")
export class DespesasMotoristaController {
  constructor(
    private readonly service: DespesasMotoristaService,
    private readonly prisma: PrismaService,
  ) {}

  private async portasDeEscrita(motoristaId: string) {
    await exigirMotoristaAprovado(this.prisma, motoristaId);
    await exigirModuloDespesas(this.prisma, contaIdAtual());
  }

  @Get()
  @RequerCapacidade({ algum: [...LER.algum] })
  async list(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarDespesasMotoristaQuery)) query: ListarDespesasMotoristaQuery,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.list(user.id, query);
  }

  @Post()
  @RequerCapacidade("app.despesa.lancar")
  async create(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarDespesaInput)) body: CriarDespesaInput,
  ) {
    await this.portasDeEscrita(user.id);
    return this.service.create(user.id, body);
  }

  /** Ligar vários gastos à mesma viagem (ou "não foi em viagem", ou desfazer). */
  @Post("vincular")
  @HttpCode(200)
  @RequerCapacidade("app.despesa.lancar")
  async vincular(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(VincularDespesasInput)) body: VincularDespesasInput,
  ) {
    await this.portasDeEscrita(user.id);
    return this.service.vincular(user.id, body);
  }

  @Get(":id")
  @RequerCapacidade({ algum: [...LER.algum] })
  async detalhe(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.detalhe(user.id, id);
  }

  @Get(":id/fotos/:fotoId")
  @RequerCapacidade({ algum: [...LER.algum] })
  async foto(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Res() res: Response,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    const { buffer, contentType } = await this.service.foto(user.id, id, fotoId);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  @Patch(":id")
  @RequerCapacidade("app.despesa.lancar")
  async update(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarDespesaInput)) body: AtualizarDespesaInput,
  ) {
    await this.portasDeEscrita(user.id);
    return this.service.update(user.id, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequerCapacidade("app.despesa.lancar")
  async delete(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    await this.portasDeEscrita(user.id);
    await this.service.delete(user.id, id);
  }
}
