# Playbook de Reels — @movatruck

Pesquisa de 13/09/2026, feita por três frentes em paralelo: mecânica do algoritmo,
benchmark do nicho e viabilidade de produção. Fontes no fim.

Vale reler antes de escrever roteiro. O que está aqui não é opinião de quem
escreveu — é o que as fontes sustentam, e o que elas **não** sustentam está
marcado como tal.

## A conclusão que manda em tudo

**Otimize para o compartilhamento por DM, não para o like.**

O sinal que mais alcança quem ainda não segue é o *send* — alguém mandar o Reel
no privado pra outra pessoa. As fontes estimam peso de 3 a 5 vezes o de um like.
Depois vêm tempo total assistido (incluindo replay) e saves. Like é o mais fraco
dos três, e pesa mais pra quem já segue do que pra alcançar gente nova.

Consequência prática: **toda peça precisa de um motivo explícito pra ser mandada
pra alguém.** "Manda isso pro teu sócio que ainda fecha viagem em planilha" é
estratégia, não CTA decorativo. Um Reel tecnicamente bonito que ninguém repassa
rende menos que um feio que roda no grupo de WhatsApp.

## Onde a pesquisa se contradiz, e o que fazer

O benchmark do nicho é duro com a gente: nas contas de caminhoneiro que crescem
no Brasil — @revistacaminhoneiro, @falacaminhoneiro, @cavalocavalinho,
@mit_muricoca — **o que prende é a pessoa, não a informação**. Humor de estrada,
bastidor cru, câmera na mão dentro da cabine. E o nicho detecta encenação na
hora: "estúdio limpo demais ou ator genérico fingindo ser motorista" é apontado
como erro que queima a conta.

Nossa restrição hoje é exatamente o oposto: sem rosto e sem voz gravada.

Então seja honesto sobre o teto:

- **Para o dono de transportadora**, dá pra competir bem sem rosto. Esse público
  responde a número, processo e erro caro. Tela do produto resolvendo um caos que
  acabou de ser mostrado é formato comprovado (é o que a @canva faz: a interface
  vira o personagem).
- **Para o motorista**, que é onde está o volume de seguidor neste nicho, vamos
  render abaixo do potencial enquanto não houver uma pessoa real. Nenhuma
  tipografia cinética substitui um motorista falando de dentro da cabine.

Isso não é motivo pra não começar. É motivo pra não se enganar com o resultado
dos primeiros meses, e pra tratar "arrumar um rosto" como a alavanca de maior
impacto que existe — de preferência um motorista parceiro de verdade, não ator.

## Formato

- **Duração**: 15–30s pro educativo, que é o nosso caso. A faixa 45–60s aparece
  com maior engajamento médio em contas de negócio, mas acima de 60s a taxa de
  conclusão cai de 20% a 50%. Reels alcançam não-seguidores até 90s.
- **O gancho tem 3 segundos**, e até metade do abandono acontece neles. A promessa
  precisa estar inteira até o segundo 3.
- **Texto na tela desde o primeiro quadro (0,5s)**, 5 a 8 palavras, terço superior,
  alto contraste. Cerca de 60% assiste sem som: fala sozinha não segura ninguém.
- **Estrutura que converte**: gancho (0–3s) → agitação do problema (4–10s) →
  demonstração ou prova (11–20s) → CTA (últimos 5–10s).
- **Legenda queimada**: 5–7 palavras por linha, no máximo 2 linhas simultâneas,
  terço inferior, branco com contorno escuro. Reels legendados compartilham ~16%
  mais.

## Áudio

Não existe evidência de penalidade a Reel mudo — o que as fontes descrevem é o
contrário: clipe silencioso com legenda embutida performa igual ou melhor em feed
que rola sem som. Áudio em alta ajuda descoberta nas primeiras 24–48h, mas é
bônus, não mecanismo central, e material de terceiro não entra no perfil da marca.

Voz sintética em PT-BR já não soa robótica e tem sotaque brasileiro convincente
(ElevenLabs, licença comercial a partir do plano pago). Entra como narração sobre
tela e motion — nunca como avatar falando, que é onde o nicho estranha.

## Mitos que a pesquisa matou

- **Hashtag não aumenta alcance.** Mosseri confirmou publicamente. Serve de
  categorização, não de crescimento. Continuamos usando poucas e pertinentes, sem
  esperar nada delas.
- **Capa bonita não move o algoritmo** — move clique no perfil e no grid, que é
  outro problema (e importa, só não é distribuição).
- **Like não é o alvo.** Ver a conclusão lá em cima.

