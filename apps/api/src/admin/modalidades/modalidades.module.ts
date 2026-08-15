import { Module } from "@nestjs/common";
import { ModalidadesController } from "./modalidades.controller";
import { ModalidadesService } from "./modalidades.service";

@Module({
  controllers: [ModalidadesController],
  providers: [ModalidadesService],
})
export class ModalidadesModule {}
