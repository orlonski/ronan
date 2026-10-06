import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { EtapasNucleoService } from "./etapas-nucleo.service";

/** Núcleo das etapas da viagem: usado pelo /m/etapas, pelo painel e pelo fluxo de viagem. */
@Module({
  imports: [UploadsModule],
  providers: [EtapasNucleoService],
  exports: [EtapasNucleoService],
})
export class EtapasNucleoModule {}
