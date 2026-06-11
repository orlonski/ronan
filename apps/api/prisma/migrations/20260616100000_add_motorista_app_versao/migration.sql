-- Versão do app rodando por cada motorista, capturada via headers em toda
-- request pelo AppVersionInterceptor. Como runtimeVersion usa policy
-- "appVersion", o appVersion sozinho não muda entre updates OTA — o que
-- identifica o código real é appUpdateId / appBuiltAt (bundle EAS Update).
-- appVistoEm dá de graça "última vez online" pra cada motorista.
ALTER TABLE "motoristas"
  ADD COLUMN "appVersion" TEXT,
  ADD COLUMN "appUpdateId" TEXT,
  ADD COLUMN "appBuiltAt" TIMESTAMP(3),
  ADD COLUMN "appCanal" TEXT,
  ADD COLUMN "appVistoEm" TIMESTAMP(3);
