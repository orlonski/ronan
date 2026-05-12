-- CreateTable: vínculo N:N entre motorista e veículo
-- Substitui a relação 1:N implícita (Motorista.veiculoDefaultId era a única forma
-- de "atrelar" placa a motorista). Agora um motorista pode dirigir várias placas
-- e a mesma placa pode ser dirigida por vários motoristas (revezamento da empresa).
-- O campo Motorista.veiculoDefaultId continua existindo como "atalho pra UI/app"
-- (pré-seleciona em nova viagem).
CREATE TABLE "motorista_veiculo" (
    "motoristaId" TEXT         NOT NULL,
    "veiculoId"   TEXT         NOT NULL,
    "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "motorista_veiculo_pkey" PRIMARY KEY ("motoristaId", "veiculoId")
);

CREATE INDEX "motorista_veiculo_veiculoId_idx" ON "motorista_veiculo"("veiculoId");

ALTER TABLE "motorista_veiculo"
  ADD CONSTRAINT "motorista_veiculo_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "motorista_veiculo"
  ADD CONSTRAINT "motorista_veiculo_veiculoId_fkey"
  FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1: motorista que tinha veiculoDefaultId vira vínculo
INSERT INTO "motorista_veiculo" ("motoristaId", "veiculoId")
SELECT "id", "veiculoDefaultId"
FROM "motoristas"
WHERE "veiculoDefaultId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill 2: histórico de uso real — qualquer par (motorista, veículo) que já
-- apareceu em viagem, pedágio ou abastecimento. Garante que motoristas que dirigiram
-- uma placa no passado continuem com acesso a ela na UI.
INSERT INTO "motorista_veiculo" ("motoristaId", "veiculoId")
SELECT DISTINCT "motoristaId", "veiculoId" FROM "viagens"
ON CONFLICT DO NOTHING;

INSERT INTO "motorista_veiculo" ("motoristaId", "veiculoId")
SELECT DISTINCT "motoristaId", "veiculoId" FROM "pedagios"
ON CONFLICT DO NOTHING;

INSERT INTO "motorista_veiculo" ("motoristaId", "veiculoId")
SELECT DISTINCT "motoristaId", "veiculoId" FROM "abastecimentos"
ON CONFLICT DO NOTHING;
