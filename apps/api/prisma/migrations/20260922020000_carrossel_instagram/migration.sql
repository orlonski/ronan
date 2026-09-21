-- Carrossel no Instagram: a arte do post deixa de ser uma coluna e vira lista.
--
-- Os posts que já estão na fila NÃO podem perder a arte: o publicador está
-- desligado, mas o agente vem entregando post desde 11/09 e essas linhas
-- existem. Por isso a ordem é criar, copiar, conferir e só então derrubar as
-- colunas antigas — nunca DROP antes do INSERT.

CREATE TABLE "artes_post_instagram" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "containerId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artes_post_instagram_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artes_post_instagram_token_key" ON "artes_post_instagram"("token");
CREATE UNIQUE INDEX "artes_post_instagram_postId_ordem_key" ON "artes_post_instagram"("postId", "ordem");

ALTER TABLE "artes_post_instagram"
    ADD CONSTRAINT "artes_post_instagram_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts_instagram"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Cada post que existe hoje vira um post de um slide só. O token público é
-- reaproveitado tal e qual: se a Meta já estiver com a URL antiga em mão, ela
-- continua respondendo a mesma imagem.
INSERT INTO "artes_post_instagram" ("id", "postId", "ordem", "storageKey", "token", "containerId", "criadoEm")
SELECT gen_random_uuid()::text, "id", 0, "storageKey", "arteToken", NULL, "criadoEm"
  FROM "posts_instagram";

-- Rede de segurança: se sobrou post sem arte, a migration para aqui em vez de
-- apagar a coluna e levar a arte junto.
DO $$
DECLARE orfaos INTEGER;
BEGIN
    SELECT COUNT(*) INTO orfaos
      FROM "posts_instagram" p
     WHERE NOT EXISTS (SELECT 1 FROM "artes_post_instagram" a WHERE a."postId" = p."id");
    IF orfaos > 0 THEN
        RAISE EXCEPTION 'Abortando: % post(s) ficariam sem arte apos o DROP.', orfaos;
    END IF;
END $$;

DROP INDEX IF EXISTS "posts_instagram_arteToken_key";
ALTER TABLE "posts_instagram" DROP COLUMN "storageKey";
ALTER TABLE "posts_instagram" DROP COLUMN "arteToken";
