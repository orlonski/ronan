import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { RunnerConfig } from "../../clickup-runner/runner.config";
import { FilaExecucoesService } from "../../clickup-runner/fila.service";
import { DemandasController } from "./demandas.controller";
import { DemandasService } from "./demandas.service";

/**
 * Cadastro de demandas pelo painel. Enfileira na mesma fila do webhook —
 * quem executa continua sendo o serviço do agente, sem saber de onde veio.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DemandasController],
  providers: [RunnerConfig, FilaExecucoesService, DemandasService],
})
export class DemandasModule {}
