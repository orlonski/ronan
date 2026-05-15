-- AlterTable: armazena Expo Push Token do motorista (1 device por motorista)
ALTER TABLE "motoristas" ADD COLUMN "expoPushToken" TEXT;
ALTER TABLE "motoristas" ADD COLUMN "pushTokenAtualizadoEm" TIMESTAMP(3);
