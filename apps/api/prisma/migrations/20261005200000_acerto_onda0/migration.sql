-- Onda 0 do acerto do motorista (docs/despesas-viagem/proposta.md).
--
-- 1) Trava contra pagar o mesmo lançamento em dois acertos FECHADO/PAGO.
--    `chaveFechada` só é preenchida no fechamento (e limpa ao reabrir), então
--    acerto ABERTO nunca bate no unique — a geração não ganha 500 por isso.
-- 2) `puxadoDe`: o aviso "este item saiu do acerto de DD/MM a DD/MM".
-- 3) Decisão humana sobre possível pedágio em dobro.

ALTER TABLE "itens_acerto" ADD COLUMN "puxadoDe" TEXT;
ALTER TABLE "itens_acerto" ADD COLUMN "chaveFechada" TEXT;

CREATE UNIQUE INDEX "itens_acerto_contaId_chaveFechada_key" ON "itens_acerto"("contaId", "chaveFechada");
CREATE INDEX "itens_acerto_pedagioId_idx" ON "itens_acerto"("pedagioId");
CREATE INDEX "itens_acerto_abastecimentoId_idx" ON "itens_acerto"("abastecimentoId");

-- Carimba a chave dos itens de acertos já FECHADO/PAGO. A mesma regra de
-- `chaveDoItem` (common/acerto-selecao.ts). Se por acaso já houver repetido,
-- só o primeiro ganha a chave: a migration nunca pode travar a fila (P3009) —
-- o repetido aparece no aviso do lucro e se resolve com o dono.
WITH chaves AS (
  SELECT i."id",
         i."contaId",
         CASE
           WHEN i."tipo" = 'FRETE' AND i."viagemId" IS NOT NULL THEN 'FRETE:' || i."viagemId"
           WHEN i."tipo" = 'REEMBOLSO_PEDAGIO' AND i."viagemId" IS NOT NULL THEN 'PEDAGIO_VIAGEM:' || i."viagemId"
           WHEN i."tipo" = 'REEMBOLSO_PEDAGIO' AND i."pedagioId" IS NOT NULL THEN 'PEDAGIO:' || i."pedagioId"
           WHEN i."tipo" = 'REEMBOLSO_ABASTECIMENTO' AND i."abastecimentoId" IS NOT NULL THEN 'ABASTECIMENTO:' || i."abastecimentoId"
           ELSE NULL
         END AS chave,
         i."criadoEm"
  FROM "itens_acerto" i
  JOIN "acertos_motorista" a ON a."id" = i."acertoId"
  WHERE a."status" IN ('FECHADO', 'PAGO')
),
primeiros AS (
  SELECT "id", chave,
         ROW_NUMBER() OVER (PARTITION BY "contaId", chave ORDER BY "criadoEm", "id") AS rn
  FROM chaves
  WHERE chave IS NOT NULL
)
UPDATE "itens_acerto" i
SET "chaveFechada" = p.chave
FROM primeiros p
WHERE p."id" = i."id" AND p.rn = 1;

-- CreateEnum
CREATE TYPE "DecisaoPedagioDobroTipo" AS ENUM ('MESMO_PEDAGIO', 'PEDAGIOS_DIFERENTES');

-- CreateTable
CREATE TABLE "decisoes_pedagio_dobro" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "pedagioId" TEXT NOT NULL,
    "viagemId" TEXT,
    "acertoId" TEXT,
    "decisao" "DecisaoPedagioDobroTipo" NOT NULL,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisoes_pedagio_dobro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decisoes_pedagio_dobro_contaId_pedagioId_key" ON "decisoes_pedagio_dobro"("contaId", "pedagioId");
CREATE INDEX "decisoes_pedagio_dobro_contaId_idx" ON "decisoes_pedagio_dobro"("contaId");

ALTER TABLE "decisoes_pedagio_dobro" ADD CONSTRAINT "decisoes_pedagio_dobro_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decisoes_pedagio_dobro" ADD CONSTRAINT "decisoes_pedagio_dobro_pedagioId_fkey" FOREIGN KEY ("pedagioId") REFERENCES "pedagios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decisoes_pedagio_dobro" ADD CONSTRAINT "decisoes_pedagio_dobro_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
