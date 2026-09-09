# Captação de leads — base legal e operação

Documento vivo. Existe por dois motivos: a LGPD exige que quem trata dado
pessoal sob **legítimo interesse** tenha o teste documentado (art. 10 c/c o Guia
Orientativo da ANPD de 02/02/2024), e porque daqui a seis meses ninguém lembra
por que uma coluna existe.

Atualizado em 09/09/2026.

---

## 1. O que a gente trata, e o que não é dado pessoal

| Dado | É dado pessoal? |
|---|---|
| CNPJ, razão social, CNAE, município, CEP | **Não** — é da empresa |
| `contato@transportadora.com.br`, telefone da recepção | **Não** — não identifica pessoa natural |
| Nome do sócio, `joao@transportadora.com.br`, celular do dono | **Sim** |
| Empresário individual (razão social = CNPJ + nome da pessoa) | **Sim, na prática** |

Consequência direta no filtro do RNTRC: a prospecção ativa exclui **TAC**
(autônomo, CPF) e **empresário individual**. Não é escrúpulo — é que o alvo
comercial certo (empresa com frota, que tem dor de gestão) coincide com o alvo
jurídico limpo. Filtrar `categoria = ETC` e descartar razão social que começa
com dígito resolve os dois de uma vez.

## 2. Base legal

**Legítimo interesse** — art. 7º, IX c/c art. 10, I da LGPD ("apoio e promoção
de atividades do controlador"). Não é consentimento, e não precisa ser: exigir
opt-in prévio pra apresentar um software B2B a uma empresa inviabilizaria
qualquer venda consultiva, e a lei previu isso.

O que a base cobra em troca, e como a gente cumpre:

| Exigência | Onde está resolvido |
|---|---|
| Finalidade legítima, concreta e real | Apresentar o Movatruck a transportadoras que têm o problema que ele resolve. Não é venda de lista, não é perfilamento, não é enriquecimento pra terceiro. |
| Necessidade — o mínimo suficiente | Só nome, empresa, telefone, e-mail e cidade. Nada de CPF, nada de dado sensível. O schema Zod em `shared-types/src/captacao.ts` é o teto: o que não está lá não entra. |
| Balanceamento com a expectativa do titular | Uma transportadora espera ser procurada por fornecedor do setor. Não esperaria ter o dado revendido — e a gente não revende. |
| Transparência (art. 10, §2º) | Aviso no próprio formulário + link pra política de privacidade, visível antes de enviar. |
| Direito de oposição (art. 18, §2º) | Coluna `optOut` no model `Lead`. Vale pra **todos os canais ao mesmo tempo**. |
| Origem do dado (e art. 43 do CDC) | Colunas `origemDado` e `coletadoEm`, preenchidas em toda entrada. |

## 3. As duas portas de entrada, e por que são diferentes

**Formulário do site** (`POST /publico/captacao/lead`) — o titular preencheu
sozinho. É a origem mais forte que existe: `origemDado` grava
"preenchido pelo próprio titular" e não há discussão de base legal.

**Prospecção ativa** (a construir) — o dado veio de fonte pública. Aqui
`origemDado` **é obrigatório** e tem que dizer qual fonte e qual data, no nível
de "RNTRC/ANTT, arquivo de 07/2026". Sem isso a gente não sabe responder "como
vocês conseguiram meu telefone", que é a pergunta que sempre vem.

Fontes admitidas: dados abertos da ANTT (licença CC-BY) e da Receita Federal
(Decreto 8.777/2016, "permissão irrestrita de reuso"), e diretórios públicos do
setor. **Não** se compra lista pronta — foi exatamente a conduta punida na
primeira sanção da ANPD ao setor privado (caso Telekall, 06/07/2023).

## 4. Analytics: anônimo de propósito

`EventoSite` não é dado pessoal, e isso é uma decisão de projeto, não um acaso:

- sem cookie — por isso o site não tem banner de consentimento;
- id de sessão em `sessionStorage`, morre quando a aba fecha; não liga duas
  visitas da mesma pessoa;
- sem IP, sem user-agent, sem resolução de tela, sem fingerprint;
- a query string nunca é enviada, só o caminho — link com e-mail no parâmetro
  não vaza pra dentro da nossa base;
- respeita Do Not Track e Global Privacy Control.

**Se um dia isso precisar identificar alguém, a resposta certa é outra tabela,
nunca uma coluna a mais aqui.** No minuto em que `eventos_site` ganhar um campo
identificável, toda a analytics vira base de dados pessoais.

## 5. O que a gente não faz

| Não | Por quê |
|---|---|
| Primeiro contato frio por WhatsApp | A política da Meta exige que a pessoa tenha dado o número **e** a permissão. Bloqueio marcado como "não me cadastrei" derruba a qualidade do número em 7 dias. |
| Prospectar pelo número que atende motorista | Se cai, cai código de acesso e comprovante de todos os clientes junto. No canal não-oficial não há apelação. |
| Comprar lista | Marco Civil art. 7º, VII; e o Gmail proíbe explicitamente. |
| Automatizar LinkedIn | Viola a seção 8.2 do contrato. A hiQ ganhou no criminal e perdeu no contratual: US$ 500 mil e fim da empresa. |
| Guardar lead frio pra sempre | Contraria a necessidade (art. 10, §1º). Sem interação, descarta. |

## 6. Pendências

- [ ] Domínio separado pra e-mail de saída, com SPF/DKIM/DMARC próprios. **Nunca**
      o `movatruck.com.br` — reputação queimada em outbound não pode derrubar o
      e-mail que entrega comprovante.
- [ ] Número de WhatsApp separado do operacional.
- [ ] Encarregado (DPO) indicado e publicado — foi uma das infrações no caso Telekall.
- [ ] Rotina de descarte de lead sem interação.
- [ ] Consulta ao "Não Me Ligue" do Procon-SP antes de campanha de telefone.
      Ele aceita CNPJ, e a responsabilidade é solidária com quem a gente contratar.

## 7. Nota de infraestrutura: CORS

O formulário é `fetch` de origem cruzada (`www.movatruck.com.br` → API). Hoje
`CORS_ORIGINS=*` em produção, o que reflete a origem e funciona. **Quando o CORS
for apertado** (está na lista de segurança), o domínio do site institucional tem
que entrar na lista explicitamente — senão o formulário para de enviar em
silêncio, e ninguém percebe porque o site continua no ar.
