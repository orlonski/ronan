-- O módulo "frota" vira "manutencao" (24/09/2026). Rastreamento e pedágio foram
-- pro núcleo no catálogo; quem tinha Frota continua com tudo que tinha.
UPDATE "modulos_contratados" m
SET "chave" = 'manutencao', "alteradoEm" = CURRENT_TIMESTAMP
WHERE m."chave" = 'frota'
  AND NOT EXISTS (
    SELECT 1 FROM "modulos_contratados" x WHERE x."contaId" = m."contaId" AND x."chave" = 'manutencao'
  );
DELETE FROM "modulos_contratados" WHERE "chave" = 'frota';
