import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ErrorsModule } from "../errors/errors.module";
import { TabelasPrecoModule } from "../admin/tabelas-preco/tabelas-preco.module";
import { PedidosModule } from "../admin/pedidos/pedidos.module";
import { ConferenciaTicketModule } from "../conferencia-ticket/conferencia-ticket.module";
import { RoteamentoModule } from "../roteamento/roteamento.module";
import { IntegracaoGuard } from "./integracao.guard";
import { ErroPublicoFilter } from "./erro-publico.filter";
import { ContratoInterceptor } from "./rota-v1";
import { ViagensPublicaService } from "./viagens-publica.service";
import { CadastrosPublicaService } from "./cadastros-publica.service";
import { CadastrosV1Controller, EuV1Controller, ViagensV1Controller } from "./v1.controllers";
import { DocumentacaoV1Controller } from "./documentacao.controller";
import { PublicaBootCheck } from "./publica.boot-check";
import { AvisosService } from "./avisos/avisos.service";
import { AdminInboxModule } from "../admin/inbox/inbox.module";

/**
 * A API pública (`/v1`): o sistema de outra empresa entrando por chave.
 * Desenho e decisões: docs/api-publica/04-proposta.md.
 */
@Module({
  imports: [DiscoveryModule, ErrorsModule, AdminInboxModule, TabelasPrecoModule, PedidosModule, ConferenciaTicketModule, RoteamentoModule],
  controllers: [DocumentacaoV1Controller, EuV1Controller, ViagensV1Controller, CadastrosV1Controller],
  providers: [IntegracaoGuard, ErroPublicoFilter, ContratoInterceptor, ViagensPublicaService, CadastrosPublicaService, PublicaBootCheck, AvisosService],
})
export class PublicaModule {}
