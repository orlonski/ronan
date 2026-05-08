import { Module } from "@nestjs/common";
import { LayoutImportController } from "./layout-import.controller";
import { LayoutImportService } from "./layout-import.service";

@Module({
  controllers: [LayoutImportController],
  providers: [LayoutImportService],
})
export class LayoutImportModule {}
