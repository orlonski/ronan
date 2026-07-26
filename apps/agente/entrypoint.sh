#!/bin/sh
# Entrypoint do serviço `ronan_agente`.
#
# Prepara o ambiente e passa a bola pro CMD (o worker). Tudo aqui é
# idempotente: o container reinicia a cada deploy.
set -e

# 1. A autenticação do Claude Code neste serviço é por CLAUDE_CODE_OAUTH_TOKEN.
#    Com ANTHROPIC_API_KEY presente, o CLI usaria a chave de API — outra conta,
#    outra cobrança — sem avisar. Some com ela antes de qualquer coisa.
unset ANTHROPIC_API_KEY

# 2. Credencial do git via GITHUB_TOKEN. O helper é gravado com aspas SIMPLES:
#    a expansão acontece na hora que o git chama o helper, então o token nunca
#    é escrito no ~/.gitconfig (que sobrevive no volume e apareceria em log de
#    diagnóstico).
if [ -n "$GITHUB_TOKEN" ]; then
  git config --global credential.helper \
    '!f() { printf "username=x-access-token\npassword=%s\n" "$GITHUB_TOKEN"; }; f'
  git config --global user.name "${GIT_AUTOR_NOME:-ronan-agente}"
  git config --global user.email "${GIT_AUTOR_EMAIL:-agente@schaba.com.br}"
  # Worktree em diretório de volume: sem isso o git recusa repo "de outro dono".
  git config --global --add safe.directory '*'
  echo "[entrypoint] credencial do git configurada (token vem do ambiente, não do gitconfig)"
else
  echo "[entrypoint] AVISO: GITHUB_TOKEN ausente — push de branch vai falhar quando o executor real entrar"
fi

# 3. Diagnóstico de boot, sem imprimir valor de segredo nenhum.
echo "[entrypoint] executor=${EXECUTOR_AGENTE:-stub} worker=${RUNNER_WORKER_NOME:-agente@$(hostname)}"
echo "[entrypoint] claude=$(command -v claude >/dev/null 2>&1 && claude --version 2>/dev/null || echo 'não instalado')"
echo "[entrypoint] oauth=$([ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] && echo configurado || echo AUSENTE)"

exec "$@"
