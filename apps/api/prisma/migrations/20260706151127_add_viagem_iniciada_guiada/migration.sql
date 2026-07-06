-- AlterTable
ALTER TABLE "viagens" ADD COLUMN "iniciadaGuiada" BOOLEAN NOT NULL DEFAULT false;

-- Backfill best-effort das viagens guiadas já existentes: as em andamento + as
-- finalizadas que registraram algum EventoViagem do lifecycle. Uma guiada antiga
-- sem nenhum evento não é pega (indistinguível de uma direta), mas go-forward é
-- 100% confiável via iniciar().
UPDATE "viagens" SET "iniciadaGuiada" = true
WHERE "status" = 'EM_ANDAMENTO'
   OR "id" IN (SELECT DISTINCT "viagemId" FROM "eventos_viagem");
