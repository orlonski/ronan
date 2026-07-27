# Runner de tasks do ClickUp

Webhook de Automation do ClickUp → fila no Postgres → worker → comentário de volta na task.

**São dois processos**, compartilhando código (`apps/api/src/clickup-runner/`) e banco:

| Processo | Entrypoint | Papel |
|---|---|---|
| `ronan-api` | `dist/main.js` | recebe o webhook, autentica, deduplica e **enfileira**. Não processa nada. |
| `ronan_agente` | `dist/agente-main.js` (`apps/agente/Dockerfile`) | **consome a fila** e executa. Sem HTTP. |

A separação é o ponto: reiniciar ou deployar a API não interrompe execução em andamento, e a
capacidade de executar código e mexer no repositório fica isolada num serviço que não atende
motorista nem painel. Quem processou cada job fica gravado em `execucoes_agente.workerId`
(ex.: `ronan_agente#3b539bd4`).

**Nasce desligado** dos dois lados: sem `CLICKUP_RUNNER_TOKEN`, o endpoint responde 401 e o
worker nem inicia o loop. Subir o código não liga nada.

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

Divisão por serviço: `ronan-api` precisa do bloco de webhook; `ronan_agente` precisa do bloco
de worker. `DATABASE_URL` e `CLICKUP_RUNNER_TOKEN` vão nos dois.

**Só no `ronan_agente`:**

| Var | Default | Pra que |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Autenticação do Claude Code (assinatura). |
| `GITHUB_TOKEN` | — | Credencial de git (o entrypoint monta o `credential.helper`). |
| `EXECUTOR_AGENTE` | `stub` | Qual executor registrar. Valor desconhecido **derruba o boot** de propósito. |
| `FONTE_DEMANDA` | `clickup` | De onde vem a demanda: `clickup` (lê a task na API v2 e relata por comentário) ou `payload` (lê do corpo do webhook e relata no log — pra testar por Postman, sem token). Valor desconhecido derruba o boot. |
| `RUNNER_WORKER_NOME` | `agente@<hostname>` | Prefixo do `workerId` gravado na fila. |
| `AGENTE_DIR_TRABALHO` | `/trabalho` | Volume onde ficam o clone base e os worktrees. |

⚠️ **`ANTHROPIC_API_KEY` não pode existir** neste serviço: com ela presente o Claude Code
usaria a chave de API (outra conta, outra cobrança) em vez do token de assinatura, sem avisar.
O entrypoint dá `unset` e o `agente-main.ts` remove do processo com aviso no log — mas o certo
é não configurar.

**Comuns aos dois:**

| Var | Default | Pra que |
|---|---|---|
| `CLICKUP_RUNNER_TOKEN` | — | Segredo do header. **Vazio = runner desligado** (webhook 401, worker parado). |
| `CLICKUP_RUNNER_PATH_SEGREDO` | — | Segmento secreto no path: `/<segredo>/clickup/task-ready`. Quando setado, a rota sem o segmento para de valer. |
| `CLICKUP_API_TOKEN` | — | Token pessoal do ClickUp pra comentar. Sem ele, a execução roda e o comentário vira log de aviso. |
| `CLICKUP_API_URL` | `https://api.clickup.com/api/v2` | Útil pra apontar pra um servidor falso em teste. |
| `CLICKUP_RUNNER_CONCORRENCIA` | `1` | Execuções simultâneas no total (por task é sempre 1). |
| `CLICKUP_RUNNER_JANELA_DEDUPE_MS` | `600000` | Reenvio da mesma task dentro da janela é recusado. |
| `CLICKUP_RUNNER_TENTATIVAS_MAX` | `3` | Só conta pra falha de **infra**. |
| `CLICKUP_RUNNER_TIMEOUT_MS` | `900000` | Teto duro por execução (15 min). |
| `CLICKUP_RUNNER_ORCAMENTO_USD` | `0` | 0 = não passa `--max-budget-usd`. Na assinatura não há cobrança por execução; ligue só com chave de API. |
| `CLICKUP_RUNNER_RATE_LIMIT` | `30` | Requisições por minuto por IP. |
| `CLICKUP_RUNNER_INTERVALO_MS` | `5000` | Intervalo do loop do worker. |

Segredo nenhum aparece em log — nem em erro de autenticação. O `GITHUB_TOKEN` também não entra
no `~/.gitconfig`: o `credential.helper` é gravado com aspas simples e só lê a env na hora que
o git chama.

## O serviço `ronan_agente` no Easypanel

- **Build**: Dockerfile `apps/agente/Dockerfile`, contexto `.` (raiz do repo).
- **Sem domínio público** — o agente não escuta porta nenhuma.
- **Volume** em `/trabalho` (worktrees por task, fase 2).
- **Não roda migration**: quem versiona o banco é a API. Dois processos aplicando migration no
  boot brigariam por lock à toa.
- Rodar localmente:
  ```bash
  cd apps/api && pnpm build
  CLICKUP_RUNNER_TOKEN=… RUNNER_WORKER_NOME=ronan_agente pnpm start:agente
  ```

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

## Fonte da demanda (trocar de ferramenta)

A ferramenta de gestão ainda está em avaliação, então de onde vem a demanda e pra onde volta o
resultado ficam atrás de uma interface (`fonte/fonte-demanda.ts`):

```ts
interface FonteDemanda {
  ler(taskId, payload): Promise<{ titulo, descricao, url? }>   // enunciado do trabalho
  reportar(taskId, resultado, contexto): Promise<boolean>      // desfecho de volta
}
```

