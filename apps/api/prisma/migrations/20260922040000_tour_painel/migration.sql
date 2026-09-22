-- O passo a passo guiado sobre a tela. Global: as telas são do produto.
CREATE TABLE "tours_painel" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "rota" TEXT NOT NULL,
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tours_painel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tours_painel_chave_key" ON "tours_painel"("chave");

CREATE TABLE "passos_tour" (
    "id" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "alvo" TEXT,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "permissao" TEXT,

    CONSTRAINT "passos_tour_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "passos_tour_tourId_ordem_idx" ON "passos_tour"("tourId", "ordem");

-- Cascade: passo não existe sem o tour dele.
ALTER TABLE "passos_tour" ADD CONSTRAINT "passos_tour_tourId_fkey"
    FOREIGN KEY ("tourId") REFERENCES "tours_painel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A semente do tour da home. Texto e ordem viram linha no banco desde o
-- primeiro dia: é isto que permite corrigir uma frase sem deploy.
--
-- Alvos escolhidos com cuidado: só itens soltos do menu, cabeçalho de grupo e
-- a topbar. O menu é um accordion de um grupo por vez, então um alvo dentro de
-- grupo fechado mediria 0x0 e o furo sairia no canto da tela.
INSERT INTO "tours_painel" ("id", "chave", "nome", "rota", "automatico", "ativo", "alteradoEm")
VALUES ('9b1f6e2c-0000-4000-8000-000000000001', 'home.v1', 'Primeiro uso do painel', '/', true, true, CURRENT_TIMESTAMP);

INSERT INTO "passos_tour" ("id", "tourId", "ordem", "alvo", "titulo", "corpo", "permissao") VALUES
('9b1f6e2c-0000-4000-8000-000000000011', '9b1f6e2c-0000-4000-8000-000000000001', 1, NULL,
 'Bem-vindo ao Movatruck',
 'Deixa eu te mostrar onde fica cada coisa. Leva menos de um minuto, e dá pra pular quando quiser.', NULL),
('9b1f6e2c-0000-4000-8000-000000000012', '9b1f6e2c-0000-4000-8000-000000000001', 2, 'comecar',
 'O seu caminho fica aqui',
 'Em Começar você vê o que falta para a primeira viagem chegar. Pode voltar quando quiser — inclusive daqui a meses, pra explicar o sistema pra quem entrar no time.', NULL),
('9b1f6e2c-0000-4000-8000-000000000013', '9b1f6e2c-0000-4000-8000-000000000001', 3, 'grupo-lancamentos',
 'É aqui que as viagens caem',
 'O motorista lança pelo celular, na pedreira, e a viagem aparece nesta pasta pra você conferir, corrigir e fechar o mês.', 'viagens.ver'),
('9b1f6e2c-0000-4000-8000-000000000014', '9b1f6e2c-0000-4000-8000-000000000001', 4, 'sino',
 'Os avisos chegam aqui',
 'Viagem nova, foto anexada, motorista esperando aprovação. O que precisa de você aparece neste sino.', NULL),
('9b1f6e2c-0000-4000-8000-000000000015', '9b1f6e2c-0000-4000-8000-000000000001', 5, NULL,
 'É isso',
 'O resto do menu você descobre quando precisar. Pra rever este passo a passo, é só ir em Começar, no menu.', NULL);
