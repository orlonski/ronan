-- CreateTable: sessões WhatsApp (telefone vinculado a motorista OU user, mutuamente exclusivo)
CREATE TABLE "whatsapp_sessoes" (
    "id"             TEXT         NOT NULL,
    "telefone"       TEXT         NOT NULL,
    "motoristaId"    TEXT,
    "userId"         TEXT,
    "vinculadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaMensagem" TIMESTAMP(3),
    CONSTRAINT "whatsapp_sessoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_sessoes_telefone_key"    ON "whatsapp_sessoes"("telefone");
CREATE UNIQUE INDEX "whatsapp_sessoes_motoristaId_key" ON "whatsapp_sessoes"("motoristaId");
CREATE UNIQUE INDEX "whatsapp_sessoes_userId_key"      ON "whatsapp_sessoes"("userId");

ALTER TABLE "whatsapp_sessoes"
  ADD CONSTRAINT "whatsapp_sessoes_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_sessoes"
  ADD CONSTRAINT "whatsapp_sessoes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: convites de vinculação (códigos 6 chars expiram em 24h)
CREATE TABLE "whatsapp_convites" (
    "id"          TEXT         NOT NULL,
    "codigo"      TEXT         NOT NULL,
    "motoristaId" TEXT,
    "userId"      TEXT,
    "expiraEm"    TIMESTAMP(3) NOT NULL,
    "usadoEm"     TIMESTAMP(3),
    "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_convites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_convites_codigo_key" ON "whatsapp_convites"("codigo");
CREATE INDEX        "whatsapp_convites_codigo_idx" ON "whatsapp_convites"("codigo");

ALTER TABLE "whatsapp_convites"
  ADD CONSTRAINT "whatsapp_convites_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_convites"
  ADD CONSTRAINT "whatsapp_convites_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: histórico de mensagens (auditoria + contexto pra IA)
CREATE TABLE "whatsapp_mensagens" (
    "id"        TEXT         NOT NULL,
    "sessaoId"  TEXT,
    "telefone"  TEXT         NOT NULL,
    "direcao"   TEXT         NOT NULL,
    "conteudo"  TEXT         NOT NULL,
    "tipo"      TEXT         NOT NULL,
    "metadata"  JSONB,
    "criadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_mensagens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_mensagens_telefone_criadoEm_idx" ON "whatsapp_mensagens"("telefone", "criadoEm");
CREATE INDEX "whatsapp_mensagens_sessaoId_criadoEm_idx" ON "whatsapp_mensagens"("sessaoId", "criadoEm");

ALTER TABLE "whatsapp_mensagens"
  ADD CONSTRAINT "whatsapp_mensagens_sessaoId_fkey"
  FOREIGN KEY ("sessaoId") REFERENCES "whatsapp_sessoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
