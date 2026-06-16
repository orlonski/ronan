import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CadastroMotoristaService } from "./cadastro-motorista.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    EvolutionModule,
    AdminInboxModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CadastroMotoristaService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
