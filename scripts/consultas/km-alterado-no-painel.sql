-- =============================================================================
-- Viagens em que ALGUÉM DO PAINEL mexeu no km do motorista
-- =============================================================================
--
-- O km que o motorista informa é lei. Este script é a varredura do que aconteceu
-- ANTES da trava entrar (19/08/2026): até então o painel trocava o km sem motivo,
-- sem aviso e sem registro próprio no histórico.
--
-- SÓ LEITURA — são cinco SELECTs, nada aqui escreve. Pode rodar em produção.
--
-- No DBeaver: põe o cursor dentro de um bloco e Ctrl+Enter roda só ele (cada
-- bloco é independente); Alt+X roda o arquivo inteiro. Recomendo um por vez —
-- cada um abre numa aba de resultado, e dá pra exportar em CSV pelo botão
-- direito → Export resultset.
--
-- No psql:  psql "<DATABASE_URL>" -f scripts/consultas/km-alterado-no-painel.sql
--
-- O que ENTRA na conta (mão humana no painel, no campo km):
--   UPDATE             → tela de editar viagem (PATCH /admin/viagens/:id)
--   RECALCULAR_TRAJETO → botão "Escolher rota" (arrancado) e bota-fora
--   ADMIN_ALTEROU_KM   → alterações depois da trava (essas TÊM motivo escrito)
--
-- O que NÃO entra (não é "mexer sem dever"):
--   MOTORISTA_AJUSTOU_KM / MOTORISTA_JUSTIFICOU_KM → o dono do km é ele
--   Recálculo automático do servidor → não passa por auditoria, e só mexe em
--     viagem lançada offline em que o motorista aceitou a estimativa
--   Linhas com campo 'kmCalculado' → é só a referência de comparação, não o
--     km faturado ("Recalcular trajeto" nunca tocou no km do motorista)
-- =============================================================================


