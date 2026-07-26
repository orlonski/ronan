# Runner de tasks do ClickUp

Webhook de Automation do ClickUp → fila no Postgres → worker → comentário de volta na task.

Mora em `apps/api/src/clickup-runner/`. **Nasce desligado**: sem `CLICKUP_RUNNER_TOKEN`, o
endpoint responde 401 e o worker nem inicia o loop. Subir o código não liga nada.

## Contrato

```
POST /clickup/task-ready?task_id={id}
Headers:
  Content-Type:   application/json
  X-Runner-Token: <segredo compartilhado>
Body: payload JSON da Automation
```

| Código | Quando |
|---|---|
| `200` | aceito e enfileirado — devolve `{status, jobId, taskId}` |
| `400` | sem `task_id` (nem na query, nem no payload) |
| `401` | token ausente/errado, ou runner desligado |
| `409` | já existe execução ativa pra task, ou reenvio dentro da janela de dedupe |
| `429` | rate limit por IP estourado |

O handler só valida, persiste e enfileira — responde em milissegundos, independente de
quanto o agente demore depois.

## Variáveis de ambiente

| Var | Default | Pra que |
|---|---|---|
| `CLICKUP_RUNNER_TOKEN` | — | Segredo do header. **Vazio = runner desligado.** |
| `CLICKUP_RUNNER_PATH_SEGREDO` | — | Segmento secreto no path: `/<segredo>/clickup/task-ready`. Quando setado, a rota sem o segmento para de valer. |
| `CLICKUP_API_TOKEN` | — | Token pessoal do ClickUp pra comentar. Sem ele, a execução roda e o comentário vira log de aviso. |
| `CLICKUP_API_URL` | `https://api.clickup.com/api/v2` | Útil pra apontar pra um servidor falso em teste. |
| `CLICKUP_RUNNER_CONCORRENCIA` | `1` | Execuções simultâneas no total (por task é sempre 1). |
| `CLICKUP_RUNNER_JANELA_DEDUPE_MS` | `600000` | Reenvio da mesma task dentro da janela é recusado. |
| `CLICKUP_RUNNER_TENTATIVAS_MAX` | `3` | Só conta pra falha de **infra**. |
| `CLICKUP_RUNNER_TIMEOUT_MS` | `1800000` | Teto duro por execução. |
| `CLICKUP_RUNNER_ORCAMENTO_USD` | `5` | Teto de gasto, repassado ao executor. |
| `CLICKUP_RUNNER_RATE_LIMIT` | `30` | Requisições por minuto por IP. |
| `CLICKUP_RUNNER_INTERVALO_MS` | `5000` | Intervalo do loop do worker. |

Segredo nenhum aparece em log — nem em erro de autenticação.

## Configurar a Automation no ClickUp

1. Gere um segredo: `openssl rand -hex 32` → vira `CLICKUP_RUNNER_TOKEN` no serviço.
2. Na lista, **Automations → Add Automation**, gatilho a gosto (ex.: status muda pra "pronto pro agente").
3. Ação **Call webhook**:
   - URL: `https://api.schaba.com.br/clickup/task-ready?task_id={{task.id}}`
     (com `CLICKUP_RUNNER_PATH_SEGREDO`: `https://api.schaba.com.br/<segredo>/clickup/task-ready?...`)
   - Method: `POST`
   - Header: `X-Runner-Token: <o segredo>`
4. HTTPS é obrigatório — o segredo viaja no header.

## Como a fila se comporta

- **Uma execução ativa por task**, garantida por índice único no banco (`taskAtiva`), não por
  checagem em memória: dois webhooks simultâneos brigam no índice e o perdedor vira 409.
- **Dedupe por janela**: o ClickUp reenvia em timeout; reenvio da mesma task dentro de
  `JANELA_DEDUPE_MS` é recusado mesmo que a execução anterior já tenha terminado.
- **Estado no Postgres** (`execucoes_agente`): reinício do serviço não perde item — quem estava
  `PENDENTE` é processado depois do boot.
- **Stale recovery**: execução `EXECUTANDO` cuja posse passou do timeout volta pra fila. Sem
  isso, processo morto no meio travaria a task pra sempre (o índice único bloquearia os
  webhooks seguintes dela).
- **Retentativa só em falha de infra**, com backoff 30s → 60s → 120s (teto 15 min). Falha do
  próprio agente é resultado, não defeito: não retenta, só comenta.
- **Sempre comenta** no fim — sucesso, falha ou estouro de limite. Silêncio é o pior desfecho.

## Ligar a execução de verdade

Hoje o provider registrado no token `EXECUTOR_AGENTE` é o `StubExecutorAgente`: ele **não roda
agente nenhum**, só devolve um resultado explicando isso (e o comentário vai pra task
normalmente). Foi decisão explícita — a API atende motorista e painel, e não deve ganhar a
capacidade de executar código e escrever no repositório sem uma decisão de infra.

Pra plugar de verdade, implemente `ExecutorAgente` (`executor/executor-agente.ts`) e troque o
provider em `clickup-runner.module.ts`:

```ts
{ provide: EXECUTOR_AGENTE, useClass: MeuExecutorReal }
```

O contrato já entrega o que o worker precisa: `branch` (`feat/{task_id}`, sanitizado pra ref
git válida), `timeoutMs`, `orcamentoUsd` e a tentativa atual. O executor devolve status,
resumo, arquivos alterados, custo e `falhaInfra` (o que distingue "retenta" de "não retenta").

Uma implementação com Claude Code headless faria, dentro de um container isolado:

```bash
git worktree add ../wt-{task_id} -b feat/{task_id}
claude -p "<contexto da task>" --output-format json \
       --permission-mode acceptEdits --max-budget-usd <orçamento>
```

O JSON de saída traz `result`, `total_cost_usd`, `duration_ms` e `is_error` — que é exatamente
o `ResultadoExecucao`. Note que o CLI atual (2.1.x) **não** tem `--max-turns`; o limite de
turnos do enunciado vira teto de gasto (`--max-budget-usd`) somado ao timeout duro do worker.

**Não** rodar com `--dangerously-skip-permissions` fora de container isolado, e **não** dar
credencial de push pra branch principal.
