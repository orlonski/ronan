-- AlterTable
ALTER TABLE "materiais" ADD COLUMN     "permiteBotaFora" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN     "teveBotaFora" BOOLEAN,
ADD COLUMN     "kmBotaFora" DECIMAL(10,2);
