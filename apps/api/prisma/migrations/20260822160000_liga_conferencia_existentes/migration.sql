-- Liga a conferência automática nas empresas que já existem.
--
-- O default da coluna continua FALSE: empresa nova segue nascendo desligada,
-- porque nada que gasta por viagem lançada deve se ligar sozinho pra quem
-- acabou de entrar. Este UPDATE vale só pra quem já está na base hoje.
--
-- É seguro fazer isso agora por um motivo específico: a conferência nasce em
-- MODO SOMBRA (`CONFERENCIA_MODO_SOMBRA`, default true). Nesse modo ela lê o
-- ticket, compara com o que o motorista declarou e grava o veredito — e **não
-- toca na viagem, não escreve no chat e não notifica ninguém**. O que se ganha
-- ligando é a única coisa que não dá pra obter de outro jeito: a comparação
-- entre o que o robô decidiria e o que a conferência humana decidiu, em cima de
-- ticket de verdade.
--
-- Sair da sombra é decisão separada, feita depois de olhar esses dados —
-- variável de ambiente, sem deploy de código.
--
-- Pra desligar qualquer empresa: tela Empresas, um clique.

UPDATE "contas"
   SET "iaConferenciaTicket" = true
 WHERE ativa = true;
