-- A conversa entre o SDR e um prospect.
--
-- Tabela própria, e não `whatsapp_mensagens`, porque aquela pertence a uma
-- empresa (contaId obrigatório) e prospect não tem empresa — ele ainda não é
-- cliente. Separar também mantém o canal comercial longe do operacional:
-- nada aqui dá acesso a dado de transportadora.
CREATE TABLE "mensagens_lead" (
    "id"       TEXT NOT NULL,
    "leadId"   TEXT NOT NULL,
    "direcao"  TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mensagens_lead_leadId_criadoEm_idx" ON "mensagens_lead"("leadId", "criadoEm");

ALTER TABLE "mensagens_lead"
  ADD CONSTRAINT "mensagens_lead_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A configuração do SDR mora na plataforma, não em `configuracao_agente`.
--
-- Aquela tabela tem `contaId`: é uma linha POR EMPRESA. O SDR fala com quem
-- ainda não é empresa nenhuma, então ler dali significaria pegar a linha de um
-- cliente qualquer — e, com mais de uma linha, uma linha DIFERENTE a cada
-- leitura, porque `findFirst` sem ordem segue a ordem física da tabela, que o
-- Postgres muda a cada UPDATE. A tela ligaria numa linha e o SDR leria outra.
--
-- Nasce desligado, e o provider é escolha da Movatruck: o agente comercial não
-- pode herdar a escolha de IA (nem a fatura dela) de um cliente.
ALTER TABLE "configuracao_plataforma"
  ADD COLUMN "sdrAtivo"           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sdrProvider"        TEXT    NOT NULL DEFAULT 'anthropic',
  ADD COLUMN "sdrModeloAnthropic" TEXT    NOT NULL DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN "sdrModeloGemini"    TEXT    NOT NULL DEFAULT 'gemini-2.5-flash',
  ADD COLUMN "sdrLinkCadastro"    TEXT    NOT NULL DEFAULT 'https://app.movatruck.com.br/cadastro';
