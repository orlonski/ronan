-- Cadastro pelo app deixa de pertencer a uma empresa.
--
-- Sem o código da empresa, o formulário não diz mais de quem o motorista é —
-- então o cadastro pendente não tem conta pra carimbar. A chave passa a ser o
-- CPF, igual à identidade que ele vai virar. Ver docs/identidade-motorista.md.

-- Pendente vive 10 minutos; quem estiver no meio do cadastro nesse instante
-- recomeça, e é mais honesto que tentar adivinhar a conta de cada um.
DELETE FROM "cadastros_motorista_pendentes";

ALTER TABLE "cadastros_motorista_pendentes"
    DROP CONSTRAINT "cadastros_motorista_pendentes_contaId_fkey";
DROP INDEX "cadastros_motorista_pendentes_contaId_cpf_key";
DROP INDEX "cadastros_motorista_pendentes_contaId_idx";
ALTER TABLE "cadastros_motorista_pendentes"
    DROP COLUMN "contaId",
    ADD COLUMN  "telefoneDestino" TEXT;
CREATE UNIQUE INDEX "cadastros_motorista_pendentes_cpf_key"
    ON "cadastros_motorista_pendentes"("cpf");

-- As placas que a pessoa informou antes de ter empresa. Viram Veiculo quando
-- ela entra numa (Veiculo é da conta, e no cadastro ainda não há conta).
ALTER TABLE "motorista_identidades" ADD COLUMN "placas" JSONB;
