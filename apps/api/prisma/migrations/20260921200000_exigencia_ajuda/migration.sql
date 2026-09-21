-- A explicação do papel, na língua do motorista.
--
-- O sistema não nomeia documento: o título é o que o contratante pede. Mas
-- "comprovante de endereço" não diz nada pra quem nunca precisou de um, e o
-- app não pode inventar a explicação. Quem escreve o título escreve a ajuda.
ALTER TABLE "documentos_exigidos" ADD COLUMN "ajuda" TEXT;
