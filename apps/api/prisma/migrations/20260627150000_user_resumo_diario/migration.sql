-- AlterTable
ALTER TABLE "users" ADD COLUMN "whatsappResumo" TEXT;
ALTER TABLE "users" ADD COLUMN "receberResumoDiario" BOOLEAN NOT NULL DEFAULT false;
