-- =============================================================================
-- DEVOLVER O KM AO MOTORISTA — correção em massa
-- =============================================================================
--
-- ESTE SCRIPT ESCREVE NO BANCO. Leia antes de rodar.
--
-- Devolve `viagens.km` (o faturado) pro valor que o motorista informou
-- (`kmMotorista`), nas viagens em que alguém do painel mexeu SEM MOTIVO — e
-- registra cada correção no histórico da viagem, pra ninguém depois perguntar
-- "quem mudou isso?".
--
-- COMO RODAR NO DBEAVER (importante):
--   1. Troque a conexão pra MANUAL COMMIT (barra de cima: o botão que fica em
--      "Auto" → escolher "Manual Commit"). Sem isso o UPDATE vai direto, sem
--      chance de voltar atrás.
--   2. Rode o BLOCO 1 (monta a lista) e o BLOCO 2 (confere a lista NO OLHO).
--   3. Rode o BLOCO 3 (o UPDATE) e confira o BLOCO 4.
--   4. Gostou → botão COMMIT. Não gostou → ROLLBACK e nada aconteceu.
--
-- QUEM FICA DE FORA (de propósito — decide na mão, BLOCO 5 lista):
--   · Viagem já conciliada em fechamento — mexer no km reabre conta já fechada.
--   · Alteração com motivo escrito — alguém justificou; não é "mexeu sem dever".
--   · Bota-fora aplicado pelo painel — ali o km a mais é a volta que ele fez
--     de verdade; devolver o km "puro" apagaria a perna do retorno.
-- =============================================================================


-- =============================================================================
-- BLOCO 1 — monta a lista de alvos (não altera nada; só uma tabela temporária)
-- =============================================================================
-- `pg_temp.` de propósito: garante que só a tabela temporária desta sessão pode
-- ser derrubada aqui, nunca uma tabela de verdade que tenha o mesmo nome.
DROP TABLE IF EXISTS pg_temp.alvo_km;

CREATE TEMP TABLE alvo_km AS
SELECT
  v.id                AS viagem_id,
  v."contaId"         AS conta_id,
  v.km                AS km_hoje,
  v."kmMotorista"     AS km_motorista
FROM viagens v
WHERE v."kmMotorista" IS NOT NULL
  AND v.km IS NOT NULL
  AND v.km <> v."kmMotorista"
  -- fora: viagem já conciliada em fechamento
  AND NOT EXISTS (
    SELECT 1 FROM fechamento_linhas fl WHERE fl."viagemMatchId" = v.id
  )
  -- fora: alteração justificada (inclusive o carimbo automático do bota-fora)
  AND (v."kmAlteracaoMotivo" IS NULL OR btrim(v."kmAlteracaoMotivo") = '')
  -- fora: viagem com perna de retorno (bota-fora) — o km a mais é estrada real
  AND NOT EXISTS (
    SELECT 1 FROM trechos_viagem t
    WHERE t."viagemId" = v.id AND t.tipo = 'RETORNO_BOTA_FORA'
  );


-- =============================================================================
-- BLOCO 2 — o que VAI ser corrigido. Confira aqui antes de escrever.
-- =============================================================================
SELECT
  v.data::date                        AS data_viagem,
  v.ticket,
  m.nome                              AS motorista,
  c.nome                              AS cliente,
  a.km_hoje                           AS km_errado_hoje,
  a.km_motorista                      AS km_vai_voltar_pra,
  round(a.km_motorista - a.km_hoje, 2) AS ajuste,
  v.status,
  'https://app.movatruck.com.br/viagens/' || v.id AS link
FROM alvo_km a
JOIN viagens v         ON v.id = a.viagem_id
LEFT JOIN motoristas m ON m.id = v."motoristaId"
LEFT JOIN clientes   c ON c.id = v."clienteId"
ORDER BY abs(a.km_motorista - a.km_hoje) DESC;

