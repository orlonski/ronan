# 00 — Conciliação de tag de pedágio (Sem Parar): o pedido e o arquivo (06/10/2026)

## O pedido (call com o cliente de MT, transporte de grãos/pecuária, 3 caminhões, frota própria ~30% + subcontratada ~70%, agregado de outras transportadoras)
"Conciliação do Sem Parar: importar o extrato, apontar divergências (cobrança em
duplicidade, passagem impossível pela rota) e conferir os créditos de pedágio pagos
pelo contratante." O cliente ouviu que "já está em desenvolvimento" — **não há nada
construído** (conferido no código em 06/10/2026). Usa o Sem Parar (plano pré-pago
empresarial) e o X7 (abastecimento pós-pago). Hoje o motorista lança pedágio à mão no app.

## O arquivo de exemplo
Fatura mensal do **Sem Parar** em **PDF** (gerado por Prawn, texto extraível com
`pdftotext -layout`), 7 páginas, período de ~30 dias. O arquivo real fica FORA do
repositório (dados do cliente): ver o caminho que o orquestrador passar.

Seções, na ordem:
1. Cabeçalho do cliente (nome, CNPJ, e-mail, endereço), nº da fatura, nº da NF, código do
   cliente, data de emissão, próximo faturamento.
2. **Recargas** (pré-pago): data, "VALOR RECARGA", valor C.
3. **Resumo por veículo**: placa, plano contratado (R$), uso (R$), qtd de usos, total.
4. **Plano contratado** por placa: mensalidade e serviços agregados (saúde, monitoramento).
5. Por placa (bloco "PLACA - NOME DO PLANO"):
   - **Detalhamento das Passagens por Pedágios**: Data (dd/mm/aa), Hora (hh:mm:ss),
     Concessionária (ex. NOVA ROTA DO OESTE, VIA BRASIL MT 246), Praça (ex.
     "BR364, KM579+100, NORTE, NOBRES" = rodovia, km, sentido, cidade), Cat (categoria
     cobrada: 4, 5, 61…), R$ com D/C. Pode quebrar de página.
   - "Total de Pedágio".
   - **Detalhamento das Passagens Vale Pedágio**: Data, Hora, Concessionária,
     **Embarcador** (ex. EMB-1), Praça, Cat, **Viagem** (nº), R$ — aparece
     em PARES: um crédito C (vale-pedágio do embarcador) e um débito D da passagem.
   - "Total de Vale Pedágio" e "Total de outras arrecadações".
6. Nota fiscal/fatura de serviços (valores tributáveis e não tributáveis).
Legenda: C = crédito, D = débito.

## Pistas de divergência já visíveis no exemplo
- Mesma praça, sentidos opostos, 2 min de diferença (NORTE 09:38 / SUL 09:40) — passagem
  dupla/impossível ou retorno a explicar.
- Mesma placa cobrada em categorias diferentes na mesma praça (4, 5, 61) — eixo
  suspenso/categoria errada = dinheiro.
- Total de pedágio de uma placa ≠ "uso" do resumo (diferença ~R$ 64,80) — provável efeito
  de vale-pedágio creditado; é onde mora "conferir os créditos pagos pelo contratante".

## O que já existe no Movatruck pra reaproveitar (ver docs/despesas-viagem e o código)
`PedagioRodovia` (praças com GPS e valor base), detecção de praças na rota
(`admin/pedagios-rodovia/pedagios-rodovia-consulta.service.ts`), `Pedagio` (lançado pelo
motorista), `Viagem.valorPedagioTotal`, aviso de pedágio em dobro no acerto
(`DecisaoPedagioDobro`), `TabelaPreco.repassaPedagio`, importação de extrato de cartão
combustível (`common/cartao-combustivel.ts` — padrão de importar e conciliar), rastro GPS
da viagem (`ViagemPonto`).
