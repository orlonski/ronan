import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { EscopoModule } from "./common/escopo/escopo.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { LancamentosResgatadosModule } from "./lancamentos-resgatados/lancamentos-resgatados.module";
import { GeocodingModule } from "./geocoding/geocoding.module";
import { MotoristaModule } from "./motorista/motorista.module";
import { ChatModule } from "./chat/chat.module";
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
import { ContaMiddleware } from "./common/conta/conta.middleware";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter";

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
    LancamentosResgatadosModule,
    MotoristaModule,
    ChatModule,
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
    // Depois do genérico de propósito: no Nest, o filtro registrado por último
    // tem precedência pro tipo que ele declara em @Catch.
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AppVersionInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * O contexto de conta abre em TODA rota, sem exceção. Rota que não identifica
   * a empresa simplesmente não consegue ler dado de negócio — a trava recusa —,
   * e é assim que queremos: esquecer de escopar vira erro visível, não
   * vazamento silencioso.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContaMiddleware).forRoutes("*");
  }
}
