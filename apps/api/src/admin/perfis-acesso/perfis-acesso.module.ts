import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PerfisAcessoController } from "./perfis-acesso.controller";
import { PerfisAcessoService } from "./perfis-acesso.service";

@Module({
  imports: [PrismaModule],
  controllers: [PerfisAcessoController],
  providers: [PerfisAcessoService],
})
export class PerfisAcessoModule {}
