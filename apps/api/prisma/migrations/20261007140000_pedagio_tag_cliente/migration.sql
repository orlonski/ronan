-- CreateEnum
CREATE TYPE "PedagioTagRepasse" AS ENUM ('IDA', 'VOLTA', 'IDA_E_VOLTA');

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "pedagioTagRepasse" "PedagioTagRepasse" NOT NULL DEFAULT 'IDA';

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN     "pedagioPelaTag" DECIMAL(10,2);

