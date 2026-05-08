import { Module } from "@nestjs/common";
import { ConviteService } from "./convite.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { WhatsappController } from "./whatsapp.controller";
import { WhatsappService } from "./whatsapp.service";

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, EvolutionClientService, SessaoService, ConviteService],
  exports: [WhatsappService, SessaoService, ConviteService, EvolutionClientService],
})
export class WhatsappModule {}
