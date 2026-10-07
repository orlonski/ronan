import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  CODIGO_MODULO_NAO_CONTRATADO,
  MODULOS_POR_CHAVE,
  moduloDaChave,
  type ModuloChave,
} from "@ronan/shared-types";
import { PERMISSAO_KEY } from "../../auth/decorators/requer-permissao.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { CachePorConta } from "../conta/cache-por-conta";
import { modulosDaConta } from "../conta/teto-da-conta";
import type { AuthUser } from "../../auth/types";

/** Tipos de acesso que já existiam e não passam pela cobrança de módulo daqui. */
const TIPOS_SEM_COBRANCA_DE_MODULO = new Set<string>(["MOTORISTA", "FUNCIONARIO", "IDENTIDADE"]);

/**
 * Barra o acesso a recurso de módulo que a empresa não contratou.
 *
 * Roda DEPOIS do `PermissaoGuard` e responde uma pergunta diferente: aquele diz
 * se a PESSOA pode, este diz se a EMPRESA comprou. As duas negativas precisam
 * ser distinguíveis — "fale com o administrador" e "fale com a gente" são
 * conversas diferentes, e sem código próprio de erro as duas viram a mesma tela
 * cinza, o que mata a segunda antes de ela virar venda.
 *
 * Deriva o módulo do `@RequerPermissao` do handler, então não há decorator novo
 * pra ninguém lembrar de pôr: quem já declarou a permissão ganhou a checagem de
 * contrato de graça. O preço disso é que handler SEM permissão também não é
 * checado aqui — e é por isso que existe o boot-check, que cobra a permissão.
 */
@Injectable()
export class ModuloGuard implements CanActivate {
  /**
   * TTL curto: ligar um módulo na tela de Empresas tem que refletir em segundos,
   * não em minutos. É configuração comercial, e quem acabou de vender quer
   * mostrar funcionando.
   */
  private readonly cache = new CachePorConta<Set<ModuloChave>>("modulos-contratados", 15_000);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const exigidas = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSAO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!exigidas || exigidas.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) return true;
    // Fechado por padrão: motorista/funcionário/identidade têm as próprias
    // barreiras (RolesGuard, capacidade do app) e seguem como sempre. Um tipo de
    // acesso NOVO (a chave de integração, amanhã) que não esteja nesta lista é
    // barrado aqui, em vez de passar sem cobrança de módulo.
    if (user.kind !== "ADMIN_USER") {
      if (TIPOS_SEM_COBRANCA_DE_MODULO.has(user.kind)) return true;
      throw new ForbiddenException("Este tipo de acesso não pode usar esta rota.");
    }

    // Os módulos que as chaves exigidas tocam. `@RequerPermissao` é OR entre
    // chaves, então basta UM módulo contratado pra passar — senão um handler
    // que aceita duas chaves de módulos diferentes ficaria bloqueado por quem
    // contratou só um deles.
    const modulosExigidos = new Set<ModuloChave>();
    for (const chave of exigidas) {
      const m = moduloDaChave(chave);
      if (m) modulosExigidos.add(m);
    }
    // Chave sem módulo não existe (há teste de invariante). Se aparecer, passa:
    // derrubar acesso por catálogo incompleto seria pior que o contrário.
    if (modulosExigidos.size === 0) return true;

    const contratados = await this.cache.obter(
      (contaId) => modulosDaConta(this.prisma, contaId),
      // Padrão quando não dá pra saber (sem conta no contexto, ou a leitura dos
      // módulos falhou): NADA contratado. Era `size === 0 → libera`, e como o
      // padrão era esse mesmo conjunto vazio, um soluço do banco abria todos os
      // módulos vendidos à parte pra qualquer administrador. "Não sei" nunca
      // vira "pode": o núcleo entra sempre em `modulosDaConta`, então um
      // conjunto vazio só aparece aqui por falha, e falha nega.
      new Set<ModuloChave>(),
    );

    for (const m of modulosExigidos) {
      if (contratados.has(m)) return true;
    }

    const faltando = [...modulosExigidos][0]!;
    const def = MODULOS_POR_CHAVE[faltando];
    throw new ForbiddenException({
      code: CODIGO_MODULO_NAO_CONTRATADO,
      modulo: faltando,
      nomeModulo: def.nome,
      pitch: def.pitch,
      message: `O módulo "${def.nome}" não está contratado nesta empresa.`,
    });
  }
}
