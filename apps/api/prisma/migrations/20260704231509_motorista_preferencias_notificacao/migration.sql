-- Preferências de notificação do motorista (controladas no app).
ALTER TABLE "motoristas" ADD COLUMN IF NOT EXISTS "aceitaPush" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "motoristas" ADD COLUMN IF NOT EXISTS "aceitaWhatsapp" BOOLEAN NOT NULL DEFAULT true;
