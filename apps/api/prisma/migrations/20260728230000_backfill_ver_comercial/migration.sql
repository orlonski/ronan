-- `viagens.ver-comercial` nasceu como chave nova, e chave nova é opt-in: nenhum
-- papel existente a recebeu. Só que esta chave REMOVE dados de quem não a tem
-- (cliente, empresa, mínimo, fechamento saem do payload) — então o efeito no
-- deploy foi todo papel que não fosse o Administrador perder o que já enxergava,
-- e as telas de editar viagem e de ver local quebrarem.
--
-- Restaura o comportamento anterior: quem já via viagem passa a ver com os dados
-- comerciais, como antes. Daqui pra frente é escolha na matriz de papéis.
UPDATE "papeis"
SET "permissoes" = array_append("permissoes", 'viagens.ver-comercial')
WHERE 'viagens.ver' = ANY("permissoes")
  AND NOT ('viagens.ver-comercial' = ANY("permissoes"));
