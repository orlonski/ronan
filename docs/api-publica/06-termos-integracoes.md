# Rascunho — Termos de Uso, seção nova "Integrações com outros sistemas"

> **Status: RASCUNHO, não publicado.** Decisão 5 da proposta (`04-proposta.md`): entra nos Termos
> de Uso (`docs/termos-de-uso.md`) como versão **1.1**, com novo aceite, **antes** do 1º cliente
> usar a integração. Vale passar por um advogado antes de publicar. Onde encaixa: como **7.3**,
> dentro da seção 7 (LGPD), porque o ponto central é quem decide pra onde os dados vão.
>
> Também muda: a tabela da **7.1** ganha a linha "Sistemas que você conecta | Quem você escolher |
> Só o que a chave e o aviso que você configurou permitem" (é o único "terceiro" que não fomos nós
> que escolhemos).

---

### 7.3. Integrações com outros sistemas

Se você contratar o módulo **Integrações**, o sistema da sua empresa (um ERP, um sistema de frete,
um aplicativo próprio) pode conversar com o Movatruck sem ninguém digitar nada: mandar viagens pra
cá e receber o que acontece aqui.

**Quem decide pra onde os dados vão é você.** Ao criar uma **chave de acesso** ou cadastrar um
**endereço de aviso**, você nos instrui a entregar os dados da sua empresa para aquele sistema. Para
a lei, isso é uma instrução do controlador, e nós a cumprimos como operador (ver o início desta
seção). Por isso:

- **Você escolhe e responde pelo destino.** O que o sistema de destino faz com os dados — guardar,
  repassar, apagar — é responsabilidade sua e de quem o opera. Não temos controle sobre ele.
- **Você controla o que sai, chave por chave.** Cada chave tem o que ela pode fazer marcado na tela
  (ver viagens, criar viagens, ver valores). **CPF e telefone dos motoristas só saem se você marcar
  isso na chave**, e a tela avisa que aquilo entrega dado pessoal.
- **Algumas coisas não saem por integração, nem se você pedir:** chave Pix e dados bancários,
  localização ao vivo do motorista e documentos pessoais (CNH, exame toxicológico). São os dados
  com maior risco de golpe e de dano à pessoa.

**A chave é da sua empresa, não de quem a criou.** Trate como senha:

- Ela aparece **uma vez só**, na hora em que é criada. Nós guardamos apenas uma forma que não permite
  reconstruí-la.
- Quem tiver a chave age em nome da sua empresa dentro do que ela permite. Entregue só a quem
  precisa, e desligue com um botão quando não precisar mais.
- **Se encontrarmos uma chave sua exposta** (publicada na internet, por exemplo), avisamos o
  administrador da empresa na hora. Se ela não for trocada, **desligamos sozinhos em até 24 horas**.
  Não desligamos na hora porque isso pararia a sua operação sem você saber.

**Registro.** Guardamos o registro de uso de cada chave (quando foi usada, de onde, o que fez) e de
cada aviso entregue, para você conferir na tela e para responder a um incidente.

**Limites e disponibilidade.** Cada chave tem um limite de chamadas por minuto, descrito na
documentação. Os avisos automáticos são tentados de novo por até **3 dias** se o seu sistema estiver
fora do ar; depois disso o aviso é desligado e o administrador recebe uma mensagem, e o seu sistema
pode buscar o que perdeu pela consulta "o que mudou desde". Vale para a integração o que diz a seção
8 (Segurança e disponibilidade): não prometemos funcionamento ininterrupto.

**Se o módulo for cancelado,** todas as chaves e avisos param na hora. Nada é apagado: os dados
continuam seus, e a saída deles segue a seção 10.

**Uso aceitável.** Vale a seção 11, e mais: não use a integração para tentar acessar dados de outra
empresa, para sobrecarregar o sistema de propósito, nem para enviar ao Movatruck dados que você não
tem base legal para tratar.
