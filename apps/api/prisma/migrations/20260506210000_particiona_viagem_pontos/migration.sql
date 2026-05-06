-- Particionamento de viagem_pontos por mês. PostgreSQL nativo, PARTITION BY RANGE.
-- Mantém TODOS os dados (zero expurgo). Particionamento só acelera queries
-- por período e simplifica backups por arquivo.
--
-- Pré-cria particões mensais 2026-2030 (60 particões). Quando se aproximar
-- de 2030, criar mais via nova migration.

-- 1. Renomeia tabela atual (vai como dados)
ALTER TABLE "viagem_pontos" RENAME TO "viagem_pontos_old";

-- 2. Cria tabela nova particionada
CREATE TABLE "viagem_pontos" (
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL,
    "velocidade" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,
    PRIMARY KEY ("id", "capturadoEm")
) PARTITION BY RANGE ("capturadoEm");

-- 3. Cria partições mensais 2026-2030
CREATE TABLE "viagem_pontos_2026_01" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE "viagem_pontos_2026_02" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE "viagem_pontos_2026_03" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE "viagem_pontos_2026_04" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE "viagem_pontos_2026_05" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE "viagem_pontos_2026_06" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE "viagem_pontos_2026_07" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "viagem_pontos_2026_08" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "viagem_pontos_2026_09" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "viagem_pontos_2026_10" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "viagem_pontos_2026_11" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "viagem_pontos_2026_12" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "viagem_pontos_2027_01" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "viagem_pontos_2027_02" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "viagem_pontos_2027_03" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "viagem_pontos_2027_04" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "viagem_pontos_2027_05" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "viagem_pontos_2027_06" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "viagem_pontos_2027_07" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE "viagem_pontos_2027_08" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE "viagem_pontos_2027_09" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE "viagem_pontos_2027_10" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE "viagem_pontos_2027_11" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE "viagem_pontos_2027_12" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE "viagem_pontos_2028_01" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-01-01') TO ('2028-02-01');
CREATE TABLE "viagem_pontos_2028_02" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-02-01') TO ('2028-03-01');
CREATE TABLE "viagem_pontos_2028_03" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-03-01') TO ('2028-04-01');
CREATE TABLE "viagem_pontos_2028_04" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-04-01') TO ('2028-05-01');
CREATE TABLE "viagem_pontos_2028_05" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-05-01') TO ('2028-06-01');
CREATE TABLE "viagem_pontos_2028_06" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-06-01') TO ('2028-07-01');
CREATE TABLE "viagem_pontos_2028_07" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-07-01') TO ('2028-08-01');
CREATE TABLE "viagem_pontos_2028_08" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-08-01') TO ('2028-09-01');
CREATE TABLE "viagem_pontos_2028_09" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-09-01') TO ('2028-10-01');
CREATE TABLE "viagem_pontos_2028_10" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-10-01') TO ('2028-11-01');
CREATE TABLE "viagem_pontos_2028_11" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-11-01') TO ('2028-12-01');
CREATE TABLE "viagem_pontos_2028_12" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2028-12-01') TO ('2029-01-01');
CREATE TABLE "viagem_pontos_2029_01" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-01-01') TO ('2029-02-01');
CREATE TABLE "viagem_pontos_2029_02" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-02-01') TO ('2029-03-01');
CREATE TABLE "viagem_pontos_2029_03" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-03-01') TO ('2029-04-01');
CREATE TABLE "viagem_pontos_2029_04" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-04-01') TO ('2029-05-01');
CREATE TABLE "viagem_pontos_2029_05" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-05-01') TO ('2029-06-01');
CREATE TABLE "viagem_pontos_2029_06" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-06-01') TO ('2029-07-01');
CREATE TABLE "viagem_pontos_2029_07" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-07-01') TO ('2029-08-01');
CREATE TABLE "viagem_pontos_2029_08" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-08-01') TO ('2029-09-01');
CREATE TABLE "viagem_pontos_2029_09" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-09-01') TO ('2029-10-01');
CREATE TABLE "viagem_pontos_2029_10" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-10-01') TO ('2029-11-01');
CREATE TABLE "viagem_pontos_2029_11" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-11-01') TO ('2029-12-01');
CREATE TABLE "viagem_pontos_2029_12" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2029-12-01') TO ('2030-01-01');
CREATE TABLE "viagem_pontos_2030_01" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-01-01') TO ('2030-02-01');
CREATE TABLE "viagem_pontos_2030_02" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-02-01') TO ('2030-03-01');
CREATE TABLE "viagem_pontos_2030_03" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-03-01') TO ('2030-04-01');
CREATE TABLE "viagem_pontos_2030_04" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-04-01') TO ('2030-05-01');
CREATE TABLE "viagem_pontos_2030_05" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-05-01') TO ('2030-06-01');
CREATE TABLE "viagem_pontos_2030_06" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-06-01') TO ('2030-07-01');
CREATE TABLE "viagem_pontos_2030_07" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-07-01') TO ('2030-08-01');
CREATE TABLE "viagem_pontos_2030_08" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-08-01') TO ('2030-09-01');
CREATE TABLE "viagem_pontos_2030_09" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-09-01') TO ('2030-10-01');
CREATE TABLE "viagem_pontos_2030_10" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-10-01') TO ('2030-11-01');
CREATE TABLE "viagem_pontos_2030_11" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-11-01') TO ('2030-12-01');
CREATE TABLE "viagem_pontos_2030_12" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2030-12-01') TO ('2031-01-01');

-- 4. Partição catch-all pra dados antes de 2026 (caso houver histórico)
CREATE TABLE "viagem_pontos_pre2026" PARTITION OF "viagem_pontos"
    FOR VALUES FROM ('2000-01-01') TO ('2026-01-01');

-- 5. Move dados existentes
INSERT INTO "viagem_pontos" ("id", "viagemId", "lat", "lng", "capturadoEm", "velocidade", "precisao")
    SELECT "id", "viagemId", "lat", "lng", "capturadoEm", "velocidade", "precisao" FROM "viagem_pontos_old";

-- 6. Cria indexes na tabela particionada (Postgres propaga pras partições)
CREATE INDEX "viagem_pontos_viagemId_capturadoEm_idx" ON "viagem_pontos" ("viagemId", "capturadoEm");
CREATE INDEX "viagem_pontos_capturadoEm_idx" ON "viagem_pontos" ("capturadoEm");

-- 7. FK pra viagens
ALTER TABLE "viagem_pontos" ADD CONSTRAINT "viagem_pontos_viagemId_fkey"
    FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Drop tabela antiga
DROP TABLE "viagem_pontos_old";

-- ===== Indexes novos em outros models pra suportar carga de 100+ motoristas =====

-- Viagem: filtros admin comuns
CREATE INDEX "viagens_status_idx" ON "viagens"("status");
CREATE INDEX "viagens_localCargaId_idx" ON "viagens"("localCargaId");
CREATE INDEX "viagens_localDescargaId_idx" ON "viagens"("localDescargaId");

-- Motorista: filtro por ativo (listagem admin)
CREATE INDEX "motoristas_ativo_idx" ON "motoristas"("ativo");

-- EmpresaCliente: filtro por ativa
CREATE INDEX "empresas_cliente_ativa_idx" ON "empresas_cliente"("ativa");
