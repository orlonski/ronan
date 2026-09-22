-- Libera o recurso novo pras contas que têm TETO CUSTOMIZADO.
--
-- ⚠️ Sem isto a tela de Perfis de acesso não chegaria nelas, em silêncio.
-- `tetoDaConta` usa `permissoesPermitidas` NO LUGAR do teto padrão quando a
-- lista não está vazia — e uma lista gravada no passado não conhece recurso
-- criado depois. O código previu o caso contrário ("chave que saiu do código
-- não volta à vida por estar guardada no banco") e não este.
--
-- ⚠️ Isto conserta ESTE recurso, não a causa. Todo recurso novo vai precisar
-- da mesma linha até alguém decidir como uma lista fixa convive com um
-- catálogo que cresce.
--
-- Só mexe em quem JÁ tem lista (as demais seguem no teto padrão, que é
-- calculado do catálogo e já inclui o recurso novo), e só acrescenta chave que
-- ainda não está lá.
UPDATE "contas"
SET "permissoesPermitidas" = "permissoesPermitidas" || ARRAY[
  'perfis-acesso.ver',
  'perfis-acesso.criar',
  'perfis-acesso.editar',
  'perfis-acesso.aplicar',
  'perfis-acesso.excluir'
]
WHERE array_length("permissoesPermitidas", 1) > 0
  AND NOT ('perfis-acesso.ver' = ANY("permissoesPermitidas"));
