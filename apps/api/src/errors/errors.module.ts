import { Module } from "@nestjs/common";
import { ErrorsController } from "./errors.controller";
import { ErrorsService } from "./errors.service";
import { ErrorsExceptionFilter } from "./errors.filter";

@Module({
  controllers: [ErrorsController],
  providers: [ErrorsService, ErrorsExceptionFilter],
  exports: [ErrorsService],
})
export class ErrorsModule {}
