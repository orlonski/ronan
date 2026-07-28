import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { EscopoRegistryService } from "./escopo-registry.service";

/**
 * Global porque o registry é lido no /admin/users/me (users) e serve de base pra
 * qualquer lugar que precise saber o que funciona sob acesso restrito.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [EscopoRegistryService],
  exports: [EscopoRegistryService],
})
export class EscopoModule {}
