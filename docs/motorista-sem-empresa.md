# O app para o motorista sem empresa

Análise pedida em 09/09/2026, depois da primeira entrega (o caderninho de gastos)
ficar aquém do esperado: o que se queria era o motorista **trabalhando** no app
sem empresa, não anotando despesa.

Restrição do dono, que vale como regra pra tudo aqui: **não estragar o formato
atual do backend e do banco**, e implementar **só no app nativo**.

## 1. Quem é esse motorista

Quatro perfis chegam à tela "sem empresa", e eles querem coisas diferentes:

| perfil | como chega | o que ele quer do app |
|---|---|---|
| **Autônomo de verdade** (tem o caminhão, pega frete de quem aparece) | baixou por conta própria | saber se o frete compensa, e ter o registro do que rodou |
| **Roda pra uma empresa que não usa o Movatruck** | indicação de outro motorista | o mesmo, mais um jeito de mostrar ao contratante o que fez |
| **Está entre empresas** | já usava com uma transportadora que saiu | não perder o histórico dele |
| **Foi convidado e ainda não aceitou** | link/WhatsApp da empresa | só aceitar — já resolvido |

Os três primeiros têm o mesmo núcleo: **o frete é dele, e ninguém está olhando
por cima do ombro.** É o oposto do motorista vinculado, onde o app existe pra
alimentar o fechamento da transportadora.

## 2. O que dói no dia dele

Em ordem, pelo que o trabalho é de fato:

1. **"Esse frete vale a pena?"** — a conta que ele faz no papel, no boné ou não
   faz: quanto vou rodar, quanto de pedágio, quanto de diesel, sobra quanto.
   Errar isso é rodar de graça, e acontece toda semana.
2. **"Quanto eu ganhei este mês?"** — o que entrou menos o que saiu. Hoje vive
   em caderno, planilha ou lugar nenhum.
3. **"Preciso comprovar o que rodei pra receber."** — o contratante quer saber o
   que foi feito; o motorista quer um papel que sustente a cobrança.
4. **"Não posso perder o comprovante."** — ticket de balança, cupom do posto,
   nota do pedágio. Papel no porta-luvas até sumir.
5. **"Meu documento vence e eu esqueço."** — CNH, licenciamento, ANTT.
6. **"Onde tem frete?"** — o maior de todos, e o único que não é nosso.

## 3. O que já existe e serve — sem inventar nada

É aqui que a análise deixa de ser palpite. Três peças da casa **já não pertencem
a nenhuma empresa**:

| peça | estado | serve ao sem-empresa? |
|---|---|---|
| `GeocodingCache` (endereço → coordenada) | **já é tabela global** (`MODELS_GLOBAIS`) | sim, direto |
| `PedagioRodovia` (~950 praças do OSM) | **já é tabela global**; o app nativo já baixa a lista pra usar offline | sim, direto |
| OSRM (`RoteamentoService`) | `calcularKm` recebe **id de `Local`** (catálogo da empresa), mas por dentro chama `consultarOsrm(lat,lng,lat,lng)` | sim, expondo a variante por coordenada |
| `GeocodingController` | `@Roles("ADMIN_USER","MOTORISTA")` | sim, acrescentando `IDENTIDADE` |

Ou seja: **"Curitiba → Joinville" vira km + pedágios da rota sem tocar em
catálogo de empresa, sem tabela nova e sem duplicar lógica.** O que falta é
expor, no nível certo, o que já está escrito — o oposto de gambiarra.

O que **não** serve como está, e por quê:

- `Viagem`, `Abastecimento`, `Local`, `Material`, `Cliente`, `Veiculo`: todos
  exigem `contaId` (a trava) e se apoiam no catálogo da empresa. Reaproveitar
  significaria inventar uma conta-fantasma — e aí o dado dele nasceria dentro de
  uma "empresa" que não existe, com migração impossível depois (a trava proíbe
  mover linha entre contas). **Não fazer.**
- OCR de ticket (`ia/`): cada leitura custa dinheiro, e hoje quem paga é a
  empresa (`Conta.iaLeituraTicket`). Sem empresa não há quem pague.
- `MotoristaDocumento`: é por vínculo. Documento de CNH é da pessoa, não da
  empresa — mas mexer nisso agora mudaria uma tabela em uso.

## 4. As candidatas

Cada uma com o que exige do backend, porque essa é a restrição.