- **`clickup`** (default) — `GET /api/v2/task/{id}` pra ler, comentário pra reportar.
- **`payload`** — lê `{ "titulo": "…", "descricao": "…" }` do corpo do webhook e reporta no log.
  É como se testa o caminho inteiro pelo Postman, sem token e sem ferramenta externa. Aceita
  também `title`/`description` e as variantes aninhadas em `task`.

Trocar de ferramenta = implementar a interface e registrar em `criarFonte`
(`agente-worker.module.ts`), sem tocar em webhook, fila ou worker.

`ler` recebe o payload além do id (a assinatura no plano era só `taskId`) porque o provider
`payload` vive exatamente dele — sem isso não dá pra testar sem a ferramenta no meio.

Falha ao **ler** é falha de infra: reagenda com backoff. Falha ao **reportar** não retenta a
execução (o trabalho já foi feito; repetir sairia caro), só registra.

## Executor real (`EXECUTOR_AGENTE=claude-code`)

Prepara um `git worktree` por task, a partir da base atualizada, e roda o **Claude Code
headless** dentro dele. Autentica por `CLAUDE_CODE_OAUTH_TOKEN` — é a sua assinatura, o mesmo
CLI do terminal. **Não usa a API da Anthropic**, e três coisas garantem isso: o entrypoint dá
`unset ANTHROPIC_API_KEY`, o `agente-main.ts` remove a variável do processo, e o executor nunca
usa `--bare` (a flag que forçaria chave de API).

O `total_cost_usd` que aparece no relato é **estimativa do CLI** do que aqueles tokens
custariam na API — não é cobrança. Por isso `--max-budget-usd` não é passado por padrão
(`CLICKUP_RUNNER_ORCAMENTO_USD=0`); ligue só se estiver usando chave de API.

### Travas

| Trava | Onde |
|---|---|
| Timeout duro por execução (15 min) | worker mata a execução |
| Teto de execuções por janela (5/h, 20/dia) | worker nem reivindica; o item espera |
| Uma execução por vez, uma por task | concorrência + índice único |
| **Agente sem credencial de git** | o subprocesso do `claude` roda com `GITHUB_TOKEN` removido: qualquer `git push` que ele tente falha na autenticação. Quem publica é o worker, e só a branch da task |
| Allowlist de ferramentas | git só de leitura (`status`, `diff`, `log`) |
| Push desligado por padrão | `AGENTE_PUSH=true` liga; até lá o commit fica na branch local e o relato traz o `diff --stat` |
| Merge desligado por padrão | com push ligado, o agente abre o PR e para aí. `AGENTE_MERGE_AUTO=true` faz ele mesclar sozinho — aí **cada execução vira deploy de produção sem revisão humana**. Ligue sabendo disso |
| Limite da assinatura | vira `EXCEDEU_LIMITE`, relata e **não** retenta |

### Fluxo com push ligado

`worktree` → agente trabalha → commit em `feat/{taskId}` → push da branch → **PR aberto contra
`main`** → (opcional) **merge automático + branch apagada** → relato com o link. Reprocessar a
mesma task reaproveita o PR aberto em vez de duplicar. Falha ao abrir o PR não invalida nada: a
branch já está publicada e o relato explica o motivo.

Com `AGENTE_MERGE_AUTO=true`, o merge é tentado 3 vezes: logo após criar o PR o GitHub ainda
está calculando a mesclabilidade e responde 405, que é indistinguível de conflito real na
primeira tentativa. Conflito de verdade deixa o PR **aberto**, e o relato diz isso — o desfecho
seguro é esperar gente, não forçar.

> ⚠️ Com merge automático, **cada execução do agente vai pra produção sem revisão**. Typecheck
> e testes não pegam erro de escopo: uma troca de coluna por outra compila perfeitamente. Foi
> o que aconteceu no PR #2 deste repo (a coluna "Data" da viagem foi substituída em vez de
> somada). Ligue com essa informação na mão.

O `GITHUB_TOKEN` precisa de **Contents: read and write** (push) e **Pull requests: read and
write** (abrir PR). Sem a segunda permissão a branch sobe e o PR falha com 403 — aparece no
relato.

### Envs do executor

| Var | Default |
|---|---|
| `AGENTE_REPO_URL` | `https://github.com/orlonski/ronan.git` |
| `AGENTE_BRANCH_BASE` | `main` |
| `AGENTE_PUSH` | *(vazio = desligado)* |
| `AGENTE_ABRIR_PR` | `true` — abre PR automaticamente **quando o push está ligado**. `false` deixa só a branch |
| `AGENTE_MERGE_AUTO` | *(vazio = desligado)*. `true` mescla o PR sozinho e apaga a branch — **e o merge na `main` dispara o deploy de produção** |
| `AGENTE_MERGE_METODO` | `squash` \| `merge` \| `rebase` |
| `AGENTE_MAX_POR_HORA` / `AGENTE_MAX_POR_DIA` | `5` / `20` |
| `AGENTE_FERRAMENTAS` | `Read,Edit,Write,Grep,Glob,Bash(git status*),Bash(git diff*),Bash(git log*),Bash(pnpm *),Bash(node *),Bash(npx *)` |
| `AGENTE_MODELO` | *(vazio = default do CLI)* |
| `CLICKUP_RUNNER_TIMEOUT_MS` | `900000` (15 min) |

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
