-- podeDiaria passa a nascer LIGADO.
--
-- Quem esconde o seletor de modo de serviço no app é o catálogo: com um único
-- modo cadastrado (toda conta que não usa diária) o app não renderiza o campo.
-- A flag em false era um segundo interruptor sem ganho — agora ela volta a ser
-- o que deveria: uma exceção pontual ("esse motorista não lança diária").
--
-- O UPDATE alcança quem já existe. É seguro: motorista de conta sem modo de
-- diária cadastrado continua sem ver absolutamente nada.
ALTER TABLE "motoristas" ALTER COLUMN "podeDiaria" SET DEFAULT true;
UPDATE "motoristas" SET "podeDiaria" = true WHERE "podeDiaria" = false;
