import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { EscopoModule } from "./common/escopo/escopo.module";
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
import { ClickupRunnerModule } from "./clickup-runner/clickup-runner.module";
import { CompartilhamentoModule } from "./compartilhamento/compartilhamento.module";
import { AppVersionInterceptor } from "./common/app-version.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EscopoModule,
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
    ClickupRunnerModule,
    CompartilhamentoModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorsExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AppVersionInterceptor },
  ],
})
export class AppModule {}
