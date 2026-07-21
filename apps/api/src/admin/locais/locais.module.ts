import { Module } from "@nestjs/common";
import { LocaisImagemModule } from "../../locais-imagem/locais-imagem.module";
import { LocaisController } from "./locais.controller";
import { LocaisService } from "./locais.service";

@Module({
  imports: [LocaisImagemModule],
  controllers: [LocaisController],
  providers: [LocaisService],
})
export class LocaisModule {}
