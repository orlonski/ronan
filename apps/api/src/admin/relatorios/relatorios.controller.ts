import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  RelatorioAbastecimentosExportQuery,
  RelatorioAbastecimentosQuery,
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
