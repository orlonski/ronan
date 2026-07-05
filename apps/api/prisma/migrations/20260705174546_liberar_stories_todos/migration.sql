-- Stories liberado pra todos: novo padrão da coluna
ALTER TABLE "motoristas" ALTER COLUMN "podeVerStories" SET DEFAULT true;

-- Liga stories pra todos os motoristas já cadastrados
UPDATE "motoristas" SET "podeVerStories" = true;
