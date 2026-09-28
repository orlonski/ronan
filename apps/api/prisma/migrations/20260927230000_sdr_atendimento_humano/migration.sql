-- O robô para de falar quando gente assume, e passar pra gente avisa alguém.

ALTER TABLE "configuracao_plataforma"
  ADD COLUMN "sdrLinkApresentacao" TEXT NOT NULL DEFAULT 'https://www.movatruck.com.br',
  ADD COLUMN "sdrAtendenteNome" TEXT,
  ADD COLUMN "sdrNomesEquipe" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sdrHorariosDemo" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "chatwootTimeComercialId" INTEGER,
  ADD COLUMN "chatwootTimeOperacaoId" INTEGER,
  ADD COLUMN "alertaComercialTelefones" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "alertaEscalonarTelefones" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "alertaEscalonarMinutos" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "atendimentoHoraInicio" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "atendimentoHoraFim" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN "atendimentoDias" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[];

-- Semente, não regra: quem atende hoje é o Fernando, e a tela troca.
UPDATE "configuracao_plataforma"
   SET "sdrAtendenteNome" = 'Fernando',
       "sdrNomesEquipe" = ARRAY['Fernando', 'Diego']::TEXT[],
       "sdrHorariosDemo" = ARRAY['09:00', '10:30', '14:00', '16:00']::TEXT[]
 WHERE "id" = 'singleton';

ALTER TABLE "leads"
  ADD COLUMN "primeiraRespostaHumanaEm" TIMESTAMP(3),
  ADD COLUMN "alertaHumanoEm" TIMESTAMP(3),
  ADD COLUMN "alertaEscalonadoEm" TIMESTAMP(3);
