# Padrão de botões (semáforo)

Regra única pra **todas as telas** dos dois apps. Objetivo: motorista/admin
entender **sem pensar**. Baseado em NN/g, Material e Apple HIG.

## Cores = semântica (semáforo)

| Cor | Variante | Quando usar | Exemplos |
|---|---|---|---|
| 🟢 Verde | `success` | Confirmar que algo está **certo** / concluir positivo | "É este", "Sim, foi entregue", "Confirmar" |
| 🟡 Amarelo | `warning` | **Cuidado** antes de agir (pode dar problema) | "Criar novo (pode duplicar)", ações com ressalva |
| 🔴 Vermelho | `destructive` | **Apagar / perigo / negativo forte** (irreversível) | "Excluir", "Descartar", "Marcar divergente", "Sair" |
| ⚪ Contorno | `outline` | **Cancelar / voltar / secundário** | "Cancelar", "Voltar" |
| 🟠 Laranja (motorista) / Azul (dashboard) | `default` | Ação principal **neutra** de rotina | "Salvar", "Nova viagem", "Continuar" |

- **Verde é reservado** pra "confirmar/certo" — NÃO usar em toda ação, senão perde
  o sentido (regra do NN/g: não abusar de cor semântica).
- **Vermelho é reservado** pra destrutivo/perigo — nunca pra ação normal (senão
  "assusta à toa"). E um "excluir" **nunca** pode ter cor neutra.

## Texto

- **Verbo do que acontece**, nunca "Sim / Não / OK". Rótulo ambíguo faz parar pra
  pensar e errar (crítico pra motorista leigo). Ex.: "Excluir viagem" > "OK".
- Curto e direto.

## Layout

- **Só UMA ação principal por tela/diálogo** (a mais forte). O resto é secundário.
- **Ordem sempre igual**: cancelar/secundário à ESQUERDA, principal à DIREITA.
  Quando empilhado: principal EM CIMA. Consistência > lado "certo".
- **Cor nunca sozinha**: sempre com texto claro (e ícone quando ajuda) — ~8% dos
  homens têm daltonismo.
- Alvo de toque generoso no app do motorista (dedo grosso, sol na tela).

## Como usar no código

Os dois apps têm o componente `Button` com as variantes acima:
`<Button variant="success">`, `variant="warning"`, `variant="destructive"`,
`variant="outline"`, `variant="default"`.
- motorista-app: `apps/motorista-app/components/ui/button.tsx` (tokens no
  `tailwind.config.js`: success/warning/destructive).
- dashboard: `apps/dashboard/src/components/ui/button.tsx`.

Evitar cores ad-hoc (`bg-amber-500`, `bg-green-600`) direto no botão — usar a
variante, pra ficar tudo igual e fácil de mudar num lugar só.
