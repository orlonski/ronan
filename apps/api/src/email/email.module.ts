import { Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { TicketClienteController } from "./ticket-cliente/ticket-cliente.controller";
import { TicketClienteService } from "./ticket-cliente/ticket-cliente.service";

/**
 * E-mail do sistema. `EmailService` é a porta única de envio (SMTP genérico,
 * registro em `EmailEnviado`); o ticket ao cliente é o primeiro uso.
 *
 * Exporta o serviço pra quem vier depois (extrato do acerto, fatura) não
 * reinventar transporte nem registro — mesmo papel do `EnvioWhatsappService`.
 */
@Module({
  controllers: [TicketClienteController],
  providers: [EmailService, TicketClienteService],
  exports: [EmailService],
})
export class EmailModule {}
