-- Documento de motorista passa a ser identificado pela EXIGÊNCIA, não pela gaveta.
--
-- Até aqui o único era (motoristaId, tipo). Como `DocumentoExigido` é catálogo
-- livre e `tipo` é uma lista fechada de 12 gavetas, duas exigências na mesma
-- gaveta (RG e CTPS em REGISTRO_MOTORISTA) dividiam uma linha e um objeto no
-- MinIO: o segundo envio apagava o primeiro em silêncio.
--
-- O backfill carimba tudo que existe como `gaveta:<TIPO>`, que é exatamente o
-- que essas linhas sempre foram — nenhuma delas nasceu de uma exigência.

CREATE TYPE "OrigemDocumento" AS ENUM ('PAINEL', 'LINK', 'APP');

ALTER TABLE "motorista_documento"
  ADD COLUMN "exigenciaId" TEXT,
  ADD COLUMN "chave" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "hashArquivo" TEXT,
  ADD COLUMN "origem" "OrigemDocumento" NOT NULL DEFAULT 'PAINEL';

UPDATE "motorista_documento" SET "chave" = 'gaveta:' || "tipo"::text WHERE "chave" = '';

ALTER TABLE "assinaturas_documento"
  ADD COLUMN "chave" TEXT NOT NULL DEFAULT '';

UPDATE "assinaturas_documento" SET "chave" = 'gaveta:' || "tipoDocumento" WHERE "chave" = '';

DROP INDEX "motorista_documento_motoristaId_tipo_key";
CREATE UNIQUE INDEX "motorista_documento_motoristaId_chave_key"
  ON "motorista_documento"("motoristaId", "chave");
CREATE INDEX "motorista_documento_motoristaId_tipo_idx"
  ON "motorista_documento"("motoristaId", "tipo");
CREATE INDEX "motorista_documento_exigenciaId_idx"
  ON "motorista_documento"("exigenciaId");

ALTER TABLE "motorista_documento"
  ADD CONSTRAINT "motorista_documento_exigenciaId_fkey"
  FOREIGN KEY ("exigenciaId") REFERENCES "documentos_exigidos"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "assinaturas_documento_motoristaId_tipoDocumento_key";
CREATE UNIQUE INDEX "assinaturas_documento_motoristaId_chave_key"
  ON "assinaturas_documento"("motoristaId", "chave");
CREATE INDEX "assinaturas_documento_motoristaId_tipoDocumento_idx"
  ON "assinaturas_documento"("motoristaId", "tipoDocumento");
