-- Carimbo de "ticket repetido" que ficou velho: a viagem apontada teve o ticket
-- corrigido depois e o número já não é o mesmo. O aviso dizia "9346 já foi
-- lançado" e o link abria a viagem 9345. Tira o carimbo (e o aceite, que era de
-- outra duplicidade) de quem aponta pra uma viagem de ticket diferente.
UPDATE "viagens" v
SET "ticketDuplicadoDeId" = NULL,
    "duplicidadeAceitaEm" = NULL
FROM "viagens" o
WHERE v."ticketDuplicadoDeId" = o."id"
  AND v."ticket" IS DISTINCT FROM o."ticket";
