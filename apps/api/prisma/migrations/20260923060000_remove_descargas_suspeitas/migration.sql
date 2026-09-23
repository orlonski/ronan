-- A tela "Descargas fora do local" saiu (decisão do dono, 23/09/2026): ela
-- supunha que o motorista lança a viagem parado na descarga, e hoje ele lança
-- de casa — a lista só acusava quem não tinha feito nada errado.
-- Tira a permissão de onde ela mora; sem RAISE, pra nunca travar o deploy.

UPDATE "papeis"
   SET "permissoes" = ARRAY(SELECT p FROM unnest("permissoes") p WHERE p NOT LIKE 'descargas-suspeitas.%')
 WHERE EXISTS (SELECT 1 FROM unnest("permissoes") p WHERE p LIKE 'descargas-suspeitas.%');

UPDATE "papeis_modelo"
   SET "permissoes" = ARRAY(SELECT p FROM unnest("permissoes") p WHERE p NOT LIKE 'descargas-suspeitas.%')
 WHERE EXISTS (SELECT 1 FROM unnest("permissoes") p WHERE p LIKE 'descargas-suspeitas.%');

UPDATE "contas"
   SET "permissoesPermitidas" = ARRAY(SELECT p FROM unnest("permissoesPermitidas") p WHERE p NOT LIKE 'descargas-suspeitas.%')
 WHERE EXISTS (SELECT 1 FROM unnest("permissoesPermitidas") p WHERE p LIKE 'descargas-suspeitas.%');

UPDATE "configuracao_permissoes"
   SET "tetoPadrao" = ARRAY(SELECT p FROM unnest("tetoPadrao") p WHERE p NOT LIKE 'descargas-suspeitas.%')
 WHERE EXISTS (SELECT 1 FROM unnest("tetoPadrao") p WHERE p LIKE 'descargas-suspeitas.%');
