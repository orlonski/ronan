import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  ListarEtapasMotoristaQuery,
  ResponderEtapaInput,
  SeguiuSemEtapaInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { exigirMotoristaAprovado } from "../common/despesa-acesso";
import { EtapasMotoristaService } from "./etapas.service";

/**
 * Etapas da viagem do motorista (módulo `etapas`, capacidade `app.viagem.etapas`).
 *
 * SEM `@AcessoMotorista(...)`: esse guard só checa aprovação quando há flag, e
 * o `CapacidadeAppGuard` começa em sombra. As portas ficam explícitas:
 *   - cadastro APROVADO em todas (403 tipado → Pendentes, nunca loop);
 *   - o módulo é checado NO SERVIÇO, e sem ele NADA é recusado: o catálogo
 *     vem vazio e o envio é aceito e carimbado (`aoPerder: VALA`, I3 do QA).
 */
@ApiTags("motorista/etapas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@RequerCapacidade("app.viagem.etapas")
@Controller("m/etapas")
export class EtapasMotoristaController {
  constructor(
    private readonly service: EtapasMotoristaService,
    private readonly prisma: PrismaService,
  ) {}

  /** O catálogo (o mesmo que vai em `/m/catalogos` como `modelosEtapa`). */
  @Get("modelos")
  async modelos(@CurrentUser() user: AuthMotorista) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.modelos();
  }

  /** O que ele já mandou + o que falta (de uma viagem ou das recentes). */
  @Get()
  async listar(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarEtapasMotoristaQuery)) q: ListarEtapasMotoristaQuery,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.listar(user.id, q.viagemClientId);
  }

  /** Só o que falta — a barreira revalida por aqui antes de parar o motorista. */
  @Get("pendencias")
  async pendencias(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarEtapasMotoristaQuery)) q: ListarEtapasMotoristaQuery,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.pendencias(user.id, q.viagemClientId);
  }

  /** Cria ou MESCLA a resposta de (viagem, modelo). Sempre 200 — nunca 409 pelo mesmo par. */
  @Post()
  @HttpCode(200)
  async responder(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(ResponderEtapaInput)) body: ResponderEtapaInput,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.responder(user.id, body);
  }

  /** "Seguir sem isso" na barreira, com o motivo. */
  @Post("seguiu-sem")
  @HttpCode(200)
  async seguiuSem(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(SeguiuSemEtapaInput)) body: SeguiuSemEtapaInput,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    return this.service.seguiuSem(user.id, body);
  }

  /** O arquivo que ELE mandou, pela API (o bucket nunca tem domínio público). */
  @Get("arquivos/:id")
  async arquivo(@CurrentUser() user: AuthMotorista, @Param("id") id: string, @Res() res: Response) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    const { buffer, contentType } = await this.service.arquivo(user.id, id);
    res.set("Content-Type", contentType);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }
}
