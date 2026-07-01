-- AlterTable: material pode dispensar ticket (ex: concreto, sem ticket de pesagem).
-- Controlado pelo admin; default true mantém o comportamento atual pros existentes.
ALTER TABLE "materiais" ADD COLUMN "exigeTicket" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: ticket da viagem passa a ser opcional (null quando o material não exige).
ALTER TABLE "viagens" ALTER COLUMN "ticket" DROP NOT NULL;
