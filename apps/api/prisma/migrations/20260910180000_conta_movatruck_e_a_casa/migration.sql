-- A Movatruck passa a ter conta própria, e a Schaba vira um cliente como os
-- outros.
--
-- Herança do tempo em que a Schaba ERA o sistema: como "a plataforma" sempre foi
-- resolvida como "a conta mais antiga", a Schaba acumulava os dois papéis. O
-- efeito prático é que o papel Administrador dela vinha com as 115 chaves — as
-- 23 de plataforma inclusive —, então quem administra a transportadora
-- enxergava a prospecção de clientes, as chaves de IA que a plataforma paga e o
-- WhatsApp compartilhado entre todas as empresas.
--
-- Idempotente: rodar de novo não duplica nada.
DO $$
DECLARE
  v_casa    TEXT;
  v_papel   TEXT;
  v_movidos INT;
BEGIN
  -- 1. A conta da casa. Se já existir uma marcada que não seja pela ordem de
  --    criação, respeitamos e não criamos outra.
  SELECT id INTO v_casa FROM contas WHERE slug = 'movatruck';

  IF v_casa IS NULL THEN
    v_casa := gen_random_uuid()::text;
    INSERT INTO contas (id, nome, slug, ativa, "ehPlataforma", "permiteAutoCadastro", "alteradaEm")
    VALUES (v_casa, 'Movatruck', 'movatruck', true, true, false, now());
    RAISE NOTICE 'Conta Movatruck criada (%).', v_casa;
  END IF;

  -- 2. O papel Administrador dela precisa existir ANTES de alguém apontar pra
  --    ele. Nasce vazio de propósito: o seed do boot (`seedPapeisSistema`) faz
  --    o upsert e preenche com o catálogo inteiro, que é o teto da casa.
  SELECT id INTO v_papel FROM papeis WHERE "contaId" = v_casa AND nome = 'Administrador';

  IF v_papel IS NULL THEN
    v_papel := gen_random_uuid()::text;
    INSERT INTO papeis (id, "contaId", nome, descricao, permissoes, sistema, "alteradoEm")
    VALUES (v_papel, v_casa, 'Administrador', 'Acesso total ao sistema.',
            ARRAY[]::TEXT[], true, now());
  END IF;

  -- 3. Quem opera a plataforma muda de casa. O critério é o flag que já existe
  --    (`User.plataforma`) — quem é super admin passa a morar na Movatruck e
  --    entra nas empresas clientes pela troca de empresa, como suporte.
  --
  --    `contaAtivaId` volta a NULL: a visita que estivesse aberta era pra uma
  --    empresa a partir de outra casa, e não faz mais sentido.
  UPDATE users
     SET "contaId" = v_casa, "papelId" = v_papel, "contaAtivaId" = NULL
   WHERE plataforma = true AND "contaId" <> v_casa;
  GET DIAGNOSTICS v_movidos = ROW_COUNT;
  RAISE NOTICE '% operador(es) da plataforma movido(s) para a Movatruck.', v_movidos;

  -- 4. A casa é uma só. Tirar o flag da Schaba é o que a faz voltar a ser
  --    cliente: no próximo boot, `seedPapeisSistema` recalcula o Administrador
  --    dela pelo teto de empresa (92 chaves) e `podarAcimaDoTeto` remove das
  --    mãos dela o que era de plataforma.
  UPDATE contas SET "ehPlataforma" = (id = v_casa) WHERE "ehPlataforma" <> (id = v_casa);
END $$;
