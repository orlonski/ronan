-- Compatibilidade com o app anterior, que ainda manda o código da empresa no
-- cadastro e espera entrar direto nela. Guarda a conta que o código resolveu
-- pra que o `confirmar` crie o vínculo como antes. Sai quando a frota atualizar.
ALTER TABLE "cadastros_motorista_pendentes" ADD COLUMN "contaConvite" TEXT;
