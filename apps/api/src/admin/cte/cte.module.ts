import { Module } from "@nestjs/common";
import { CteController } from "./cte.controller";
import { CteService } from "./cte.service";

@Module({
  controllers: [CteController],
  providers: [CteService],
  exports: [CteService],
})
export class CteModule {}
