import { Module } from "@nestjs/common";
import { RegrasMinimoController } from "./regras-minimo.controller";
import { RegrasMinimoService } from "./regras-minimo.service";

@Module({
  controllers: [RegrasMinimoController],
  providers: [RegrasMinimoService],
})
export class RegrasMinimoModule {}
