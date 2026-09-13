import { Module } from "@nestjs/common";
import { AuditoriaModule } from "../../auditoria/auditoria.module";
import { FinanceiroController } from "./financeiro.controller";
import { FinanceiroService } from "./financeiro.service";

@Module({
  imports: [AuditoriaModule],
  controllers: [FinanceiroController],
  providers: [FinanceiroService],
  exports: [FinanceiroService],
})
export class FinanceiroModule {}
