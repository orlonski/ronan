-- A conferência automática de ticket passa a valer SÓ para a Schaba.
--
-- Em 22/08 a migration `liga_conferencia_existentes` ligou o recurso para toda
-- conta ativa (`WHERE ativa = true`). Fazia sentido quando a Schaba era a única
-- empresa de verdade no ar; deixou de fazer no instante em que entrou outra.
--
-- O conferente gasta dinheiro por viagem lançada, e recurso que custa é decisão
-- da plataforma, não da empresa — quem entra novo não deve começar pagando por
-- algo que não pediu. É o mesmo princípio que já fez a coluna nascer com
-- default FALSE; foi só o UPDATE em massa que passou por cima dele.
--
-- Isto é um ajuste de estado, não de regra: quem quiser ligar para outra
-- empresa faz pelo painel, na tela de Empresas, e nada aqui atrapalha.
UPDATE "contas"
   SET "iaConferenciaTicket" = false
 WHERE "slug" <> 'schaba';
