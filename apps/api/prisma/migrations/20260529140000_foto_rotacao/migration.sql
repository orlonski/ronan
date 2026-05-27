-- Rotação persistente das fotos no dashboard admin. Aplicada via CSS no
-- frontend (sem rotacionar o blob no MinIO). 0/90/180/270 graus.

ALTER TABLE "ticket_fotos"        ADD COLUMN "rotacao" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "abastecimento_fotos" ADD COLUMN "rotacao" INTEGER NOT NULL DEFAULT 0;
