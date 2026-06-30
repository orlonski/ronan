-- AlterTable: trava de envio único do aviso de cadastro no grupo.
ALTER TABLE "motoristas" ADD COLUMN "avisoGrupoEnviadoEm" TIMESTAMP(3);

-- CreateTable: config singleton do aviso automático no grupo de WhatsApp.
CREATE TABLE "configuracao_aviso_grupo" (
    "id"            TEXT         NOT NULL DEFAULT 'default',
    "ativo"         BOOLEAN      NOT NULL DEFAULT false,
    "grupoJid"      TEXT,
    "grupoNome"     TEXT,
    "template"      TEXT,
    "alteradoEm"    TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,
    CONSTRAINT "configuracao_aviso_grupo_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "configuracao_aviso_grupo"
  ADD CONSTRAINT "configuracao_aviso_grupo_alteradoPorId_fkey"
  FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
