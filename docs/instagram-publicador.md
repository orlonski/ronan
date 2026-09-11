# Publicador do Instagram — como ligar

O código está pronto e em produção, **desligado**. Falta só a credencial da Meta.
Este documento é o caminho do zero até o primeiro post automático.

O que já existe (feito em 11/09/2026):

| Ativo | Valor |
|---|---|
| Página do Facebook | **Movatruck** |
| Portfólio empresarial | `1033707445952025` |
| Conta Instagram | **@movatruck**, conectada à Página |
| **IG User ID** | **`17841432891930346`** |

O IG User ID não é segredo — é identificador, como um CNPJ. O token é que é.

---

## 1. Criar o app no Meta for Developers

1. Entre em <https://developers.facebook.com/apps> com a mesma conta do Facebook que
   administra a Página Movatruck.
2. **Criar app**. Se pedir caso de uso, escolha **Outro**; no tipo, **Empresa**.
3. Nome do app: `Movatruck Publicador` (é interno, ninguém vê).
4. **Vincule ao portfólio empresarial Movatruck** — não ao do loc.fit. Esse campo
   aparece na criação; se pular, dá pra ajustar depois em Configurações do app.
5. Deixe o app em **modo de desenvolvimento**. Não peça App Review, não peça
   verificação de negócio: publicar na própria conta funciona com Standard Access,
   que é automático.

Guarde o **ID do app** — vai precisar no passo 3.

## 2. Adicionar o produto do Instagram

Dentro do app, em **Produtos**, adicione **Instagram** (o caminho com login do
Facebook, o mesmo que a doc chama de *Instagram API with Facebook Login*). É esse que
dá acesso ao System User token; o caminho com login do Instagram só oferece token de
60 dias, que exigiria um cron de renovação.

## 3. Criar o usuário do sistema e gerar o token

O System User existe justamente pra isso: um "usuário" que é do negócio, não de uma
pessoa. O token dele sobrevive a troca de senha e à saída de gente da empresa.

1. <https://business.facebook.com/settings/system-users?business_id=1033707445952025>
2. **Adicionar** → nome `publicador-instagram` → função **Administrador do sistema**.
3. Em **Adicionar ativos**, dê a esse usuário:
   - a Página **Movatruck** — controle total
   - a conta do Instagram **@movatruck** — controle total
   - o app **Movatruck Publicador**
4. **Gerar novo token** → escolha o app → marque as permissões:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_read_engagement`
   - `pages_show_list`
   - `business_management`
5. Na validade, escolha **o token que nunca expira**.
6. **Copie na hora.** A Meta mostra uma vez só.

## 4. Colocar no Easypanel

No serviço `ronan-api`, em variáveis de ambiente:

```
INSTAGRAM_ACCESS_TOKEN=<o token gerado>
INSTAGRAM_IG_USER_ID=17841432891930346
PUBLIC_API_URL=https://ronan-api.2azr6q.easypanel.host
```

`PUBLIC_API_URL` é a base que monta a URL da arte — a Meta faz um GET nela pra baixar
a imagem, então precisa ser o host público, com HTTPS. Sem ela, o link sai apontando
pra lugar nenhum e a publicação falha na primeira fase.

Reinicie o serviço. No log do boot deve aparecer o modo em que ficou:

```
[InstagramConfig] {"evento":"instagram-config","modo":"SOMBRA (monta o container e não publica)",...}
```

Se aparecer `Publicador do Instagram DESLIGADO (falta ...)`, uma das duas variáveis não
chegou.

## 5. Ver funcionando sem publicar nada

O publicador estreia em **modo sombra**: monta o post na Meta e não publica. É a mesma
estreia da conferência de ticket — dá pra ver a integração inteira funcionando com o
feed intacto.

1. No painel, **Instagram da Movatruck** (menu Operação). A tela mostra os dois
   interruptores: credencial e publicação.
2. Ligue `instagramAtivo` na `ConfiguracaoPlataforma` (hoje pelo banco; a tela só lê).
3. Agende um post e espere o cron (roda de 5 em 5 minutos).
4. No log, `[SOMBRA] Container ... pronto` significa que a Meta aceitou a imagem e a
   legenda. É o teste que importa: se a arte estava acessível e o formato passou.

## 6. Ligar de verdade

Só depois que o modo sombra montar um container sem erro:

```
INSTAGRAM_MODO_SOMBRA=false
```

Reinicie. O próximo post agendado sai no feed.

---

## Quando algo falhar

O post não some: ele fica na fila com o motivo na tela.

| Sintoma | O que é |
|---|---|
| `code=190` | token inválido ou revogado. Gere outro. |
| `code=9` | teto de posts em 24h da Meta. Espera sozinho. |
| `code=100` com "image_url" | a Meta não conseguiu baixar a arte: confira `PUBLIC_API_URL` e se a API está de pé. |
| "A arte não está mais no storage" | o MinIO perdeu o objeto. Reenvie o post. |
| Status `INDETERMINADO` | o processo caiu no meio da publicação e não dá pra saber se saiu. **Não** retenta sozinho — a reconciliação das 4h20 pergunta à Meta e decide. |

## O que NÃO fazer

- **Não** dê domínio público ao MinIO pra "resolver" a URL da imagem. O bucket nasce
  com leitura anônima (`mc anonymous set download` no compose de produção) e hoje só
  está a salvo porque não tem domínio. Exposto, todo ticket e documento de motorista
  de todas as contas vira baixável por quem souber a chave.
- **Não** volte a publicar dirigindo o navegador. Viola os Termos do Instagram — o
  texto diz que estar logado na própria conta não é defesa — e já custou uma
  verificação anti-bot na conta.
- **Não** conceda `marketing.*` a papel de empresa cliente. É recurso de plataforma:
  o que sai dali vai pro feed da Movatruck.
