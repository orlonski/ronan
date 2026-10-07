import { Module } from "@nestjs/common";
import { ChamadasExternasController } from "./chamadas-externas.controller";
import { ChamadasExternasService } from "./chamadas-externas.service";

/** Tela "Chamadas externas" da plataforma + o gravador do interceptador. */
@Module({
  controllers: [ChamadasExternasController],
  providers: [ChamadasExternasService],
})
export class ChamadasExternasModule {}
