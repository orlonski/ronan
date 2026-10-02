import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  RelatorioAbastecimentosExportQuery,
  RelatorioAbastecimentosQuery,
  RelatorioConferenciaQuery,
  RelatorioLucroExportQuery,
  RelatorioLucroQuery,
  RelatorioResultadoObraDetalheQuery,
  RelatorioResultadoObraExportQuery,
  RelatorioResultadoObraQuery,
  RelatorioViagensExportQuery,
  RelatorioViagensQuery,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { RelatoriosViagensService } from "./relatorios-viagens.service";
import { RelatoriosExportService } from "./relatorios-export.service";
import { RelatoriosAbastecimentosService } from "./relatorios-abastecimentos.service";
import { RelatoriosAbastecimentosExportService } from "./relatorios-abastecimentos-export.service";
import { RelatoriosConferenciaService } from "./relatorios-conferencia.service";
import { RelatoriosLucroService } from "./relatorios-lucro.service";
import { RelatoriosCicloService } from "./relatorios-ciclo.service";
import { RelatoriosLucroExportService } from "./relatorios-lucro-export.service";
import { RelatoriosResultadoObraService } from "./relatorios-resultado-obra.service";
import { RelatoriosResultadoObraExportService } from "./relatorios-resultado-obra-export.service";
import { exigirComercialParaDimensao, podeVerComercial } from "./comercial-relatorio";
import { exigirComercialParaFiltros } from "../viagens/comercial";

/** Teto de linhas na aba de detalhe do XLSX. Acima disso a planilha não abre. */
const MAX_DETALHE_XLSX = 50_000;

@ApiTags("admin/relatorios")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/relatorios")
export class RelatoriosController {
  constructor(
    private readonly viagens: RelatoriosViagensService,
    private readonly exportar: RelatoriosExportService,
    private readonly abastecimentos: RelatoriosAbastecimentosService,
    private readonly exportarAbastecimentos: RelatoriosAbastecimentosExportService,
    private readonly conferencia: RelatoriosConferenciaService,
    private readonly lucro: RelatoriosLucroService,
    private readonly exportarLucro: RelatoriosLucroExportService,
    private readonly resultadoObra: RelatoriosResultadoObraService,
    private readonly exportarResultadoObra: RelatoriosResultadoObraExportService,
    private readonly ciclo: RelatoriosCicloService,
  ) {}

  @EscopoPor("viagem")
  @RequerPermissao("relatorios.ver")
  @Get("viagens")
  resumo(
    @Query(new ZodValidationPipe(RelatorioViagensQuery)) query: RelatorioViagensQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    // AND com `relatorios.ver`, que o decorator não expressa (ele é OR).
    exigirComercialParaDimensao(query.agruparPor, user);
    exigirComercialParaFiltros(query, podeVerComercial(user));
    return this.viagens.resumo(query, user.escopo, podeVerComercial(user));
  }

  @EscopoPor("viagem")
  @RequerPermissao("relatorios.exportar")
  @Get("viagens/exportar")
  async exportarViagens(
    @Query(new ZodValidationPipe(RelatorioViagensExportQuery)) query: RelatorioViagensExportQuery,
    @CurrentUser() user: AuthAdminUser,
    @Res() res: Response,
  ) {
    exigirComercialParaDimensao(query.agruparPor, user);
    exigirComercialParaFiltros(query, podeVerComercial(user));
    const comercial = podeVerComercial(user);

    const relatorio = await this.viagens.resumo(query, user.escopo, comercial);
    const detalhe = query.incluirDetalhe
      ? await this.viagens.detalhe(query, user.escopo, comercial, MAX_DETALHE_XLSX)
      : null;

    const pdf = query.formato === "pdf";
    const buffer = pdf
      ? await this.exportar.pdf(relatorio, detalhe, query)
      : await this.exportar.xlsx(relatorio, detalhe, query);

    responderArquivo(res, buffer, `relatorio-viagens-${query.de}_${query.ate}`, pdf);
  }

  /**
   * Abastecimentos do período, agregados. Não passa pelo gate comercial do
   * relatório de viagens de propósito: `empresa` aqui é o TOMADOR que paga o
   * combustível, e a listagem de abastecimentos já mostra esse vínculo a quem
   * tem `abastecimentos.ver` — gatear só neste ponto daria a falsa impressão de
   * proteção sem esconder nada. O que restringe as linhas é o escopo de frota.
   */
  @EscopoPor("abastecimento")
  @RequerPermissao("relatorios.ver")
  @Get("abastecimentos")
  resumoAbastecimentos(
    @Query(new ZodValidationPipe(RelatorioAbastecimentosQuery))
    query: RelatorioAbastecimentosQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.abastecimentos.resumo(query, user.escopo);
  }

  /**
   * Consumo (km/l) e custo por km, por veículo. Usa o mesmo filtro de período e
   * frota do relatório de abastecimentos.
   */
  @EscopoPor("abastecimento")
  @RequerPermissao("relatorios.ver")
  @Get("consumo")
  consumo(
    @Query(new ZodValidationPipe(RelatorioAbastecimentosQuery))
    query: RelatorioAbastecimentosQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.abastecimentos.consumoPorVeiculo(query, user.escopo);
  }