### A. "Vale a pena esse frete?" — a calculadora
Ele digita de onde e pra onde. O app devolve **km**, **pedágio estimado** (as
praças na rota) e **diesel estimado** (usando o consumo e o preço/litro que ele
mesmo já lançou no caderninho). Ele digita quanto estão pagando e vê o que sobra.

- **Valor pro motorista:** é a decisão que ele toma toda semana, com dinheiro
  real em jogo. Nenhum concorrente de caderninho faz isso.
- **Valor pra plataforma:** é o motivo de abrir o app mesmo sem empresa — o que
  mantém a base viva até uma transportadora convidá-lo.
- **Backend:** dois métodos novos em serviços existentes (rota por coordenada,
  pedágios por geometria) + `IDENTIDADE` no geocoding. **Zero tabela nova.**
- **Risco:** baixo. Estimativa é estimativa — a tela precisa dizer isso.

### B. O frete que ele fez — o registro
A calculadora vira lançamento: "aceitei esse frete" grava origem, destino, carga,
km, o que recebeu. O mês fecha com quantas viagens, quantos km, quanto entrou,
quanto saiu, quanto sobrou.

- **Valor:** é o que o dono esperava desde o começo, e o que dá sentido ao
  caderninho que já existe.
- **Backend:** **uma tabela nova** (`ViagemPessoal`), sem `contaId`, chaveada por
  `identidadeId`, no mesmo padrão do `LancamentoPessoal` que já está em produção.
  Aditiva: não altera nenhuma tabela existente.
- **Risco:** baixo.

### C. Comprovante pro contratante
Uma imagem/link com o que ele rodou no período — pra mandar no WhatsApp de quem
vai pagar.

- **Valor:** é o que fecha o ciclo do dinheiro. Alto, mas depende de B existir.
- **Backend:** o compartilhamento atual (`ViagemCompartilhamento`) é por conta e
  por viagem da empresa; aqui seria um caminho novo, público, por identidade.
- **Risco:** médio — link público exige o mesmo cuidado do comprovante atual.

### D. Documentos que vencem (CNH, licenciamento, ANTT)
Aviso quando falta pouco.

- **Valor:** médio e constante; não é o que faz ele abrir o app.
- **Backend:** tabela nova por identidade (a atual é por vínculo). Aditiva.

### E. Guardar foto do comprovante
Ticket de balança, cupom do posto, nota do pedágio.

- **Valor:** médio-alto (é o medo de perder o papel).
- **Backend:** o MinIO hoje é organizado por conta; guardar por identidade é
  caminho novo de upload. Custo maior que parece.

### F. Marketplace de frete
**Não.** Valor altíssimo pro motorista e custo/risco fora de escala: é outro
produto (oferta, reputação, pagamento, disputa), não uma tela.

## 5. Recomendação

**Fase A + B juntas, como um fluxo só.** Separadas elas são meias-features: a
calculadora sem registro é uma curiosidade, e o registro sem a calculadora é
digitação. Juntas viram o ciclo do autônomo:

```
"me ofereceram um frete Curitiba → Joinville por R$ 1.300"
  → o app: 130 km · 2 praças, ~R$ 180 · diesel ~R$ 520 (pelo SEU consumo)
  → sobra ~R$ 600
  → "aceitei"  →  vira frete registrado, com km e pedágio já preenchidos
  → no fim do mês: 12 viagens · 3.400 km · sobrou R$ 7.200
```

O caderninho de gastos que já está em produção não é jogado fora: ele vira a
fonte do consumo e do preço do diesel que alimentam a estimativa, e continua
sendo onde entra o que não é frete.

**Depois**, na ordem: C (comprovante), D (documentos), E (fotos).

## 6. O que isso toca no que já existe

Prometido: nada muda de forma.

- **Tabelas existentes:** nenhuma alterada.
- **Tabela nova:** `ViagemPessoal` — sem `contaId`, chaveada por `identidadeId`,
  em `MODELS_GLOBAIS`, exatamente como `LancamentoPessoal`.
- **Serviços existentes:** ganham método novo (rota por coordenada, pedágios por
  geometria). O caminho por `Local` continua igual para a operação da empresa.
- **Rotas:** só sob `m/eu/*`, que já é o prefixo da pessoa.
- **PWA:** não é tocado.
- **App nativo:** é onde a tela nasce.
