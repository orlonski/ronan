import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { APP_GUARD } from "@nestjs/core";
import { ModuloGuard } from "./modulo.guard";
import { ModulosBootCheck } from "./modulos.boot-check";
import { ModulosService } from "./modulos.service";
import { ModulosController } from "./modulos.controller";
import { PermissoesModule } from "../../admin/permissoes/permissoes.module";

/**
 * Contrato: o que a empresa comprou.
 *
 * `@Global` porque o guard é global — e o boot-check precisa rodar uma vez só,
 * com acesso à árvore de controllers inteira.
 */
@Global()
@Module({
  imports: [DiscoveryModule, PermissoesModule],
  controllers: [ModulosController],
  providers: [
    ModulosService,
    ModulosBootCheck,
    // Depois do PermissaoGuard (registrado antes, no AuthModule): primeiro se
    // pergunta se a PESSOA pode, depois se a EMPRESA comprou.
    { provide: APP_GUARD, useClass: ModuloGuard },
  ],
  exports: [ModulosService],
})
export class ModulosModule {}
