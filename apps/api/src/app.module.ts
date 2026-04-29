import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { GeocodingModule } from "./geocoding/geocoding.module";
import { MotoristaModule } from "./motorista/motorista.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AdminModule,
    MotoristaModule,
    UploadsModule,
    GeocodingModule,
    HealthModule,
  ],
})
export class AppModule {}
