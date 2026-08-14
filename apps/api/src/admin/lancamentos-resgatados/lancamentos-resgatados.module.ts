import { Module } from "@nestjs/common";
import { LancamentosResgatadosAdminController } from "./lancamentos-resgatados.controller";

/**
 * Só o controller: o serviço vem do módulo global de resgate, que é o mesmo que
 * o app do motorista alimenta. Uma fonte, dois lados da mesma história.
 */
@Module({ controllers: [LancamentosResgatadosAdminController] })
export class LancamentosResgatadosAdminModule {}