-- =============================================================================
-- 1) RESUMO GERAL — o tamanho do problema em uma linha
-- =============================================================================
WITH mexidas_no_km AS (
  SELECT
    a."entidadeId"                                AS viagem_id,
    a."criadoEm"                                  AS quando,
    a.acao,
    a.motivo,
    NULLIF(a."valorAntes"  #>> '{}', '')::numeric AS de_km,
    NULLIF(a."valorDepois" #>> '{}', '')::numeric AS para_km
  FROM audit_logs a
  WHERE a.entidade = 'Viagem'
    AND a.campo = 'km'
    AND a.acao IN ('UPDATE', 'RECALCULAR_TRAJETO', 'ADMIN_ALTEROU_KM')
    AND (a."valorDepois" #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
)
SELECT
  count(DISTINCT viagem_id)                                    AS viagens_afetadas,
  count(*)                                                     AS total_de_alteracoes,
  count(*) FILTER (WHERE motivo IS NULL OR btrim(motivo) = '') AS alteracoes_sem_motivo,
  min(quando)::date                                            AS primeira,
  max(quando)::date                                            AS ultima,
  round(sum(para_km - de_km), 2)                               AS saldo_km_liquido
FROM mexidas_no_km;


-- =============================================================================
-- 2) QUEM MEXEU — ranking por pessoa
-- =============================================================================
WITH mexidas_no_km AS (
  SELECT
    a."entidadeId"                                AS viagem_id,
    a."criadoEm"                                  AS quando,
    a.motivo,
    u.nome                                        AS quem,
    u.email                                       AS quem_email,
    NULLIF(a."valorAntes"  #>> '{}', '')::numeric AS de_km,
    NULLIF(a."valorDepois" #>> '{}', '')::numeric AS para_km
  FROM audit_logs a
  LEFT JOIN users u ON u.id = a."usuarioId"
  WHERE a.entidade = 'Viagem'
    AND a.campo = 'km'
    AND a.acao IN ('UPDATE', 'RECALCULAR_TRAJETO', 'ADMIN_ALTEROU_KM')
    AND (a."valorDepois" #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
)
SELECT
  coalesce(quem, '(usuário removido / sem autor)')              AS quem,
  quem_email,
  count(DISTINCT viagem_id)                                     AS viagens,
  count(*)                                                      AS alteracoes,
  count(*) FILTER (WHERE motivo IS NULL OR btrim(motivo) = '')  AS sem_motivo,
  round(sum(para_km - de_km), 2)                                AS saldo_km,
  max(quando)                                                   AS ultima_vez
FROM mexidas_no_km
GROUP BY 1, 2
ORDER BY alteracoes DESC;


-- =============================================================================
-- 3) VIAGENS AFETADAS — a lista, uma linha por viagem
--    km_motorista = o que ele informou (a lei) · km_hoje = o que está faturando
--    diferenca > 0 = a plataforma AUMENTOU · < 0 = DIMINUIU o km dele
-- =============================================================================
WITH mexidas_no_km AS (
  SELECT
    a."entidadeId"                                AS viagem_id,
    a."criadoEm"                                  AS quando,
    a.motivo,
    u.nome                                        AS quem
  FROM audit_logs a
  LEFT JOIN users u ON u.id = a."usuarioId"
  WHERE a.entidade = 'Viagem'
    AND a.campo = 'km'
    AND a.acao IN ('UPDATE', 'RECALCULAR_TRAJETO', 'ADMIN_ALTEROU_KM')
    AND (a."valorDepois" #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
),
por_viagem AS (
  SELECT
    viagem_id,
    count(*)                                                     AS alteracoes,
    count(*) FILTER (WHERE motivo IS NULL OR btrim(motivo) = '') AS sem_motivo,
    min(quando)                                                  AS primeira_vez,
    (array_agg(quem   ORDER BY quando ASC ))[1]                  AS quem_primeiro,
    (array_agg(motivo ORDER BY quando DESC))[1]                  AS ultimo_motivo
  FROM mexidas_no_km
  GROUP BY viagem_id
)
SELECT
  v.data::date                     AS data_viagem,
  v.ticket,
  m.nome                           AS motorista,
  c.nome                           AS cliente,
  ct.nome                          AS conta,
  v."kmMotorista"                  AS km_motorista,
  v.km                             AS km_hoje,
  round(v.km - v."kmMotorista", 2) AS diferenca,
  x.alteracoes,
  x.sem_motivo,
  x.primeira_vez,
  x.quem_primeiro,
  x.ultimo_motivo,
  v.status,
  (SELECT count(*) FROM fechamento_linhas fl WHERE fl."viagemMatchId" = v.id) AS em_fechamento,
  'https://app.movatruck.com.br/viagens/' || v.id AS link
FROM viagens v
JOIN por_viagem x      ON x.viagem_id = v.id
LEFT JOIN motoristas m ON m.id = v."motoristaId"
LEFT JOIN clientes   c ON c.id = v."clienteId"
LEFT JOIN contas    ct ON ct.id = v."contaId"
ORDER BY abs(coalesce(v.km - v."kmMotorista", 0)) DESC, v.data DESC;


-- =============================================================================
-- 4) AS QUE AINDA ESTÃO ERRADAS — km de hoje != km que o motorista informou
--    Esta é a lista de AÇÃO: abrir no painel e devolver o km dele.
-- =============================================================================
SELECT
  v.data::date                     AS data_viagem,
  v.ticket,
  m.nome                           AS motorista,
  v."kmMotorista"                  AS km_motorista,
  v.km                             AS km_hoje,
  round(v.km - v."kmMotorista", 2) AS diferenca,
  v.status,
  v."kmAlteracaoMotivo"            AS motivo_registrado,
  'https://app.movatruck.com.br/viagens/' || v.id AS link
FROM viagens v
LEFT JOIN motoristas m ON m.id = v."motoristaId"
WHERE v."kmMotorista" IS NOT NULL
  AND v.km IS NOT NULL
  AND v.km <> v."kmMotorista"
ORDER BY abs(v.km - v."kmMotorista") DESC;


-- =============================================================================
-- 5) LINHA A LINHA — o histórico cru, pra conferir caso a caso
-- =============================================================================
SELECT
  a."criadoEm"                                  AS quando,
  v.data::date                                  AS data_viagem,
  v.ticket,
  m.nome                                        AS motorista,
  coalesce(u.nome, '(sem autor)')               AS quem,
  a.acao,
  NULLIF(a."valorAntes"  #>> '{}', '')::numeric AS de_km,
  NULLIF(a."valorDepois" #>> '{}', '')::numeric AS para_km,
  round(
    NULLIF(a."valorDepois" #>> '{}', '')::numeric
    - NULLIF(a."valorAntes" #>> '{}', '')::numeric, 2
  )                                             AS delta,
  coalesce(NULLIF(btrim(a.motivo), ''), '(SEM MOTIVO)') AS motivo
FROM audit_logs a
JOIN viagens v         ON v.id = a."entidadeId"
LEFT JOIN motoristas m ON m.id = v."motoristaId"
LEFT JOIN users u      ON u.id = a."usuarioId"
WHERE a.entidade = 'Viagem'
  AND a.campo = 'km'
  AND a.acao IN ('UPDATE', 'RECALCULAR_TRAJETO', 'ADMIN_ALTEROU_KM')
  AND (a."valorDepois" #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
ORDER BY a."criadoEm" DESC;
