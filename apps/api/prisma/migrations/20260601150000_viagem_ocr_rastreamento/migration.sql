-- Rastreamento granular do OCR de ticket: quais campos foram preenchidos
-- via IA (motorista clicou "Usar sugestões" e manteve até o submit) +
-- confidence geral da extração.

ALTER TABLE "viagens"
  ADD COLUMN "ocrCampos"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ocrConfidence" DOUBLE PRECISION;
