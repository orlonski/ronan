-- Mínimos por Cliente: piso de toneladas e km por viagem.
-- Quando a viagem é lançada/exibida com valor real < mínimo, o sistema
-- contabiliza pelo mínimo (real continua gravado em Viagem.toneladas/km).
-- NULL = sem regra (comportamento atual preservado pros clientes existentes).

ALTER TABLE "clientes"
  ADD COLUMN "toneladasMinimas" DECIMAL(10,3),
  ADD COLUMN "kmMinimos"        DECIMAL(10,2);
