-- O certificado A1 da transportadora.
--
-- Guardado CIFRADO, com chave que não mora no banco (env CERTIFICADO_CHAVE).
-- O motivo é concreto: backup de banco viaja, e sem cifrar um dump do Postgres
-- carregaria o poder de assinar documento fiscal em nome de cada cliente. Com a
-- chave fora, o dump sozinho não serve pra nada.
--
-- AES-256-GCM porque autentica além de cifrar: byte trocado vira erro na
-- abertura, não uma chave privada silenciosamente corrompida.
CREATE TABLE "certificados_digitais" (
  "contaId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  -- O .pfx inteiro, cifrado. iv | tag | corpo num blob só, pra não haver três
  -- colunas que podem sair de sincronia.
  "arquivo" BYTEA NOT NULL,
  -- A senha do .pfx, cifrada com a mesma chave.
  "senha" BYTEA NOT NULL,
  -- Metadados extraídos do PRÓPRIO certificado, nunca digitados: é o que
  -- impede emitir em nome de uma empresa com o certificado de outra.
  "cnpj" TEXT,
  "titular" TEXT NOT NULL,
  "validoDe" TIMESTAMP(3) NOT NULL,
  "validoAte" TIMESTAMP(3) NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoPorId" TEXT,
  CONSTRAINT "certificados_digitais_pkey" PRIMARY KEY ("id")
);

-- Um certificado por conta: substituir é trocar, não acumular. Histórico de
-- certificado vencido não serve pra nada e só multiplica a chance de assinar
-- com o errado.
CREATE UNIQUE INDEX "certificados_digitais_contaId_key" ON "certificados_digitais"("contaId");

ALTER TABLE "certificados_digitais"
  ADD CONSTRAINT "certificados_digitais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "certificados_digitais_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O emissor "SEFAZ" entra ao lado de SIMULADOR e GATEWAY. A UF do autorizador
-- é separada da UF do endereço: a empresa pode ter sede num estado e emitir
-- por outro (transportadora com filial), e hoje só o PR está implementado.
ALTER TABLE "contas" ADD COLUMN "cteUfAutorizador" TEXT;
