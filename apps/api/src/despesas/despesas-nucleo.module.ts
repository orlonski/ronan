import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { DespesasNucleoService } from "./despesas-nucleo.service";

@Module({
  imports: [UploadsModule],
  providers: [DespesasNucleoService],
  exports: [DespesasNucleoService],
})
export class DespesasNucleoModule {}
