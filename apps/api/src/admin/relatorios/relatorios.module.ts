import { Module } from "@nestjs/common";
import { RelatoriosController } from "./relatorios.controller";
import { RelatoriosViagensService } from "./relatorios-viagens.service";
import { RelatoriosExportService } from "./relatorios-export.service";

@Module({
  controllers: [RelatoriosController],
  providers: [RelatoriosViagensService, RelatoriosExportService],
})
export class RelatoriosModule {}
