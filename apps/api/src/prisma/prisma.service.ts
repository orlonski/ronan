import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { travaConta } from "../common/conta/trava-conta";

/**
 * Cliente do Prisma com a trava de isolamento entre empresas já embutida.
 *
 * O `$extends` devolve um client NOVO em vez de alterar este — e devolvê-lo do
 * construtor faz o Nest injetar o estendido em todo mundo, sem precisar tocar
 * em nenhum dos ~810 pontos que injetam `PrismaService`. Os hooks de ciclo de
 * vida do Nest são redefinidos dentro da extension pelo mesmo motivo: o objeto
 * devolvido não é mais esta instância, então os métodos da classe não viriam
 * junto.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    return this
      .$extends({
        client: {
          async onModuleInit(this: PrismaClient) {
            await this.$connect();
          },
          async onModuleDestroy(this: PrismaClient) {
            await this.$disconnect();
          },
        },
      })
      .$extends(travaConta) as unknown as PrismaService;
  }

  // Redeclarados só pro TypeScript enxergar os hooks; a implementação real é a
  // da extension acima.
  async onModuleInit(): Promise<void> {}
  async onModuleDestroy(): Promise<void> {}
}
