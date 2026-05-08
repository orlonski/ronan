import { Global, Module } from "@nestjs/common";
import { CamposLayoutController } from "./campos-layout.controller";
import { CamposLayoutService } from "./campos-layout.service";

@Global()
@Module({
  controllers: [CamposLayoutController],
  providers: [CamposLayoutService],
  exports: [CamposLayoutService],
})
export class CamposLayoutModule {}
