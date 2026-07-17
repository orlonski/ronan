-- Referência de km por trajeto + detecção de km atípico.
--
-- O backend passa a comparar o km de cada viagem com o que a frota já rodou no
-- mesmo par carga→descarga (mediana) ou, sem amostra, com a rota calculada, e
-- carimba o resultado na própria viagem. Ver ConfiguracaoKmAtipico pras réguas.
--
-- ESCRITA À MÃO de propósito: o schema declara índices que migrations antigas
-- nunca criaram (viagens.localCargaId/localDescargaId/status, empresas.ativa,
-- motoristas.ativo, viagem_pontos.capturadoEm) e o banco de dev tem drift de
-- `db push` (FKs de viagens, configuracao_forca_atualizacao.motoristasAlvo).
-- Um `migrate dev` arrastaria tudo isso pra cá. Esta migration contém APENAS a
-- feature; o drift fica pra uma limpeza própria.

-- CreateEnum
CREATE TYPE "KmFonte" AS ENUM ('ROTA_OSRM', 'ROTA_ESCOLHIDA', 'HISTORICO', 'MANUAL');

-- CreateEnum
CREATE TYPE "FonteReferenciaKm" AS ENUM ('HISTORICO', 'ROTA_OSRM');

-- AlterTable: procedência do km + carimbo da avaliação
ALTER TABLE "viagens" ADD COLUMN     "kmFonte" "KmFonte",
ADD COLUMN     "kmForaDoPadrao" BOOLEAN,
ADD COLUMN     "kmReferencia" DECIMAL(10,2),
ADD COLUMN     "kmReferenciaFonte" "FonteReferenciaKm",
ADD COLUMN     "kmReferenciaAmostra" INTEGER,
ADD COLUMN     "kmDesvioPct" DECIMAL(6,2),
ADD COLUMN     "kmAvaliadoEm" TIMESTAMP(3),
ADD COLUMN     "justificativaKm" TEXT;

-- AlterTable: flag de rollout da UX no app (o carimbo do backend ignora a flag)
ALTER TABLE "motoristas" ADD COLUMN     "podeReferenciaKm" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "configuracao_km_atipico" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "desvioPct" INTEGER NOT NULL DEFAULT 30,
    "desvioPctOsrm" INTEGER NOT NULL DEFAULT 50,
    "amostraMinima" INTEGER NOT NULL DEFAULT 5,
    "janelaDias" INTEGER NOT NULL DEFAULT 365,
    "kmMinimoAvaliado" DECIMAL(10,2) NOT NULL DEFAULT 3,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_km_atipico_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "configuracao_km_atipico" ADD CONSTRAINT "configuracao_km_atipico_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: busca da amostra por par de locais (referência de km).
-- Serve também o filtro só por localCargaId, que é prefixo dele.
CREATE INDEX "viagens_localCargaId_localDescargaId_data_idx" ON "viagens"("localCargaId", "localDescargaId", "data");

-- DropIndex: redundante com o composto acima (prefixo). IF EXISTS porque este
-- índice nunca foi criado por migration nenhuma — existe só em bancos de dev
-- que passaram por `db push`. Em produção é no-op.
DROP INDEX IF EXISTS "viagens_localCargaId_idx";
