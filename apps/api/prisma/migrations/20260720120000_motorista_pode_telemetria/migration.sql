-- Flag por motorista pra ligar a telemetria de interação da tela "Nova viagem"
-- (opt-in; gate client-side). NOT NULL com default false — seguro em prod.
ALTER TABLE "motoristas" ADD COLUMN "podeTelemetria" BOOLEAN NOT NULL DEFAULT false;
