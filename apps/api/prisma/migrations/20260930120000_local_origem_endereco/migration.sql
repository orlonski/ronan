-- Local criado pelo motorista a partir do endereço buscado no mapa
-- (capacidade app.locais.buscarEndereco). Nenhuma capacidade é ligada aqui:
-- ela nasce desligada e a empresa liga pra quem quiser.
ALTER TYPE "OrigemCadastroLocal" ADD VALUE 'MOTORISTA_ENDERECO';
