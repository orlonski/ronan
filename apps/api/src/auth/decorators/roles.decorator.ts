import { SetMetadata } from "@nestjs/common";

// Distingue só o TIPO de usuário (kind). A granularidade de admin vem das
// permissões do papel (@RequerPermissao), não mais de ADMIN/OPERADOR.
//
// IDENTIDADE é a PESSOA (o CPF), sem empresa nenhuma: cadastro novo pelo app,
// perfil, convites e os registros pessoais dele. Não é MOTORISTA — motorista é
// o vínculo com uma transportadora, e sem vínculo não há dado de empresa pra
// ler nem lançamento pra fazer. Ver docs/identidade-motorista.md.
export type RoleName = "ADMIN_USER" | "MOTORISTA" | "IDENTIDADE";
export const ROLES_KEY = "roles";
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