-- Totais do que o BLOCO 3 vai fazer:
SELECT
  count(*)                                  AS viagens_a_corrigir,
  round(sum(km_motorista - km_hoje), 2)     AS km_devolvido_no_total
FROM alvo_km;


-- =============================================================================
-- BLOCO 3 — O UPDATE (escreve!). Só rode depois de conferir o BLOCO 2.
--
-- Faz três coisas de uma vez: devolve o km, carimba a correção na viagem
-- (o que também mantém o recálculo automático longe dela) e grava uma linha
-- no histórico — "Conferente alterou o km", com o motivo abaixo.
-- =============================================================================
WITH corrigidas AS (
  UPDATE viagens v
  SET km                  = a.km_motorista,
      "kmAlteradoEm"      = now(),
      "kmAlteradoPorId"   = NULL,  -- correção do sistema, não de uma pessoa
      "kmAlteracaoMotivo" = 'Correção em massa: km devolvido ao valor que o motorista informou.'
  FROM alvo_km a
  WHERE v.id = a.viagem_id
  RETURNING v.id, v."contaId", a.km_hoje, a.km_motorista
)
INSERT INTO audit_logs
  (id, "contaId", "usuarioId", entidade, "entidadeId", acao, campo,
   "valorAntes", "valorDepois", motivo, metadata)
SELECT
  gen_random_uuid()::text,
  c."contaId",
  NULL,
  'Viagem',
  c.id,
  'ADMIN_ALTEROU_KM',
  'km',
  to_jsonb(c.km_hoje::text),
  to_jsonb(c.km_motorista::text),
  'Correção em massa: o km tinha sido alterado no painel sem motivo. Devolvido ao valor que o motorista informou.',
  jsonb_build_object('correcaoEmMassa', true, 'kmMotorista', c.km_motorista::text)
FROM corrigidas c;


-- =============================================================================
-- BLOCO 4 — conferência DEPOIS do update (ainda dá pra ROLLBACK)
--   sobrou_errado tem que voltar 0.
-- =============================================================================
SELECT
  count(*)                                              AS viagens_tocadas,
  count(*) FILTER (WHERE v.km <> v."kmMotorista")        AS sobrou_errado
FROM alvo_km a
JOIN viagens v ON v.id = a.viagem_id;

-- Agora: COMMIT (grava) ou ROLLBACK (desfaz tudo).


-- =============================================================================
-- BLOCO 5 — AS QUE O SCRIPT NÃO TOCOU, e por quê. Decida uma a uma.
-- =============================================================================
SELECT
  v.data::date                     AS data_viagem,
  v.ticket,
  m.nome                           AS motorista,
  v."kmMotorista"                  AS km_motorista,
  v.km                             AS km_hoje,
  round(v.km - v."kmMotorista", 2) AS diferenca,
  CASE
    WHEN EXISTS (SELECT 1 FROM fechamento_linhas fl WHERE fl."viagemMatchId" = v.id)
      THEN 'já está em fechamento'
    WHEN EXISTS (SELECT 1 FROM trechos_viagem t
                 WHERE t."viagemId" = v.id AND t.tipo = 'RETORNO_BOTA_FORA')
      THEN 'tem volta de bota-fora no km'
    WHEN v."kmAlteracaoMotivo" IS NOT NULL AND btrim(v."kmAlteracaoMotivo") <> ''
      THEN 'alteração justificada'
    ELSE 'sem motivo aparente — confira'
  END                              AS por_que_ficou_de_fora,
  v."kmAlteracaoMotivo"            AS motivo_registrado,
  'https://app.movatruck.com.br/viagens/' || v.id AS link
FROM viagens v
LEFT JOIN motoristas m ON m.id = v."motoristaId"
WHERE v."kmMotorista" IS NOT NULL
  AND v.km IS NOT NULL
  AND v.km <> v."kmMotorista"
  AND NOT EXISTS (SELECT 1 FROM alvo_km a WHERE a.viagem_id = v.id)
ORDER BY abs(v.km - v."kmMotorista") DESC;
