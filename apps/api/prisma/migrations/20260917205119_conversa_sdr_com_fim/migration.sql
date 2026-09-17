-- A conversa do SDR passa a ter estado: quantos toques já saíram, quando
-- encerrou e se um humano assumiu. Nada aqui é derivável do histórico — uma
-- linha de SAIDA de follow-up é idêntica a uma resposta normal.
ALTER TABLE "leads"
  ADD COLUMN "followupsEnviados" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ultimoFollowupEm" TIMESTAMP(3),
  ADD COLUMN "conversaEncerradaEm" TIMESTAMP(3),
  ADD COLUMN "sdrPausadoEm" TIMESTAMP(3);

-- A varredura pergunta sempre a mesma coisa: conversa viva, ordenada por quem
-- está calado há mais tempo.
CREATE INDEX "leads_conversaEncerradaEm_ultimoContato_idx"
  ON "leads" ("conversaEncerradaEm", "ultimoContato");

-- Os prazos do follow-up, editáveis na tela de Empresas. Nasce desligado.
ALTER TABLE "configuracao_plataforma"
  ADD COLUMN "sdrFollowupAtivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sdrFollowupHoras" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "sdrFollowupMax" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "sdrFollowupIntervaloHoras" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN "sdrEncerrarAposHoras" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN "sdrFollowupHoraInicio" INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN "sdrFollowupHoraFim" INTEGER NOT NULL DEFAULT 19;
