-- CreateTable: configuração singleton do agente IA do WhatsApp.
-- Separada da configuracao_ia (motor de conciliação): trade-offs diferentes.
-- API keys ficam em env var; aqui só seleciona provider e modelo.
CREATE TABLE "configuracao_agente" (
    "id"              TEXT         NOT NULL DEFAULT 'default',
    "provider"        TEXT         NOT NULL DEFAULT 'anthropic',
    "modeloAnthropic" TEXT         NOT NULL DEFAULT 'claude-sonnet-4-6',
    "modeloGemini"    TEXT         NOT NULL DEFAULT 'gemini-2.5-flash',
    "alteradoEm"      TIMESTAMP(3) NOT NULL,
    "alteradoPorId"   TEXT,
    CONSTRAINT "configuracao_agente_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "configuracao_agente"
  ADD CONSTRAINT "configuracao_agente_alteradoPorId_fkey"
  FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