  @EscopoPor("abastecimento")
  @RequerPermissao("relatorios.exportar")
  @Get("abastecimentos/exportar")
  async exportarAbastecimentosArquivo(
    @Query(new ZodValidationPipe(RelatorioAbastecimentosExportQuery))
    query: RelatorioAbastecimentosExportQuery,
    @CurrentUser() user: AuthAdminUser,
    @Res() res: Response,
  ) {
    const relatorio = await this.abastecimentos.resumo(query, user.escopo);
    const detalhe = query.incluirDetalhe
      ? await this.abastecimentos.detalhe(query, user.escopo, MAX_DETALHE_XLSX)
      : null;

    const pdf = query.formato === "pdf";
    const buffer = pdf
      ? await this.exportarAbastecimentos.pdf(relatorio, detalhe, query)
      : await this.exportarAbastecimentos.xlsx(relatorio, detalhe, query);

    responderArquivo(res, buffer, `relatorio-abastecimentos-${query.de}_${query.ate}`, pdf);
  }

  /**
   * Tempo de conferência ao longo do tempo — o "antes e depois" da conferência
   * automática.
   *
   * Fica sob `relatorios.ver` e não sob `conferencia-ticket.ver` de propósito:
   * aquela chave é de plataforma (a tela dela mostra o custo em dólar da conta
   * da Movatruck) e não chega ao admin da empresa cliente. O que este endpoint
   * devolve é tempo, não dinheiro — é operação da empresa, e é dela.
   */
  @EscopoPor("viagem")
  @RequerPermissao("relatorios.ver")
  @Get("conferencia")
  resumoConferencia(
    @Query(new ZodValidationPipe(RelatorioConferenciaQuery)) query: RelatorioConferenciaQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.conferencia.resumo(query, user.escopo);
  }

  /** Ciclo da carga: tempo na pedreira, no trajeto e na obra (mediana e p90). */
  @EscopoPor("viagem")
  @RequerPermissao("relatorios.ver")
  @Get("ciclo")
  resumoCiclo(
    @Query(new ZodValidationPipe(RelatorioLucroQuery)) query: RelatorioLucroQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.ciclo.resumo(query, user.escopo);
  }

  /**
   * Lucro por caminhão: faturou menos o que a empresa gastou com ele.
   *
   * Chave própria (`lucro-caminhao`), não `relatorios.ver`: mostra a margem do
   * negócio e quanto cada motorista ganha, e `relatorios.ver` chega até no
   * gestor de frota terceira.
   */
  @EscopoPor("veiculo")
  @RequerPermissao("lucro-caminhao.ver")
  @Get("lucro")
  resumoLucro(
    @Query(new ZodValidationPipe(RelatorioLucroQuery)) query: RelatorioLucroQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.lucro.lucroPorVeiculo(query, user.escopo);
  }

  @EscopoPor("veiculo")
  @RequerPermissao("lucro-caminhao.exportar")
  @Get("lucro/exportar")
  async exportarLucroArquivo(
    @Query(new ZodValidationPipe(RelatorioLucroExportQuery)) query: RelatorioLucroExportQuery,
    @CurrentUser() user: AuthAdminUser,
    @Res() res: Response,
  ) {
    const relatorio = await this.lucro.lucroPorVeiculo(query, user.escopo);
    const pdf = query.formato === "pdf";
    const buffer = pdf
      ? await this.exportarLucro.pdf(relatorio)
      : await this.exportarLucro.xlsx(relatorio);
    responderArquivo(res, buffer, `lucro-por-caminhao-${query.de}_${query.ate}`, pdf);
  }

  /**
   * Resultado por obra: o lucro por caminhão redistribuído entre as obras que
   * cada caminhão atendeu. Chave própria (`resultado-obra`) pelo mesmo motivo
   * do lucro: é a margem de cada cliente, conversa de dono. Escopo por
   * VEÍCULO, igual ao lucro — senão os dois relatórios recortariam a frota de
   * jeitos diferentes e a soma não fecharia.
   */
  @EscopoPor("veiculo")
  @RequerPermissao("resultado-obra.ver")
  @Get("resultado-obra")
  resumoResultadoObra(
    @Query(new ZodValidationPipe(RelatorioResultadoObraQuery)) query: RelatorioResultadoObraQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.resultadoObra.resumo(query, user.escopo);
  }

  @EscopoPor("veiculo")
  @RequerPermissao("resultado-obra.ver")
  @Get("resultado-obra/obra")
  detalheResultadoObra(
    @Query(new ZodValidationPipe(RelatorioResultadoObraDetalheQuery)) query: RelatorioResultadoObraDetalheQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.resultadoObra.detalhe(query, user.escopo);
  }

  @EscopoPor("veiculo")
  @RequerPermissao("resultado-obra.exportar")
  @Get("resultado-obra/exportar")
  async exportarResultadoObraArquivo(
    @Query(new ZodValidationPipe(RelatorioResultadoObraExportQuery)) query: RelatorioResultadoObraExportQuery,
    @CurrentUser() user: AuthAdminUser,
    @Res() res: Response,
  ) {
    const relatorio = await this.resultadoObra.completo(query, user.escopo);
    const pdf = query.formato === "pdf";
    const buffer = pdf
      ? await this.exportarResultadoObra.pdf(relatorio)
      : await this.exportarResultadoObra.xlsx(relatorio);
    responderArquivo(res, buffer, `resultado-por-obra-${query.de}_${query.ate}`, pdf);
  }
}

function responderArquivo(res: Response, buffer: Buffer, nome: string, pdf: boolean): void {
  res.setHeader(
    "Content-Type",
    pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nome}.${pdf ? "pdf" : "xlsx"}"`);
  // O arquivo carrega o recorte de quem pediu; cache intermediário serviria o
  // recorte de um usuário pra outro.
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}
