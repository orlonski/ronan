-- O SDR pode responder pela MiniMax, que fala o protocolo da Anthropic.
-- Coluna com default: linha existente não precisa de backfill e a tela já
-- encontra um modelo válido na primeira leitura.
ALTER TABLE "configuracao_plataforma"
  ADD COLUMN "sdrModeloMinimax" TEXT NOT NULL DEFAULT 'MiniMax-M3';

-- As chaves de IA passam a ser configuráveis pela tela. Nulo = usa a env do
-- servidor, que é o estado de quem não mexer em nada.
ALTER TABLE "configuracao_plataforma"
  ADD COLUMN "sdrChaveAnthropic" TEXT,
  ADD COLUMN "sdrChaveGemini" TEXT,
  ADD COLUMN "sdrChaveMinimax" TEXT;
