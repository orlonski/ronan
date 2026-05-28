import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { GeocodingModule } from "./geocoding/geocoding.module";
import { MotoristaModule } from "./motorista/motorista.module";
import { UploadsModule } from "./uploads/uploads.module";
import { AuditoriaModule } from "./auditoria/auditoria.module";
import { IaModule } from "./ia/ia.module";
import { FechamentosModule } from "./fechamentos/fechamentos.module";
import { ErrorsModule } from "./errors/errors.module";
import { ErrorsExceptionFilter } from "./errors/errors.filter";
import { EventosModule } from "./eventos/eventos.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { NotificacoesModule } from "./notificacoes/notificacoes.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditoriaModule,
    IaModule,
    AuthModule,
    AdminModule,
    MotoristaModule,
    UploadsModule,
    FechamentosModule,
    GeocodingModule,
    HealthModule,
    ErrorsModule,
    EventosModule,
    WhatsappModule,
    NotificacoesModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ErrorsExceptionFilter }],
})
export class AppModule {}
