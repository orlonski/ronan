-- UMA TELA, UMA PERMISSÃO (decisão do dono, 23/09/2026).
--
-- Três pares de telas dividiam a mesma chave e o escritório não conseguia
-- liberar uma sem a outra:
--   Torre de controle + aba "Quando avisar" + Programação do dia → `programacao`
--   Ao vivo + Viagens                                            → `viagens`
--   Emissor de CT-e (aba de Minha empresa) + CT-e emitidos       → `cte`
-- Cada tela ganhou recurso próprio: `torre`, `config-torre`, `ao-vivo`,
-- `config-cte`. `programacao`, `viagens` e `cte` continuam valendo pras telas
-- que ficaram com eles.
--
-- NINGUÉM PERDE ACESSO: quem tinha a chave antiga ganha a nova equivalente,
-- nos quatro lugares onde lista de chave mora — papéis, papéis-modelo, teto
-- próprio de cada empresa e o teto padrão. Só ACRESCENTA, e só o que ainda
-- não está lá (rodar duas vezes não duplica nada). Nada de RAISE: migration
-- que falha trava a fila inteira.
--
--   programacao.ver    → torre.ver, config-torre.ver
--   programacao.editar → torre.resolver, config-torre.editar
--   viagens.ver        → ao-vivo.ver
--   viagens.editar     → ao-vivo.editar   (fechar/apagar viagem presa)
--   cte.ver            → config-cte.ver
--   cte.emitir         → config-cte.editar (salvar config, certificado, emitir teste)
--
-- As linhas do catálogo (`permissoes`) não entram aqui: o boot faz o upsert a
-- partir do código (PermissoesService.seedCatalogo). O Administrador de cada
-- empresa também seria re-sincronizado pelo boot — entra aqui mesmo assim, pra
-- não haver janela sem a chave entre a migration e o boot.

-- Papéis de cada empresa (inclusive Administrador e Operador).
UPDATE "papeis" AS t
SET "permissoes" = t."permissoes" || ARRAY(
  SELECT DISTINCT m.nova
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."permissoes") AND NOT (m.nova = ANY(t."permissoes"))
  ORDER BY m.nova
)
WHERE EXISTS (
  SELECT 1
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."permissoes") AND NOT (m.nova = ANY(t."permissoes"))
);

-- Modelos de papel publicados pela plataforma.
UPDATE "papeis_modelo" AS t
SET "permissoes" = t."permissoes" || ARRAY(
  SELECT DISTINCT m.nova
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."permissoes") AND NOT (m.nova = ANY(t."permissoes"))
  ORDER BY m.nova
)
WHERE EXISTS (
  SELECT 1
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."permissoes") AND NOT (m.nova = ANY(t."permissoes"))
);

-- Teto PRÓPRIO de cada empresa. Lista vazia = segue o teto padrão (não mexe:
-- vazio quer dizer "padrão", e acrescentar faria dela um teto fechado).
UPDATE "contas" AS t
SET "permissoesPermitidas" = t."permissoesPermitidas" || ARRAY(
  SELECT DISTINCT m.nova
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."permissoesPermitidas") AND NOT (m.nova = ANY(t."permissoesPermitidas"))
  ORDER BY m.nova
)
WHERE EXISTS (
  SELECT 1
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."permissoesPermitidas") AND NOT (m.nova = ANY(t."permissoesPermitidas"))
)
  AND array_length(t."permissoesPermitidas", 1) > 0;

-- Teto padrão das empresas (linha única).
-- ⚠️ O boot (seedTetoPadrao) acrescenta aqui TODA chave nova do catálogo, sem
-- olhar se a antiga estava. Então, se a plataforma tinha tirado `programacao`
-- ou `cte` do teto padrão, as chaves novas entram assim mesmo no próximo boot.
-- Esta linha só garante o caso comum (tinha a antiga → tem a nova) antes do
-- boot; o fechamento, se existia, tem que ser refeito pela tela.
UPDATE "configuracao_permissoes" AS t
SET "tetoPadrao" = t."tetoPadrao" || ARRAY(
  SELECT DISTINCT m.nova
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."tetoPadrao") AND NOT (m.nova = ANY(t."tetoPadrao"))
  ORDER BY m.nova
)
WHERE EXISTS (
  SELECT 1
  FROM (VALUES
    ('programacao.ver', 'torre.ver'),
    ('programacao.ver', 'config-torre.ver'),
    ('programacao.editar', 'torre.resolver'),
    ('programacao.editar', 'config-torre.editar'),
    ('viagens.ver', 'ao-vivo.ver'),
    ('viagens.editar', 'ao-vivo.editar'),
    ('cte.ver', 'config-cte.ver'),
    ('cte.emitir', 'config-cte.editar')
  ) AS m(antiga, nova)
  WHERE m.antiga = ANY(t."tetoPadrao") AND NOT (m.nova = ANY(t."tetoPadrao"))
);
