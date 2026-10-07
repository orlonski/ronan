# API pública (/v1): mudanças no contrato

O contrato publicado é `apps/api/openapi/v1.json`. A API **não sobe** se o
contrato gerado pelo código for diferente dele (`publica.boot-check.ts`): mudou o
que entra ou sai de uma rota, regenere (`cd apps/api && ATUALIZAR_OPENAPI=1 pnpm
exec vitest run src/publica/openapi.spec.ts`), suba `VERSAO_CONTRATO` em
`src/publica/openapi.ts` e anote aqui. Campo novo opcional na saída não quebra
cliente; campo removido, tipo trocado ou obrigatório novo na entrada quebra — só
com aviso ao integrador antes.

## 2026-10-08 — primeira versão (Onda 1A)

- `GET /v1/eu`: testa a chave.
- `POST /v1/viagens`, `PUT /v1/viagens/externo/{idExterno}`: cria e atualiza viagem pelo número do sistema de fora.
- `GET /v1/viagens/{id}`, `GET /v1/viagens/externo/{idExterno}`: lê uma viagem.
- `PUT /v1/motoristas/externo/{idExterno}`, `PUT /v1/veiculos/externo/{idExterno}`, `PUT /v1/locais/externo/{idExterno}`: cadastros que a viagem exige.
- Escopos: `viagens:ler`, `viagens:escrever`, `cadastros:escrever`.
- Documentação: `/v1/docs` (página) e `/v1/openapi.json`.
