# Cenários de teste — WhatsApp tolerante a dedo gordo

Bateria manual pra rodar contra o agente de produção depois que F1–F4 forem deployadas. Marcar OK/FAIL.

## Setup

1. Ter ao menos 1 motorista vinculado no WhatsApp.
2. No dashboard, cadastrar:
   - **Local A**: nome `Pedreira Souza Naves — balança 2`, apelidos: `souza`, `pedreira nova`
   - **Local B**: nome `Obra Centro — portaria fundos`, apelidos: `obra do beto`, `centro`
   - **Material**: nome `Areia média`, apelidos: `areia`, `arenoso`
   - **Obra**: nome `Construtora Mateus`, apelidos: `mateus`, `obra do mateus`
3. Ter o motorista com algum histórico (idealmente já lançou ≥1 viagem com cada local nas últimas 2 semanas).

## Cenários

| # | Entrada do motorista | Resultado esperado | Status |
|---|---|---|---|
| 1 | `rodei 30t areia da pedrera souza pra obra do mateus, ticket 1234, 145km` | Resolve sem pedir esclarecimento (trgm pega "pedrera"→"Pedreira", apelido "mateus"→Obra). Pede confirmação com nomes exatos. | ☐ |
| 2 | `30t areia da souza pra obra do beto, ticket 5555, 80km` | Resolve via apelidos: "souza" → Local A, "obra do beto" → Local B. Pede confirmação. | ☐ |
| 3 | Áudio: *"rodei 30 toneladas de areia da Souza pra obra do Mateus, ticket 1234, 145 quilômetros"* | Whisper transcreve, agente processa igual texto. `WhatsappMensagem.metadata.origem = "audio_transcrito"` no banco. | ☐ |
| 4 | `lança igual ontem` | Agente chama `locais_recentes_do_motorista`, mostra última viagem do motorista, pede toneladas/ticket. | ☐ |
| 5 | `areia da peudreira novaa` (typo brutal) | trgm acha "Pedreira Souza Naves" via apelido "pedreira nova" ou via similarity. | ☐ |
| 6 | Carga já confirmada como "Pedreira A". Motorista: `descarga obra do mateus` | Agente passa `ancora_local_id` da carga → ranking prioriza obras geo-próximas. Motivo inclui "≈ Xkm do âncora". | ☐ |
| 7 | `cabeça quente` (frase sem match) | Agente responde "não achei aqui, me passa um nome ou rua conhecida". NÃO inventa ID. | ☐ |
| 8 | Áudio com silêncio puro | Agente responde "Não consegui entender o áudio, manda de novo ou escreve". (Filtro de alucinação cobre "Subtítulos pela comunidade") | ☐ |

## Métrica de sucesso

- **6/8 OK sem reformular** = aceitável pra produção.
- **8/8 OK** = excelente.
- Cenário 7 (sem match) e 8 (silêncio) sempre devem dar fallback educado, nunca crash ou ID inventado.

## Como auditar o que aconteceu

```sql
-- ver últimas mensagens com transcrição
SELECT criado_em, telefone, direcao, conteudo, metadata
FROM whatsapp_mensagens
WHERE direcao = 'ENTRADA' AND metadata->>'origem' = 'audio_transcrito'
ORDER BY criado_em DESC LIMIT 20;

-- ver score do match (precisa logging extra na buscarLocal — adicionar se necessário)
```

## Tuning rápido

- Se cenário 5 (typo brutal) falhar → baixar threshold do trgm. No psql:
  ```sql
  SET pg_trgm.similarity_threshold = 0.2;  -- default 0.3
  ```
  Pra persistir, expor como config em `ConfiguracaoAgente.similarityThreshold` e aplicar antes da query.
- Se cenário 2 (apelido) falhar → confirmar que o admin gravou o apelido no painel e que a query tá considerando `f_normalizar_array(apelidos)`.
- Se cenário 3 (áudio) falhar → checar `OPENAI_API_KEY` no env e log do `TranscricaoService`.
