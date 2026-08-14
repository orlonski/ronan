import { Module } from "@nestjs/common";
import { RelatoriosController } from "./relatorios.controller";
import { RelatoriosViagensService } from "./relatorios-viagens.service";
import { RelatoriosExportService } from "./relatorios-export.service";
import { RelatoriosAbastecimentosService } from "./relatorios-abastecimentos.service";
import { RelatoriosAbastecimentosExportService } from "./relatorios-abastecimentos-export.service";

@Module({
  controllers: [RelatoriosController],
  providers: [
    RelatoriosViagensService,
    RelatoriosExportService,
    RelatoriosAbastecimentosService,
    RelatoriosAbastecimentosExportService,
  ],
})
export class RelatoriosModule {}
