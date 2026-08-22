import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
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

  /**
   * Onde as divergências se concentram. É o atalho pra calibrar a regra sem
   * adivinhar a partir de exemplos soltos.
   */
  @Get("diagnostico")
  @RequerPermissao("viagens.ver")
  diagnostico() {
    return this.fila.diagnostico();
  }

  /** Quantas viagens JÁ EXISTENTES ainda esperam conferência. */
  @Get("pendentes")
  @RequerPermissao("viagens.ver")
  async pendentes() {
    return { pendentes: await this.fila.contarPendentesDeConferencia() };
  }

  /** A conferência de uma viagem específica — alimenta o card no detalhe dela. */
  @Get("viagem/:viagemId")
  @RequerPermissao("viagens.ver")
  daViagem(@Param("viagemId") viagemId: string) {
    return this.fila.ultimaDaViagem(viagemId);
  }

  /**
   * Manda o acervo pendente pra fila. Exige `viagens.validar` (e não só `ver`)
   * porque cada viagem enfileirada é uma leitura paga — isso é gastar dinheiro,
   * não consultar.
   */
  /**
   * Reavalia o que já foi lido, com a regra atual. **Não gasta um token**: a
   * leitura está guardada, só a comparação roda de novo. Por isso pede apenas
   * `viagens.ver` — não é gastar dinheiro, é recalcular.
   */
  @Post("recomparar")
  @RequerPermissao("viagens.ver")
  recomparar() {
    return this.fila.recompararTudo();
  }

  @Post("reprocessar")
  @RequerPermissao("viagens.validar")
  reprocessar(
    @Body(new ZodValidationPipe(z.object({ limite: z.number().int().min(1).max(500).default(100) })))
    body: { limite: number },
  ) {
    return this.fila.reprocessarPendentes(body.limite);
  }
}
