import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { FechamentosController } from "./fechamentos.controller";
import { FechamentosService } from "./fechamentos.service";
import { FechamentoProcessorService } from "./fechamento-processor.service";
import { LayoutEnvioController } from "./layout-envio.controller";
import { LayoutEnvioService } from "./layout-envio.service";
import { ExportFechamentoService } from "./export-fechamento.service";
import { EnviosController } from "./envios.controller";

@Module({
  imports: [UploadsModule],
  controllers: [FechamentosController, LayoutEnvioController, EnviosController],
  providers: [
    FechamentosService,
    FechamentoProcessorService,
    LayoutEnvioService,
    ExportFechamentoService,
  ],
})
export class FechamentosModule {}
