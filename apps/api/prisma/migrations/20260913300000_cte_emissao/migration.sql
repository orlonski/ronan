-- Emissão de CT-e modelo 57.
--
-- A fase 0 amarrou o documento que o cliente emite em OUTRO lugar. Isto é o
-- sistema emitindo — em três níveis que são o mesmo código com um interruptor:
-- simulador local, gateway em sandbox, e SEFAZ de verdade.

-- 1) O Local ganha identidade fiscal.
--    No CT-e, de onde a carga sai e pra onde ela vai não são endereços: são
--    pessoas jurídicas. O Local sabia onde fica a pedreira e não de quem é.
ALTER TABLE "locais"
  ADD COLUMN "cnpjCpf" TEXT,
  ADD COLUMN "razaoSocialFiscal" TEXT,
  ADD COLUMN "inscricaoEstadual" TEXT,
  ADD COLUMN "indicadorIe" TEXT;

-- 2) A conta ganha a configuração de emissão.
--    Nenhum default é "o que costuma ser": CFOP, CST e alíquota são decisão do
--    contador. O único default é o AMBIENTE, que nasce em homologação (2) —
--    ninguém deve emitir documento com valor fiscal por acidente.
ALTER TABLE "contas"
  ADD COLUMN "cteEmissor" TEXT,
  ADD COLUMN "cteAmbiente" INTEGER DEFAULT 2,
  ADD COLUMN "cteSerie" INTEGER DEFAULT 1,
  ADD COLUMN "cteNaturezaCfop" TEXT,
  ADD COLUMN "cteNaturezaOperacao" TEXT,
  ADD COLUMN "cteIcmsTipo" TEXT,
  ADD COLUMN "cteIcmsAliquota" DECIMAL(5,2),
  ADD COLUMN "cteIcmsReducao" DECIMAL(5,2),
  ADD COLUMN "cteIcmsCst" TEXT,
  ADD COLUMN "cteGatewayUrl" TEXT,
  ADD COLUMN "cteGatewayToken" TEXT;

-- 3) O documento emitido, com os DOIS lados guardados.
--    Sem o que foi mandado e o que voltou, uma rejeição vira "deu erro" e
--    ninguém consegue dizer qual campo estava errado.
CREATE TYPE "StatusDocumentoFiscal" AS ENUM (
  'RASCUNHO', 'ENVIADO', 'AUTORIZADO', 'REJEITADO', 'CANCELADO', 'ERRO'
);

CREATE TABLE "documentos_fiscais" (
  "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
  "id" TEXT NOT NULL,
  "viagemId" TEXT,
  "modelo" TEXT NOT NULL,
  "serie" INTEGER NOT NULL,
  "numero" INTEGER NOT NULL,
  "chave" TEXT NOT NULL,
  "ambiente" INTEGER NOT NULL,
  "emissor" TEXT NOT NULL,
  "status" "StatusDocumentoFiscal" NOT NULL DEFAULT 'RASCUNHO',
  "protocolo" TEXT,
  "autorizadoEm" TIMESTAMP(3),
  "codigoRetorno" TEXT,
  "motivo" TEXT,
  "payload" JSONB NOT NULL,
  "retorno" JSONB,
  "xml" TEXT,
  "canceladoEm" TIMESTAMP(3),
  "cancelamentoMotivo" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "alteradoEm" TIMESTAMP(3) NOT NULL,
  "criadoPorId" TEXT,
  CONSTRAINT "documentos_fiscais_pkey" PRIMARY KEY ("id")
);

-- Chave repetida na mesma conta é numeração furada — o pior defeito possível
-- aqui, porque só aparece na SEFAZ recusando o segundo documento.
CREATE UNIQUE INDEX "documentos_fiscais_contaId_chave_key" ON "documentos_fiscais"("contaId", "chave");
CREATE INDEX "documentos_fiscais_contaId_status_idx" ON "documentos_fiscais"("contaId", "status");
CREATE INDEX "documentos_fiscais_viagemId_idx" ON "documentos_fiscais"("viagemId");

ALTER TABLE "documentos_fiscais"
  ADD CONSTRAINT "documentos_fiscais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "documentos_fiscais_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "documentos_fiscais_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) A numeração.
--    Tabela própria, e não max(numero)+1: dois usuários emitindo ao mesmo tempo
--    leriam o mesmo máximo e gerariam o mesmo número. O incremento aqui é
--    atômico no banco, que é a única forma de isso não acontecer.
CREATE TABLE "sequencias_fiscais" (
  "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
  "id" TEXT NOT NULL,
  "modelo" TEXT NOT NULL,
  "serie" INTEGER NOT NULL,
  "proximo" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "sequencias_fiscais_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sequencias_fiscais_contaId_modelo_serie_key" ON "sequencias_fiscais"("contaId", "modelo", "serie");
CREATE INDEX "sequencias_fiscais_contaId_idx" ON "sequencias_fiscais"("contaId");

ALTER TABLE "sequencias_fiscais"
  ADD CONSTRAINT "sequencias_fiscais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
