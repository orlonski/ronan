-- "Dá pra continuar rodando?" e onde o caminhão parou, no aviso do motorista.
DO $$ BEGIN
  CREATE TYPE "PodeRodarProblema" AS ENUM ('SIM', 'COM_CUIDADO', 'NAO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "problemas_veiculo" ADD COLUMN IF NOT EXISTS "podeRodar" "PodeRodarProblema";
ALTER TABLE "problemas_veiculo" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "problemas_veiculo" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
