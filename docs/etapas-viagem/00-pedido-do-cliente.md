# 00 — O que o cliente pediu (06/10/2026)

Cliente novo (transporte rodoviário de longa distância no Mato Grosso: grãos/carga geral,
CT-e, MDF-e, tacógrafo, trabalha com transportadoras/agenciadoras como "Vidal Logística").
Hoje usa o **Checklist Fácil** (app genérico de formulários) e mandou 4 formulários que os
motoristas preenchem. Resumo SÓ dos campos e regras (sem dados pessoais).

Todo formulário grava: autor (motorista), "unidade" (= placa do caminhão), início/fim do
preenchimento, GPS e endereço do fim, sincronização (offline), nota/percentual de itens
"avaliativos" (peso), anexos e assinaturas.

## 1. CONTROLE DESPESAS DE VIAGEM
- FOTO OU PDF DA NOTA. (Só isso. No exemplo: recibo de tarifa R$ 50.) → coberto pelo nosso
  módulo Gasto de viagem (docs/despesas-viagem/). Gaps: anexar PDF; mandar GPS.

## 2. CARREGAMENTO
- Área "Ordem de carregamento": FOTO OU PDF ORDEM CARREGAMENTO; VALOR TARIFA TONELADA
  (obrigatório, R$, ex. R$ 165,00); PESAGEM (sim/não avaliativo, peso 1, obrigatório) + foto do
  ticket de pesagem.
- Área "Conhecimento transporte eletrônico": FOTO CTE; FOTO MDFE.
- Área "KM saída": FOTO KM TACÓGRAFO.

## 3. DESCARGA
- Área "Foto km tacógrafo chegada no destino": foto; SOLICITAR ENCERRAMENTO MDFE (sim/não, peso 1).
- Área "Pesagem": POSSUI PESAGEM? (sim/não, obrigatório, com comentário); COMPROVANTE DE
  DESCARGA (CANHOTO DA NF ASSINADO) (sim/não, obrigatório, com fotos).
- Área "MDFE encerrado??": FOTO COMPROVANTE ENCERRAMENTO MDFE — "NÃO SEGUIR VIAGEM SEM ESTE"
  (no exemplo, ficou sem resposta — o app atual não trava).
- Área "Descarga finalizada": FOTO TACÓGRAFO.

## 4. ACERTO DE FRETE (no escritório da transportadora que contratou o frete)
- NOME DA TRANSPORTADORA (CIDADE) (obrigatório, texto + foto da fachada);
- PESSOA RESPONSÁVEL (FOTOGRAFIA) (obrigatório, nome + foto);
- FOTO DO DOCUMENTO (várias fotos; ex. contrato "via motorista");
- ASSINATURA do responsável (desenhada na tela).
Obs.: é o acerto do motorista com QUEM CONTRATOU O FRETE, não o nosso AcertoMotorista
(empresa → motorista).

## Perguntas em aberto pro cliente
1. "Não seguir viagem sem este" deve TRAVAR o app ou avisar + marcar pendência pro escritório?
   (Regra da casa hoje: lançamento nunca é recusado — memória project_lancamento_nunca_recusado.)
2. "Valor tarifa tonelada" é conferência do combinado ou é o preço?
