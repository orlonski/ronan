-- O cliente ganha razão social, a coluna que faltou pra fechar o cadastro fiscal.
--
-- `CamposFiscais` (shared-types) existe justamente pra local, cliente e empresa
-- terem UMA definição dos campos que fazem de um cadastro uma pessoa no
-- documento. O Zod do cliente já declarava `razaoSocialFiscal` e a tela já tinha
-- o campo — só a coluna ficou de fora: o `cadastro_fiscal` listou os campos do
-- cliente um a um e pulou esse, e o `cte_emissao` adicionou a razão social só
-- em `locais`. Resultado: TODO salvamento na tela de clientes virava 500, porque
-- o form manda `razaoSocialFiscal: null` mesmo em branco.
--
-- Não é campo decorativo: o cliente é quem contrata o frete, então é ele que
-- vira tomador do CT-e quando não é nem o remetente nem o destinatário — e
-- mandar "Obra do Beto" no `xNome` é rejeição na SEFAZ.

ALTER TABLE "clientes" ADD COLUMN "razaoSocialFiscal" TEXT;
