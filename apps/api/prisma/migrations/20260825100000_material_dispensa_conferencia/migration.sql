-- Material que não gera documento: a viagem entra já aprovada.
--
-- O concreto já tinha `temComprovanteFoto = false`, que dispensa a FOTO. Mas a
-- viagem continuava nascendo ENVIADA (o painel mostra "Aguardando") e ficava
-- parada na fila de conferência humana esperando um aval que ninguém tem motivo
-- pra dar — não há ticket, não há o que conferir.
--
-- A flag é separada de `temComprovanteFoto` de propósito: aquela decide a foto,
-- esta decide a conferência. Material sem foto que ainda merece o olho de
-- alguém existe (nota digitada à mão), e o contrário também.
--
-- Nasce FALSE em todo material que já existe: ninguém muda de comportamento por
-- causa desta migration. Ligar é decisão consciente, material por material.
ALTER TABLE "materiais"
  ADD COLUMN "dispensaConferencia" BOOLEAN NOT NULL DEFAULT false;

-- O carimbo na viagem, para a tela poder dizer QUEM aprovou.
--
-- Não reaproveita `conferidoPorIaEm`: aquele significa "a IA leu o documento e
-- aprovou". Aqui nada foi lido — a viagem foi dispensada por regra. Usar o campo
-- do irmão faria a tela mentir sobre o que aconteceu, e é justamente a tela que
-- justifica o campo existir: sem ele a viagem apareceria como "revisada" sem
-- ninguém saber por quem.
ALTER TABLE "viagens"
  ADD COLUMN "conferenciaDispensadaEm" TIMESTAMP(3);
