import { SetMetadata } from "@nestjs/common";

export const PERMISSAO_KEY = "permissao";

/**
 * Exige uma permissão granular (chave do catálogo RBAC) além do @Roles.
 * Sem este decorator, o PermissaoGuard libera (compatível com o que já existe).
 */
export const RequerPermissao = (...chaves: string[]) => SetMetadata(PERMISSAO_KEY, chaves);
