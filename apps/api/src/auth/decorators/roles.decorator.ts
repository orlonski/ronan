import { SetMetadata } from "@nestjs/common";

// Distingue só o TIPO de usuário (kind). A granularidade de admin vem das
// permissões do papel (@RequerPermissao), não mais de ADMIN/OPERADOR.
export type RoleName = "ADMIN_USER" | "MOTORISTA";
export const ROLES_KEY = "roles";
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
