-- A carteira do motorista: os documentos que ele precisa ter em dia pra pegar
-- carga. É da PESSOA e acompanha ele de transportadora em transportadora — não
-- confundir com `motorista_documentos`, que é o que UMA empresa guarda dele.
CREATE TYPE "TipoDocumentoPessoal" AS ENUM (
  'CNH', 'EXAME_TOXICOLOGICO', 'RNTRC', 'CRLV', 'MOPP',
  'CERTIFICADO_TACOGRAFO', 'ANTECEDENTES', 'COMPROVANTE_RESIDENCIA',
  'IDENTIDADE_CPF', 'OUTRO'
);

CREATE TABLE "documentos_pessoais" (
    "id" TEXT NOT NULL,
    "identidadeId" TEXT NOT NULL,
    "tipo" "TipoDocumentoPessoal" NOT NULL,
    "numero" TEXT,
    "validade" DATE,
    "placa" TEXT,
    "observacao" TEXT,
    "arquivoKey" TEXT,
    "arquivoMime" TEXT,
    "arquivoNome" TEXT,
    "avisadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_pessoais_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "documentos_pessoais_identidadeId_tipo_idx" ON "documentos_pessoais"("identidadeId", "tipo");
-- O cron de vencimento varre por data, não por pessoa.
CREATE INDEX "documentos_pessoais_validade_idx" ON "documentos_pessoais"("validade");

ALTER TABLE "documentos_pessoais" ADD CONSTRAINT "documentos_pessoais_identidadeId_fkey"
    FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- O mesmo link (token + revogação) passa a servir a dois conteúdos: o que ele
-- rodou, e quem ele é. Default FRETES = o que já existia.
CREATE TYPE "TipoComprovantePessoal" AS ENUM ('FRETES', 'CADASTRO');
ALTER TABLE "comprovantes_pessoais"
  ADD COLUMN "tipo" "TipoComprovantePessoal" NOT NULL DEFAULT 'FRETES';
