import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { ProspeccaoService } from "./prospeccao.service";
import { RntrcService } from "./rntrc.service";

/**
 * Captação de clientes da plataforma.
 *
 * Gateado por `prospeccao.*`, que é chave de PLATAFORMA: o administrador de uma
 * transportadora cliente não recebe essas chaves e nem vê o menu. A lista de
 * quem a gente está prospectando não é assunto de quem já é cliente.
 */
@ApiTags("prospeccao")
@Roles("ADMIN_USER")
@Controller("admin/prospeccao")
export class ProspeccaoController {
  constructor(
    private readonly prospeccao: ProspeccaoService,
    private readonly rntrc: RntrcService,
  ) {}

  @RequerPermissao("prospeccao.ver")
  @Get("resumo")
  async resumo() {
    return this.prospeccao.resumo();
  }

  @RequerPermissao("prospeccao.ver")
  @Get("leads")
  async leads(
    @Query("uf") uf?: string,
    @Query("municipio") municipio?: string,
    @Query("status") status?: string,
    @Query("scoreMinimo") scoreMinimo?: string,
    @Query("comContato") comContato?: string,
    @Query("pagina") pagina?: string,
    @Query("porPagina") porPagina?: string,
  ) {
    return this.prospeccao.listar({
      uf,
      municipio,
      status,
      scoreMinimo: scoreMinimo ? Number(scoreMinimo) : undefined,
      comContato: comContato === "true" ? true : comContato === "false" ? false : undefined,
      pagina: pagina ? Number(pagina) : 1,
      porPagina: porPagina ? Number(porPagina) : 50,
    });
  }

  /**
   * Dispara a carga do RNTRC. Demora minutos (o arquivo tem ~159 MB), então
   * responde assim que termina — não é rota pra chamar de tela sem aviso.
   */
  @RequerPermissao("prospeccao.importar")
  @Post("importar-rntrc")
  async importarRntrc(@Body() body: { ufs?: string[]; urlDireta?: string }) {
    return this.rntrc.importar({ ufs: body?.ufs, urlDireta: body?.urlDireta });
  }

  /** Repontua a base sem rebaixar nada do trabalho de campo. Roda em segundos. */
  @RequerPermissao("prospeccao.importar")
  @Post("recalcular-scores")
  async recalcularScores() {
    return this.rntrc.recalcularScores();
  }

  /**
   * Registra que alguém pediu pra não ser mais contatado.
   *
   * Grava na tabela de supressão E marca o lead. A supressão é o que sobrevive
   * à próxima carga mensal; a marcação no lead é o que aparece na tela.
   */
  @RequerPermissao("prospeccao.editar")
  @Post("opt-out")
  async optOut(@Body() body: { contato: string; motivo?: string; fonte?: string }) {
    return this.prospeccao.registrarOptOut(body.contato, body.motivo, body.fonte);
  }
}
