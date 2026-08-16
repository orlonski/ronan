-- Faltava um ponto de recusa: `resolverTicketParaEmpresa` respondia 400
-- "Informe o número do ticket" e matava o finalizar da viagem no outbox do
-- motorista. Mesmo tratamento dos outros: entra e fica carimbada.
ALTER TYPE "MotivoDivergencia" ADD VALUE 'FALTA_TICKET';
