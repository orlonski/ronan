import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CadastroMotoristaService } from "./cadastro-motorista.service";
import { RedefinicaoSenhaService } from "./redefinicao-senha.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissaoGuard } from "./guards/permissao.guard";
import { EscopoGuard } from "./guards/escopo.guard";
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
    RedefinicaoSenhaService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Roda global; só bloqueia onde houver @RequerPermissao (senão libera).
    { provide: APP_GUARD, useClass: PermissaoGuard },
    // Roda global e é FAIL-CLOSED, ao contrário do de cima: usuário restrito a
    // transportadora só passa onde houver @EscopoPor/@IgnoraEscopo. Não afeta
    // quem tem acesso global — ou seja, todo mundo hoje.
    { provide: APP_GUARD, useClass: EscopoGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
