-- O km do motorista é lei: guarda o valor dele num campo próprio e registra
-- quem/quando/por que o painel alterou o km faturado.

-- Nova ação de auditoria: alteração de km pelo painel tem nome próprio no
-- histórico (não pode se esconder num UPDATE genérico).
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'ADMIN_ALTEROU_KM';

ALTER TABLE "viagens"
  ADD COLUMN "kmMotorista" DECIMAL(10,2),
  ADD COLUMN "kmAlteradoEm" TIMESTAMP(3),
  ADD COLUMN "kmAlteradoPorId" TEXT,
  ADD COLUMN "kmAlteracaoMotivo" TEXT;

ALTER TABLE "viagens"
  ADD CONSTRAINT "viagens_kmAlteradoPorId_fkey"
  FOREIGN KEY ("kmAlteradoPorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill 1: viagens que o painel JÁ alterou. O valor do motorista é o
-- `valorAntes` da PRIMEIRA mão do painel no campo km — depois dela, `km` já não
-- é mais o número dele. valorAntes é jsonb (string ou number conforme o
-- caminho que gravou), daí o `#>> '{}'` + filtro de numérico.
WITH primeira_alteracao AS (
  SELECT DISTINCT ON ("entidadeId")
    "entidadeId" AS viagem_id,
    ("valorAntes" #>> '{}')::numeric AS km_antes
  FROM "audit_logs"
  WHERE "entidade" = 'Viagem'
    AND "campo" = 'km'
    AND "acao" IN ('UPDATE', 'RECALCULAR_TRAJETO')
    AND "valorAntes" IS NOT NULL
    AND ("valorAntes" #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
  ORDER BY "entidadeId", "criadoEm" ASC
)
UPDATE "viagens" v
SET "kmMotorista" = p.km_antes
FROM primeira_alteracao p
WHERE v.id = p.viagem_id;

-- Backfill 2: o resto — ninguém mexeu, então o km atual É o do motorista.
-- (Toda viagem nasce no app: não existe endpoint de criar viagem no painel.)
UPDATE "viagens"
SET "kmMotorista" = "km"
WHERE "kmMotorista" IS NULL
  AND "km" IS NOT NULL;
