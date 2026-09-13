import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { ImportacaoController } from "./importacao.controller";
import { ImportacaoService } from "./importacao.service";

@Module({
  imports: [AuthModule],
  controllers: [ImportacaoController],
  providers: [ImportacaoService],
})
export class ImportacaoModule {}
