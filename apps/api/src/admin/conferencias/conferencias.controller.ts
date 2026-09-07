import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { ConferenciaFilaService } from "../../conferencia-ticket/conferencia-fila.service";
import { ConferenciaConfig } from "../../conferencia-ticket/conferencia.config";
import type { VereditoConferencia } from "@prisma/client";

/** O que a tela pode pedir. Fora daqui o filtro é descartado. */
const VEREDITOS: VereditoConferencia[] = [
  "BATE",
  "DIVERGE",
  "INCERTO",
  "ILEGIVEL",
  "NAO_APLICAVEL",
];
const CAMPOS = ["toneladas", "ticket", "placa", "data", "cliente", "material"];

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
  @RequerPermissao("conferencia-ticket.ver")
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

  /**
   * A lista, com o mesmo recorte que o diagnóstico agrupa.
   *
   * Parâmetro fora do catálogo é ignorado, não vira 400: o filtro nasce de um
   * clique na tela, e devolver erro pra quem clicou num grupo que já não
   * existe seria trocar um resultado vazio por uma tela quebrada.
   */
  @Get()
  @RequerPermissao("conferencia-ticket.ver")
  listar(
    @Query("limite") limite?: string,
    @Query("veredito") veredito?: string,
    @Query("campo") campo?: string,
    @Query("tipo") tipo?: string,
  ) {
    return this.fila.listar({
      limite: limite ? Number(limite) : 50,
      veredito: VEREDITOS.includes(veredito as VereditoConferencia)
        ? (veredito as VereditoConferencia)
        : undefined,
      campo: CAMPOS.includes(campo ?? "") ? campo : undefined,
      tipo: tipo === "divergencia" || tipo === "incerteza" ? tipo : undefined,
    });
  }

  /**
   * Onde as divergências se concentram. É o atalho pra calibrar a regra sem
   * adivinhar a partir de exemplos soltos.
   */
  @Get("diagnostico")
  @RequerPermissao("conferencia-ticket.ver")
  diagnostico() {
    return this.fila.diagnostico();
  }

  /** Quantas viagens JÁ EXISTENTES ainda esperam conferência. */
  @Get("pendentes")
  @RequerPermissao("conferencia-ticket.ver")
  async pendentes() {
    return { pendentes: await this.fila.contarPendentesDeConferencia() };
  }

  /** A conferência de uma viagem específica — alimenta o card no detalhe dela. */
  @Get("viagem/:viagemId")
  @RequerPermissao("conferencia-ticket.ver")
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
  @RequerPermissao("conferencia-ticket.ver")
  recomparar() {
    return this.fila.recompararTudo();
  }

  /**
   * Reavalia UMA viagem com a regra de hoje, contra os dados lançados AGORA.
   * Mesmo custo zero do `recomparar` em lote — só a comparação roda de novo —,
   * e por isso a mesma permissão de leitura.
   *
   * Existe separado do lote porque o lote responde "o acervo acompanhou a
   * regra nova?" e este responde "corrigi ESTA viagem, e daí?". Quem está
   * decidindo uma viagem não deveria ter que ir noutra tela mandar recomparar
   * o mundo inteiro pra ver o efeito.
   */
  @Post("viagem/:viagemId/recomparar")
  @RequerPermissao("conferencia-ticket.ver")
  recompararViagem(@Param("viagemId") viagemId: string) {
    return this.fila.recompararViagem(viagemId);
  }

  /**
   * Relê a foto de uma viagem. Pro caso em que a foto está boa e a leitura não
   * deu certo — pedir foto nova ao motorista seria cobrar dele um problema
   * nosso. Custa uma leitura, daí exigir `viagens.validar`.
   */
  @Post("viagem/:viagemId/reler")
  @RequerPermissao("conferencia-ticket.reprocessar")
  reler(@Param("viagemId") viagemId: string) {
    return this.fila.relerViagem(viagemId);
  }

  @Post("reprocessar")
  @RequerPermissao("conferencia-ticket.reprocessar")
  reprocessar(
    @Body(new ZodValidationPipe(z.object({ limite: z.number().int().min(1).max(500).default(100) })))
    body: { limite: number },
  ) {
    return this.fila.reprocessarPendentes(body.limite);
  }
}
