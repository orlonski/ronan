import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { UploadsModule } from "../uploads/uploads.module";
import { ArtePublicaController } from "./arte-publica.controller";
import { InstagramAdminController } from "./instagram-admin.controller";
import { InstagramConfig } from "./instagram.config";
import { InstagramFilaService } from "./instagram-fila.service";
import { InstagramPublicadorService } from "./instagram-publicador.service";

/**
 * Marketing da própria Movatruck — hoje, o Instagram do @movatruck.
 *
 * É ferramenta da PLATAFORMA divulgando a si mesma, não recurso de cliente: o
 * model é global (sem contaId) e o recurso `marketing` está em
 * RECURSOS_PLATAFORMA, então empresa cliente nova não nasce podendo postar no
 * perfil da Movatruck.
 *
 * Nasce desligado em dois interruptores independentes: sem credencial em env o
 * cron nem roda, e mesmo com credencial nada sai enquanto
 * `ConfiguracaoPlataforma.instagramAtivo` for false.
 */
@Module({
  imports: [PrismaModule, UploadsModule],
  controllers: [InstagramAdminController, ArtePublicaController],
  providers: [InstagramConfig, InstagramFilaService, InstagramPublicadorService],
  exports: [InstagramFilaService],
})
export class MarketingModule {}
