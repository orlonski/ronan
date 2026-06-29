import { Module } from "@nestjs/common";
import { PapeisController } from "./papeis.controller";
import { PapeisService } from "./papeis.service";

@Module({
  controllers: [PapeisController],
  providers: [PapeisService],
})
export class PapeisModule {}