## O que mata alcance de verdade

- **Marca d'água de outro app** (TikTok, CapCut): queda relatada de 40% a 80%. A
  Meta cruza marca d'água, impressão digital do áudio, hash do vídeo e padrão de
  legenda — só apagar a marca não resolve. **Nunca republicar vídeo de fora.**
- **Isca de engajamento** ("comenta SIM", "marca 3 amigos"): rebaixamento explícito
  e cumulativo.
- Seguidor comprado contamina as taxas por alcance e faz o mesmo estrago.

## Catálogo de formatos

| Formato | O que é | Público |
|---|---|---|
| Problema → solução em 15s | mostra o caos (planilha, papel, ligação) e corta pro resultado | dono |
| Erro caro | "o erro que te custa R$ X por mês" | os dois |
| Lista rápida | "3 coisas que…", corte a cada 3s, texto na tela | os dois |
| Antes/depois | comparação visual direta da operação | dono |
| Direito do motorista | regra do sistema contada como direito dele | motorista |
| Bastidor / atmosfera | pátio às 4h, som ambiente, sem produção | motorista |

Os dois últimos são os que mais precisam de pessoa real. Enquanto não houver,
fazemos com imagem de arquivo e som ambiente — cientes de que rendem menos.

## Como produzir (o caminho escolhido)

**Captura de tela real + tipografia cinética + legenda queimada.** Narração
sintética é opcional e deve ser testada contra a versão muda.

Custo baixíssimo (a stack já existe: Playwright/Maestro + ffmpeg), credibilidade
máxima (é o app funcionando), risco quase zero.

**Vídeo gerado por IA fica de fora como protagonista.** Os modelos de hoje ainda
embaralham texto miúdo e detalhe fino — placa, número de eixo, letreiro de posto,
painel. É exatamente o que este público reconhece de olhos fechados. Serve, no
máximo, como fundo genérico (estrada vazia, céu), nunca em close.

Banco de imagem tem a mesma armadilha: a maioria do acervo de "caminhão em
estrada" é rodovia americana, e destoa. Quando não achar material brasileiro
convincente, prefira a tela do app.

## A regra de sempre

**Nada entra no Reel que o app não faça.** Vale igual pra vídeo: a rede é cortada
de verdade, o dado da tela é o dado real. Ver `README.md` desta pasta.

E o tom não muda por ser vídeo: motorista é **parceiro autônomo**. Nada de
"monitore sua frota", "controle seus motoristas", "não deixe seu motorista
sumir" — é o oposto do que a marca é, e o nicho pune.

## Medição

A API do Instagram **não devolve "seguidores ganhos" por Reel** — esse número só
existe pra post de feed. Pra Reel vêm alcance, views, saves, compartilhamentos,
tempo médio assistido e taxa de pulo.

E a série diária de `follower_count` só libera a partir de **100 seguidores**. Com
11, ainda não dá.

O que dá pra fazer hoje: puxar o total de seguidores todo dia (campo simples,
funciona em qualquer tamanho) e cruzar com o que saiu naquele dia. Com um post por
dia a leitura fica limpa o bastante pra decidir formato por número em vez de
opinião.

## Fontes

Mecânica: [dataslayer](https://dataslayer.ai) · [Socialinsider via socialbu](https://socialbu.com) ·
[opus.pro](https://www.opus.pro/blog/instagram-reels-caption-subtitle-best-practices) ·
[buffer](https://buffer.com) · [kontentino](https://kontentino.com) ·
[cut.pro](https://cut.pro) (marca d'água)

Nicho: [@revistacaminhoneiro](https://www.instagram.com/revistacaminhoneiro/) ·
[@falacaminhoneiro](https://www.instagram.com/falacaminhoneiro/) ·
[@cavalocavalinho](https://www.instagram.com/cavalocavalinho/) ·
[@mit_muricoca](https://www.instagram.com/mit_muricoca/) ·
[B2B SaaS no Instagram](https://www.kometmedia.com/blogs/8-b2b-saas-companies-killing-it-on-instagram)

Produção: [ElevenLabs PT](https://elevenlabs.io/pt/text-to-speech/portuguese) ·
[comparativo de vídeo por IA](https://www.atlascloud.ai/blog/tips/cheapest-ai-video-generation-api-2026) ·
[onde os modelos quebram](https://www.pippit.ai/pt-br/resource/help-center/ai-video-model-generation-error-solution)

Medição: [Insights API](https://www.upgrow.com/blog/instagram-insights-api-features-use-cases) ·
[follower count](https://www.keyapi.ai/blog/instagram-api-follower-count/)
