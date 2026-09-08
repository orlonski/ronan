import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { IdentidadeService } from "./identidade.service";
import { EuController } from "./eu.controller";
import { EuService } from "./eu.service";
import { LancamentosPessoaisService } from "./lancamentos-pessoais.service";
import { CadastroMotoristaService } from "./cadastro-motorista.service";
import { RedefinicaoSenhaService } from "./redefinicao-senha.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissaoGuard } from "./guards/permissao.guard";
import { EvolutionModule } from "../whatsapp/evolution.module";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    EvolutionModule,
    AdminInboxModule,
    // Apagar a conta apaga também as fotos dos documentos no MinIO.
    UploadsModule,
  ],
  controllers: [AuthController, EuController],
  providers: [
    AuthService,
    IdentidadeService,
    EuService,
    LancamentosPessoaisService,
    CadastroMotoristaService,
    RedefinicaoSenhaService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Roda global; só bloqueia onde houver @RequerPermissao (senão libera).
    { provide: APP_GUARD, useClass: PermissaoGuard },
  ],
  exports: [AuthService, IdentidadeService],
})
export class AuthModule {}
