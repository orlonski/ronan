import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ChatwootClientModule } from "../chatwoot/chatwoot-client.module";
import { ProspeccaoController } from "./prospeccao.controller";
import { ProspeccaoService } from "./prospeccao.service";
import { EnriquecimentoService } from "./enriquecimento.service";
import { RntrcService } from "./rntrc.service";
import { LeadChatwootService } from "./lead-chatwoot.service";

@Module({
  imports: [PrismaModule, ChatwootClientModule],
  controllers: [ProspeccaoController],
  providers: [ProspeccaoService, RntrcService, EnriquecimentoService, LeadChatwootService],
  exports: [ProspeccaoService, RntrcService, EnriquecimentoService, LeadChatwootService],
})
export class ProspeccaoModule {}
