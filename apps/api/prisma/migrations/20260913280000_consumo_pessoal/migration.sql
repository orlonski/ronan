-- O consumo do autônomo era km das viagens que ele lançou ÷ litros de TODOS os
-- abastecimentos dos 90 dias. Dois conjuntos que não se falam: quem lança cinco
-- fretes e abastece vinte vezes via um km/l inventado com cara de medido.
--
-- A conta certa é tanque-a-tanque, e ela precisa saber se o tanque foi cheio.
-- O padrão é TRUE porque é o que o caminhoneiro faz no posto — e porque o
-- histórico não tem como responder: marcar tudo como parcial apagaria o dado.
ALTER TABLE "lancamentos_pessoais"
  ADD COLUMN "tanqueCheio" BOOLEAN NOT NULL DEFAULT true;
