import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RelatorioViagensExportQuery, RelatorioViagensQuery } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { RelatoriosViagensService } from "./relatorios-viagens.service";
import { RelatoriosExportService } from "./relatorios-export.service";
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

    const nome = `relatorio-viagens-${query.de}_${query.ate}.${pdf ? "pdf" : "xlsx"}`;
    res.setHeader(
      "Content-Type",
      pdf
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    // O arquivo carrega o recorte de quem pediu; cache intermediário serviria o
    // recorte de um usuário pra outro.
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  }
}
