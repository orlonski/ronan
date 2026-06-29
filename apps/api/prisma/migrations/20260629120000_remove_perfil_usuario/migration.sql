-- DropColumn + DropEnum: perfil substituído por papel + permissões (RBAC).
ALTER TABLE "users" DROP COLUMN "perfil";
DROP TYPE "PerfilUsuario";
