import { Module } from "@nestjs/common";
import { RelatoriosController } from "./relatorios.controller";
import { RelatoriosViagensService } from "./relatorios-viagens.service";
import { RelatoriosExportService } from "./relatorios-export.service";
import { RelatoriosAbastecimentosService } from "./relatorios-abastecimentos.service";
import { RelatoriosAbastecimentosExportService } from "./relatorios-abastecimentos-export.service";
import { RelatoriosConferenciaService } from "./relatorios-conferencia.service";

@Module({
  controllers: [RelatoriosController],
  providers: [
    RelatoriosViagensService,
    RelatoriosExportService,
    RelatoriosAbastecimentosService,
    RelatoriosAbastecimentosExportService,
    RelatoriosConferenciaService,
  ],
})
export class RelatoriosModule {}
