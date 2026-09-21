-- UM DOCUMENTO, UMA LINHA.
--
-- A separação por exigência (20260921170000) resolveu um problema real — 18
-- papéis não cabem em 12 gavetas, e o segundo envio apagava o primeiro — mas
-- criou outro: o mesmo documento passou a poder existir duas vezes. Um anexo
-- avulso na gaveta CNH e a exigência chamada "CNH" viravam DUAS linhas, com
-- dois arquivos, para a mesma carteira de motorista.
--
-- Não existem duas CNH. Esta migration reconcilia o que já está no banco.

-- 1) ADOÇÃO: o anexo avulso passa a SER o documento da exigência, quando há
--    exatamente uma exigência ativa naquela gaveta e ela ainda está vazia.
--    Ninguém perde arquivo e o motorista deixa de ser cobrado de um documento
--    que já está na ficha dele.
WITH exigencia_unica AS (
  SELECT "contaId", tipo, MIN(id) AS exigencia_id
    FROM "documentos_exigidos"
   WHERE ativo = true
   GROUP BY "contaId", tipo
  HAVING COUNT(*) = 1
)
UPDATE "motorista_documento" d
   SET "exigenciaId" = e.exigencia_id,
       chave = 'exig:' || e.exigencia_id
  FROM exigencia_unica e
 WHERE d.chave = 'gaveta:' || d.tipo::text
   AND d."contaId" = e."contaId"
   AND d.tipo::text = e.tipo
   AND NOT EXISTS (
       SELECT 1 FROM "motorista_documento" x
        WHERE x."motoristaId" = d."motoristaId"
          AND x.chave = 'exig:' || e.exigencia_id
   );

-- 2) DESEMPATE: sobrou avulso porque a exigência já tinha arquivo. Aí são dois
--    arquivos para o mesmo documento, e vale o MAIS RECENTE — a mesma regra
--    que o resto do sistema já usa (reenviar substitui). A linha antiga sai;
--    o objeto dela no storage é lixo e o bucket não é servido publicamente.
DELETE FROM "motorista_documento" velho
 USING "documentos_exigidos" e, "motorista_documento" novo
 WHERE velho.chave = 'gaveta:' || velho.tipo::text
   AND e.ativo = true
   AND e."contaId" = velho."contaId"
   AND e.tipo = velho.tipo::text
   AND novo."motoristaId" = velho."motoristaId"
   AND novo.chave = 'exig:' || e.id
   AND novo."criadoEm" >= velho."criadoEm";

-- 3) O contrário: o avulso é o mais NOVO. Ele vence, e o da exigência sai —
--    depois a adoção do passo 1 não o alcançaria mais, então ele é ligado aqui.
WITH exigencia_unica AS (
  SELECT "contaId", tipo, MIN(id) AS exigencia_id
    FROM "documentos_exigidos"
   WHERE ativo = true
   GROUP BY "contaId", tipo
  HAVING COUNT(*) = 1
),
perdedores AS (
  SELECT antigo.id
    FROM "motorista_documento" antigo
    JOIN exigencia_unica e
      ON e."contaId" = antigo."contaId"
     AND antigo.chave = 'exig:' || e.exigencia_id
    JOIN "motorista_documento" avulso
      ON avulso."motoristaId" = antigo."motoristaId"
     AND avulso.chave = 'gaveta:' || avulso.tipo::text
     AND avulso.tipo::text = e.tipo
     AND avulso."criadoEm" > antigo."criadoEm"
)
DELETE FROM "motorista_documento" WHERE id IN (SELECT id FROM perdedores);

WITH exigencia_unica AS (
  SELECT "contaId", tipo, MIN(id) AS exigencia_id
    FROM "documentos_exigidos"
   WHERE ativo = true
   GROUP BY "contaId", tipo
  HAVING COUNT(*) = 1
)
UPDATE "motorista_documento" d
   SET "exigenciaId" = e.exigencia_id,
       chave = 'exig:' || e.exigencia_id
  FROM exigencia_unica e
 WHERE d.chave = 'gaveta:' || d.tipo::text
   AND d."contaId" = e."contaId"
   AND d.tipo::text = e.tipo
   AND NOT EXISTS (
       SELECT 1 FROM "motorista_documento" x
        WHERE x."motoristaId" = d."motoristaId"
          AND x.chave = 'exig:' || e.exigencia_id
   );
