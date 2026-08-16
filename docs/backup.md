# Backup e restauração do Ronan

Cópia diária do banco (Postgres) e das fotos (MinIO) pra fora do Contabo.

**Por que fora do Contabo:** backup no mesmo servidor não protege contra o
cenário mais provável de perda total — o servidor morrer, a conta ser suspensa,
o disco corromper. Cópia que morre junto com o original não é cópia.

## A regra que governa este backup

**O script nunca apaga nada no destino.**

As credenciais do destino ficam dentro do servidor. Todo poder de apagar que o
script tiver é poder que um invasor herda junto — e destruir as cópias antes de
sequestrar o original é o passo 1 do manual de ransomware. Por isso:

- `backup.sh` só grava. Não tem `rm` nenhum.
- A limpeza dos arquivos antigos é **regra de ciclo de vida do R2**, configurada
  do lado de lá, onde nem o script nem quem entrar no servidor alcança.
- O espelho das fotos roda **sem `--remove`**: alguém apagando as fotos no MinIO
  não faz o backup replicar o apagamento na madrugada seguinte.

Consequência aceita de propósito: sem a regra de ciclo de vida, o bucket cresce
pra sempre. Guardar demais custa alguns reais por mês; apagar de menos custa a
empresa.

## O que fazer (uma vez)

### 1. Cloudflare R2

1. Criar um bucket — sugestão de nome: `ronan-backups`.
2. Criar um **API Token** com acesso a esse bucket. Escolha o **menor escopo que
   ainda permita gravar**; se o painel oferecer Object Lock ou retenção
   imutável, ative — é o que impede que um token roubado destrua o histórico.
   As opções do R2 mudam de tempos em tempos: confira o que está disponível no
   painel na hora de criar.
3. Configurar **Object lifecycle rule** no bucket: apagar objetos com mais de
   N dias (90 é um ponto de partida razoável). É isto que substitui a limpeza
   que o script deliberadamente não faz.
4. Guardar o Access Key e o Secret Key — eles vão nas variáveis abaixo.
   **Nunca colar essas chaves em chat, issue ou commit.**

### 2. Serviço de backup no Easypanel

Criar um **App** novo apontando pra este repositório, com:

- Dockerfile: `apps/backup/Dockerfile`
- Sem domínio público (não serve HTTP)
- Sem réplica rodando: ele é disparado por Cron, não fica de pé

Variáveis de ambiente:

| Variável | Valor |
|---|---|
| `POSTGRES_HOST` | hostname interno do Postgres no Easypanel |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | credenciais do banco |
| `BACKUP_S3_ENDPOINT` | `https://<CONTA>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | `ronan-backups` |
| `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` | do token do R2 |
| `MINIO_ENDPOINT` | hostname interno do MinIO (ex.: `http://ronan-minio:9000`) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | credenciais do MinIO |
| `MINIO_BUCKET` | `ronan-tickets` |
| `BACKUP_PING_URL` | (ver seção 3) |

Sem as `MINIO_*` o backup roda **só do banco** e avisa que as fotos ficaram de
fora — não falha em silêncio, mas também não protege as fotos.

### 3. Monitor de "parou de rodar" — não pule este

Este é o item que separa ter backup de achar que tem.

Se o container do cron não subir, se o Easypanel esquecer o agendamento, se a
imagem quebrar num deploy — **nenhum alerta sai**, porque nenhum script chegou a
rodar pra mandar alerta. O jeito de detectar ausência é alguém esperando por um
sinal que não veio.

Criar um check gratuito em [healthchecks.io](https://healthchecks.io) (ou
equivalente) com período de 1 dia e folga de algumas horas, e pôr a URL em
`BACKUP_PING_URL`. O script pinga `/start` ao começar, a URL limpa ao terminar
bem, e `/fail` quando falha. Se parar de pingar, você recebe e-mail.

### 4. Cron no Easypanel

Agendar `/scripts/backup.sh` no serviço criado acima:

```
0 3 * * *
```

3h da manhã, horário do servidor (UTC). A primeira execução é lenta — sobe o
acervo inteiro de fotos. As seguintes levam segundos, porque o espelho é
incremental.

## Testar (e repetir de vez em quando)

Backup que nunca foi restaurado não é backup, é esperança. Rodar no serviço de
backup do Easypanel:

```bash
/scripts/restaurar-backup.sh
```

Ele baixa o backup mais recente, restaura numa base descartável
(`ronan_restore_teste`) e imprime a contagem de viagens, motoristas, fotos,
pedágios, abastecimentos e fechamentos, mais a data da viagem mais recente.

**Conferir os números contra o que o sistema tem hoje.** Se vier zerado, ou se a
viagem mais recente for de semanas atrás, o backup não presta — e isso precisa
ser resolvido naquele dia, não no dia do desastre.

Vale repetir esse teste a cada poucos meses, e sempre depois de mexer no banco
ou na infra.

Outros usos:

```bash
/scripts/restaurar-backup.sh --listar              # o que existe guardado
/scripts/restaurar-backup.sh banco/2026/08/x.dump  # testar um específico
```

## No dia do desastre

1. **Não mexa no servidor comprometido.** Se foi invasão, tudo que estiver lá é
   suspeito, credenciais incluídas.
2. Subir um Postgres novo (Easypanel novo, ou outro provedor).
3. Restaurar:
   ```bash
   RESTAURAR_EM_PRODUCAO=sim-eu-tenho-certeza /scripts/restaurar-backup.sh
   ```
   A confirmação é obrigatória porque este modo **apaga** o conteúdo do banco de
   destino. Sem a trava, um comando errado no meio de um incidente termina de
   matar o que sobrou.
4. Restaurar as fotos de volta pro MinIO:
   ```bash
   mc mirror destino/ronan-backups/fotos/ronan-tickets origem/ronan-tickets
   ```
5. Apontar a API pro banco novo e subir.

O que se perde no pior caso: os lançamentos feitos entre o último backup (3h) e
o desastre. Como os apps do motorista são offline-first, boa parte deles ainda
está no outbox dos celulares e sobe sozinha quando a API voltar.

## O que este backup NÃO cobre

Dito na cara para não virar falsa sensação de segurança:

- **Invasão do próprio R2.** Se a conta Cloudflare for comprometida, as cópias
  estão lá. Ative 2FA na conta.
- **Segredos vazados.** Backup restaura dados, não conserta credencial exposta.
  Depois de qualquer incidente, rotacionar tudo: JWT, banco, MinIO, chaves de
  IA, token da Evolution.
- **Corrupção que passa despercebida por mais tempo que a retenção.** Se um bug
  corromper dados hoje e você notar depois do prazo da regra de ciclo de vida,
  não há versão boa pra voltar. É por isso que a retenção não deve ser curta.
- **O código.** Está no GitHub, que já é a cópia — mas vale conferir que existe
  ao menos um clone completo fora da sua máquina.
