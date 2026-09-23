-- A TABELA DO APP POR MODALIDADE (22/09/2026). Decisão do dono: o que cada
-- pessoa vê no celular depende da MODALIDADE do motorista (dado da empresa,
-- tela Vínculos do motorista), mais "sem modalidade" e "só bate ponto".
--
-- UMA PESSOA, UM TIPO: quem tem cadastro de motorista recebe só o tipo do
-- motorista (antes somava com o de funcionário). Pra ninguém perder nada na
-- troca, todo perfil do lado do motorista ganha o ponto que o "só bate
-- ponto" já dá. Pra quem não é funcionário isso não muda nada: o ponto só
-- vale pra quem está em Quem bate ponto (corte de vínculo, estrutural).

-- Os nomes. Só renomeia o que é do sistema (é o padrão da empresa), e nunca
-- por cima de um perfil que a empresa criou com o mesmo nome.
UPDATE "perfis_acesso_app" p SET "nome" = 'Sem modalidade', "descricao" = 'O motorista que ainda não tem modalidade.'
WHERE p."id" IN (SELECT "perfilPadraoMotoristaId" FROM "configuracao_acesso_app" WHERE "perfilPadraoMotoristaId" IS NOT NULL)
  AND p."nome" IN ('Motorista parceiro', 'Motoristas', 'Padrão da empresa (herdado)')
  AND NOT EXISTS (SELECT 1 FROM "perfis_acesso_app" q WHERE q."contaId" = p."contaId" AND q."nome" = 'Sem modalidade');
UPDATE "perfis_acesso_app" p SET "nome" = 'Só bate ponto', "descricao" = 'O CLT que não tem cadastro de motorista (mecânico, escritório).'
WHERE p."id" IN (SELECT "perfilPadraoFuncionarioId" FROM "configuracao_acesso_app" WHERE "perfilPadraoFuncionarioId" IS NOT NULL)
  AND p."nome" IN ('CLT que não dirige', 'Registrados (CLT)', 'Registrado (herdado)')
  AND NOT EXISTS (SELECT 1 FROM "perfis_acesso_app" q WHERE q."contaId" = p."contaId" AND q."nome" = 'Só bate ponto');

-- O ponto que o "só bate ponto" dá passa a estar também em todo perfil do
-- lado do motorista da mesma empresa (o motorista CLT recebia pela soma).
UPDATE "perfis_acesso_app" p
SET "capacidades" = ARRAY(
  SELECT DISTINCT x FROM unnest(p."capacidades" || ARRAY(
    SELECT y FROM unnest(f."capacidades") AS y WHERE y LIKE 'app.ponto.%'
  )) AS x ORDER BY x
)
FROM "configuracao_acesso_app" c
JOIN "perfis_acesso_app" f ON f."id" = c."perfilPadraoFuncionarioId"
WHERE p."contaId" = c."contaId"
  AND p."id" <> c."perfilPadraoFuncionarioId";
