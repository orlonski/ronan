-- Feature flags por motorista. Default true = não quebra fluxo existente;
-- admin desativa pelo dashboard (PATCH /admin/motoristas/:id/acessos).

ALTER TABLE "motoristas" ADD COLUMN "podeLancarViagem" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "motoristas" ADD COLUMN "podeIniciarViagem" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "motoristas" ADD COLUMN "podeLancarPedagio" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "motoristas" ADD COLUMN "podeLancarAbastecimento" BOOLEAN NOT NULL DEFAULT true;
