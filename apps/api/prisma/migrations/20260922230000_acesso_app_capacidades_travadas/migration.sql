-- F4 do acesso ao app: quais capacidades o servidor já barra, por empresa.
-- Nasce vazio em todas: o guard só registra (sombra) até a plataforma travar.
ALTER TABLE "configuracao_acesso_app" ADD COLUMN "capacidadesTravadas" TEXT[] DEFAULT ARRAY[]::TEXT[];
