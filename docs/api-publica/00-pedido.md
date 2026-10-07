# API pública e integrações — o pedido

**Data:** 07/10/2026. **Quem pediu:** o dono.

## O que ele disse

> "nosso sistema não está preparado para disponibilizar api né? por exemplo, vai que tem uma
> empresa que tem um app que cria viagens e ela quer apenas nossa plataforma web para ver as
> viagens criadas. ou vai que tem uma empresa que quer usar nosso app e daí quer que nossos dados
> sincronize com o sistema deles. isso na teoria é algo bem grande né? acho que temos que ter
> webhook e tal. ter documentação de todas nossas apis tanto de entrada como de saída. algo que
> sempre esteja atualizado. aí também acredito que todas nossas tabelas precisem de campos tipo
> identificador externo. [...] também precisaremos de algo que gere token pra disponibilizar,
> capricha heim!"

## Os dois casos que ele deu

1. **Entrada** — a empresa já tem um app próprio que cria viagens e quer usar só o painel web do
   Movatruck pra ver/conferir/faturar essas viagens. O sistema dela empurra dados pra nós.
2. **Saída / sincronização** — a empresa usa o nosso app do motorista e quer que os dados
   (viagens, abastecimentos, pedágios, acertos…) cheguem no sistema dela (ERP, TMS, BI). Nós
   avisamos (webhook) e/ou ela busca.

## O que ele já intuiu

- Webhooks (saída).
- Documentação de TODAS as APIs, entrada e saída, **sempre atualizada** (gerada do código, não
  escrita à mão).
- Identificador externo nas tabelas (o id do sistema deles), pra casar registro com registro e
  não duplicar.
- Gerador de token pra entregar à empresa (credencial de integração).

## O que a squad entrega

Diagnóstico do que existe hoje, o desenho, as decisões que só o dono toma, e uma proposta em ondas
— em `docs/api-publica/`. Nada é implementado nesta etapa.
