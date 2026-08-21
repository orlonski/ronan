-- Quem libera IA de ticket é a PLATAFORMA, empresa por empresa.
--
-- Cada leitura de ticket custa dinheiro de verdade, e quem paga a conta é a
-- plataforma — não o administrador da empresa. Por isso as duas chaves ficam na
-- `contas` e são mexidas atrás do PlataformaGuard, junto de `ativa` e
-- `permiteAutoCadastro`, e não na matriz de permissões (onde um admin de
-- empresa poderia ganhá-las por engano num papel).
--
-- Defaults diferentes, e é de propósito:
--   * `iaLeituraTicket` = TRUE  — o OCR no app já está em produção. Subir esta
--     migration com FALSE tiraria do ar, em silêncio, algo que hoje funciona.
--     Quem quiser cortar o gasto desliga na tela, cientemente.
--   * `iaConferenciaTicket` = FALSE — recurso novo que gasta por viagem
--     lançada. Nada que consome dinheiro por conta própria nasce ligado.
--
-- ESCRITA À MÃO: o banco de dev tem drift antigo de `db push` nas FKs de
-- `viagens` (ver migrations 20260717120000 e 20260726210000). Um `migrate dev`
-- arrastaria esse drift junto e pediria reset do banco.

-- AlterTable
ALTER TABLE "contas" ADD COLUMN "iaLeituraTicket" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "contas" ADD COLUMN "iaConferenciaTicket" BOOLEAN NOT NULL DEFAULT false;
