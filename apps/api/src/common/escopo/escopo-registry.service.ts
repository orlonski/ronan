import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { PERMISSAO_KEY } from "../../auth/decorators/requer-permissao.decorator";
import { ESCOPO_KEY, IGNORA_ESCOPO_KEY } from "./escopo.decorator";

/**
 * Quais permissões continuam valendo pra um usuário restrito a transportadora.
 *
 * DERIVADO DO PRÓPRIO CÓDIGO, não de uma lista mantida à mão: no boot, varre os
 * controllers e cruza os dois decorators que já estão lá — se um handler tem
 * `@EscopoPor`/`@IgnoraEscopo` (sabe se comportar com escopo) E tem
 * `@RequerPermissao("x.y")`, então a chave `x.y` funciona pra quem é restrito.
 *
 * Existe porque o painel gateia tela e menu por permissão, enquanto o backend
 * bloqueia por escopo. Sem cruzar as duas coisas, o gestor via no menu telas
 * que respondiam 403 — e cada endpoint novo que eu escopasse exigiria lembrar
 * de atualizar uma lista no front. Aqui, escopar um handler já o torna visível;
 * não escopar já o esconde.
 */
@Injectable()
export class EscopoRegistryService implements OnModuleInit {
  private readonly log = new Logger(EscopoRegistryService.name);
  private readonly chaves = new Set<string>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance;
      if (!instance || !wrapper.metatype) continue;
      const proto = Object.getPrototypeOf(instance);

      const escopoNaClasse =
        this.reflector.get(ESCOPO_KEY, wrapper.metatype) ??
        this.reflector.get(IGNORA_ESCOPO_KEY, wrapper.metatype);

      for (const metodo of this.scanner.getAllMethodNames(proto)) {
        const handler = proto[metodo];
        if (typeof handler !== "function") continue;

        const escopoNoMetodo =
          this.reflector.get(ESCOPO_KEY, handler) ??
          this.reflector.get(IGNORA_ESCOPO_KEY, handler);
        if (!escopoNoMetodo && !escopoNaClasse) continue;

        // A permissão do handler vence a da classe (getAllAndOverride), igual ao
        // que o PermissaoGuard faz na hora de decidir.
        const exigidas =
          this.reflector.get<string[] | undefined>(PERMISSAO_KEY, handler) ??
          this.reflector.get<string[] | undefined>(PERMISSAO_KEY, wrapper.metatype);
        for (const chave of exigidas ?? []) this.chaves.add(chave);
      }
    }
    this.log.log(
      `Acesso restrito: ${this.chaves.size} permissão(ões) com endpoint preparado pra escopo.`,
    );
  }

  /**
   * Filtra as permissões do usuário pelas que têm endpoint escopo-aware.
   * Usuário com acesso global recebe a lista inteira, sem tocar em nada.
   */
  filtrarParaRestrito(permissoes: string[], acessoGlobal: boolean): string[] {
    if (acessoGlobal) return permissoes;
    return permissoes.filter((p) => this.chaves.has(p));
  }

  /** Só pra diagnóstico/teste. */
  listar(): string[] {
    return [...this.chaves].sort();
  }
}
