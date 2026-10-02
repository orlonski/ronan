-- Assinatura de quem recebeu na descarga (path SVG). Opcional.
ALTER TABLE "viagens" ADD COLUMN "assinaturaRecebedor" TEXT;

-- Capacidade nova no app (passo opcional na finalização). Nasce ligada.
UPDATE "perfis_acesso_app"
SET "capacidades" = array_append("capacidades", 'app.viagem.assinatura'),
    "alteradoEm" = CURRENT_TIMESTAMP
WHERE NOT ('app.viagem.assinatura' = ANY("capacidades"));
