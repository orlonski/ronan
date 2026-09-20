-- O link público de pagamento (`/pagar/<token>`).
--
-- O copia-e-cola do Pix tem ~230 caracteres e não cabe em botão nenhum do
-- WhatsApp (o COPY_CODE da Meta para em 15), então o cliente só conseguia
-- copiar o balão inteiro — com o texto junto, que o banco recusa. O token leva
-- pra uma página com botão de copiar de verdade.
ALTER TABLE "assinaturas" ADD COLUMN "tokenPagamento" TEXT;

CREATE UNIQUE INDEX "assinaturas_tokenPagamento_key" ON "assinaturas"("tokenPagamento");
