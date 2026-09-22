import { Module } from "@nestjs/common";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { PrimeirosPassosController } from "./primeiros-passos.controller";
import { PrimeirosPassosService } from "./primeiros-passos.service";

@Module({
  imports: [OnboardingModule],
  controllers: [PrimeirosPassosController],
  providers: [PrimeirosPassosService],
})
export class PrimeirosPassosModule {}
