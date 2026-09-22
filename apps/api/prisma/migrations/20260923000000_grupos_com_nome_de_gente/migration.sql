-- Os grupos que o sistema criou ganham nome de gente (22/09/2026): o dono viu
-- "Padrão da empresa (herdado)" na tela e não entendeu. Só renomeia o que ainda
-- tem o nome do sistema, e nunca por cima de um perfil que a empresa criou com
-- o mesmo nome — aí o do sistema fica com "(padrão)" no fim.

UPDATE "perfis_acesso_app" p SET "nome" = 'Motoristas'
WHERE p."nome" = 'Padrão da empresa (herdado)'
  AND NOT EXISTS (SELECT 1 FROM "perfis_acesso_app" q WHERE q."contaId" = p."contaId" AND q."nome" = 'Motoristas');
UPDATE "perfis_acesso_app" p SET "nome" = 'Motoristas (padrão)'
WHERE p."nome" = 'Padrão da empresa (herdado)'
  AND NOT EXISTS (SELECT 1 FROM "perfis_acesso_app" q WHERE q."contaId" = p."contaId" AND q."nome" = 'Motoristas (padrão)');

UPDATE "perfis_acesso_app" p SET "nome" = 'Registrados (CLT)'
WHERE p."nome" = 'Registrado (herdado)'
  AND NOT EXISTS (SELECT 1 FROM "perfis_acesso_app" q WHERE q."contaId" = p."contaId" AND q."nome" = 'Registrados (CLT)');
UPDATE "perfis_acesso_app" p SET "nome" = 'Registrados (CLT) (padrão)'
WHERE p."nome" = 'Registrado (herdado)'
  AND NOT EXISTS (SELECT 1 FROM "perfis_acesso_app" q WHERE q."contaId" = p."contaId" AND q."nome" = 'Registrados (CLT) (padrão)');

-- A descrição só muda se ainda é o texto do sistema: o que alguém escreveu fica.
UPDATE "perfis_acesso_app" SET "descricao" = 'O que o motorista vê no celular.'
WHERE "descricao" = 'O que a maioria dos motoristas tinha na ficha. Editável como qualquer perfil.';
UPDATE "perfis_acesso_app" SET "descricao" = 'O que quem é registrado em carteira vê no celular: o ponto e os documentos.'
WHERE "descricao" IN (
  'O que todo registrado em carteira já tinha no app: o ponto.',
  'O que todo registrado em carteira tem no app: o ponto e os documentos que a empresa pedir.'
);

-- O motivo das diferenças que vieram da ficha, em língua de gente.
UPDATE "excecoes_acesso_app" SET "motivo" = 'Já era assim na ficha dele.'
WHERE "motivo" = 'Era assim na ficha dele antes das regras de acesso.';
