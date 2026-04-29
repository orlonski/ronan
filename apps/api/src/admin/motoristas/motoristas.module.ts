import { Module } from "@nestjs/common";
import { MotoristasController } from "./motoristas.controller";
import { MotoristasService } from "./motoristas.service";

@Module({
  controllers: [MotoristasController],
  providers: [MotoristasService],
})
export class MotoristasModule {}
