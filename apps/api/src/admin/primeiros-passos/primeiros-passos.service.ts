import { Injectable } from "@nestjs/common";
import { moduloDoRecurso } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { contaIdAtual } from "../../common/conta/conta-context";
import { modulosDaConta } from "../../common/conta/teto-da-conta";

export type PrimeiroPasso = {
  chave: string;
  titulo: string;
  /** O porquê, não o quê. Quem lê já sabe o que é "cadastrar um caminhão". */
  descricao: string;
  rota: string;
  cumprido: boolean;
};

/**
 * Como se reconhece uma viagem que veio de planilha.
 *
 * O importador carimba o `clientId` com este prefixo (`importacao.service.ts`),
 * o que também é o que torna a importação repetível sem duplicar. Aqui ele
 * serve pra separar duas perguntas que pareciam uma: "já tem histórico?" e "o
 * motorista já lançou?".
 */
const PREFIXO_IMPORTACAO = "import:";

/**
 * A permissão que o item exige pra ser CUMPRIDO — não a de ver a tela.
 *
 * Um passo pendente que abre "Você não tem acesso a esta tela" é pior que passo
 * nenhum: a lista promete um caminho e entrega uma porta fechada, e "fale com um
 * administrador" não ajuda quem já é o administrador da própria empresa.
 *
 * A chave também diz de qual MÓDULO o item é (moduloDoRecurso): conta que não
 * contratou Comercial não tem "diga quanto vale a viagem" no caminho dela —
 * esse item não está pendente, ele não existe.
 */
type Exigencia = { passo: string; perm: string };

const EXIGENCIAS: Exigencia[] = [
  { passo: "motorista", perm: "motoristas.criar" },
  { passo: "veiculo", perm: "veiculos.criar" },
  { passo: "local", perm: "locais.criar" },
  { passo: "empresa", perm: "empresas.criar" },
  { passo: "cliente", perm: "clientes.criar" },
  { passo: "app", perm: "motoristas.ver" },
  { passo: "viagem", perm: "viagens.ver" },
  { passo: "preco", perm: "tabelas-preco.criar" },
  { passo: "historico", perm: "importacao.executar" },
];

/**
 * O caminho da conta vazia até a primeira viagem.
 *
 * Uma empresa recém-criada ganha o vocabulário (materiais, tipos de evento,
 * campos de fechamento) mas nenhuma entidade operacional — e viagem exige
 * veículo e motorista, que são as duas únicas chaves que ela não aceita vazias.
 * Sem esta lista, o primeiro dia de quem se cadastrou sozinho é uma tela vazia
 * com dezoito menus e nenhuma indicação de por onde começar.
 *
 * A ordem é a de dependência real, não a de importância: sem local o app do
 * motorista nem abre o lançamento.
 */
@Injectable()
export class PrimeirosPassosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(usuario: { permissoes: string[]; plataforma: boolean }): Promise<{
    concluido: boolean;
    passos: PrimeiroPasso[];
    /** Fora da sequência: convites que não travam o caminho de ninguém. */
    ofertas: PrimeiroPasso[];
    /** Conta que já roda — ver `veterana` abaixo. */
    veterana: boolean;
  }> {
    const [
      veiculos,
      motoristas,
      locais,
      empresas,
      clientes,
      viagens,
      importadas,
      motoristasNoApp,
      precos,
    ] = await Promise.all([
        this.prisma.veiculo.count(),
        this.prisma.motorista.count(),
        this.prisma.local.count(),
        this.prisma.empresa.count(),
        this.prisma.cliente.count(),
        // Viagem em andamento não conta como "já rodou": o ciclo pode ter sido
        // aberto e abandonado, e o passo é sobre ter chegado ao fim uma vez.
        //
        // E viagem IMPORTADA não conta aqui: ela prova que o histórico subiu,
        // não que o motorista lançou. Marcar "Receba a primeira viagem" com uma
        // planilha seria o checklist dizendo meia-verdade e sumindo antes de o
        // ciclo que o produto promete ter acontecido uma vez.
        this.prisma.viagem.count({
          where: {
            status: { notIn: STATUS_FORA_FECHAMENTO },
            NOT: { clientId: { startsWith: PREFIXO_IMPORTACAO } },
          },
        }),
        this.prisma.viagem.count({ where: { clientId: { startsWith: PREFIXO_IMPORTACAO } } }),
        // O passo da viagem é o único que o dono NÃO cumpre sozinho: quem lança
        // é o motorista, pelo celular. Sem este passo no meio, a lista pedia um
        // resultado sem nunca pedir a ação que o produz.
        this.prisma.motorista.count({ where: { ultimoLoginEm: { not: null } } }),
        this.prisma.tabelaPreco.count(),
      ]);

    const passos: PrimeiroPasso[] = [
      // O motorista vem PRIMEIRO porque o cadastro dele aceita a placa, e a
      // placa cria o caminhão junto — quem começa por aqui marca dois itens de
      // uma vez. Começar pelo caminhão faria a pessoa cadastrar a mesma placa
      // duas vezes sem entender por quê.
      {
        chave: "motorista",
        titulo: "Cadastre um motorista",
        descricao:
          "Informe a placa dele no cadastro e o caminhão já entra junto. Ele recebe um convite e lança as viagens pelo celular.",
        rota: "/motoristas/novo",
        cumprido: motoristas > 0,
      },
      {
        chave: "veiculo",
        titulo: "Tenha pelo menos um caminhão",
        descricao:
          "Se você informou a placa ao cadastrar o motorista, isto já está feito. Senão, cadastre aqui — nenhuma viagem sai sem caminhão.",
        rota: "/veiculos/novo",
        cumprido: veiculos > 0,
      },
      // Dois locais, não um: a viagem exige `localCargaId` E `localDescargaId`
      // (shared-types/viagem.ts). Com `locais > 0` a pessoa cumpria os seis
      // passos, ia dormir tranquila, e o motorista continuava travado no app
      // sem ter onde descarregar.
      {
        chave: "local",
        titulo: "Cadastre onde você carrega e onde descarrega",
        descricao:
          "A pedreira e a obra — os dois. O motorista escolhe de onde saiu e onde descarregou, então uma viagem precisa dos dois cadastrados.",
        rota: "/locais/novo",
        cumprido: locais > 1,
      },
      // Cliente exige `empresaId` — sem a empresa, a tela de cliente não tem o
      // que escolher. A dependência aparece na lista pra pessoa não descobrir
      // isso no meio do formulário.
      {
        chave: "empresa",
        titulo: "Cadastre o cliente que te contrata",
        descricao:
          "É quem paga o frete e manda a planilha ou recebe o fechamento. As obras ficam dentro dele, então ele vem antes.",
        rota: "/empresas/novo",
        cumprido: empresas > 0,
      },
      {
        chave: "cliente",
        titulo: "Cadastre uma obra",
        descricao: "Dentro do cliente acima. É onde se trabalha — o que o motorista escolhe no app.",
        rota: "/clientes/novo",
        cumprido: clientes > 0,
      },
      {
        chave: "app",
        titulo: "Mande o app pro motorista",
        descricao:
          "Ele baixa, entra com o CPF e a senha que você cadastrou, e a primeira viagem chega aqui sozinha. Sem isso, o painel fica vazio por mais cadastro que você faça.",
        rota: "/motoristas",
        cumprido: motoristasNoApp > 0,
      },
      // Não existe criar viagem pelo painel: o controller só tem PATCH, e não
      // há tela de nova viagem. A viagem nasce no celular do motorista, e é
      // isso que o texto tem que dizer.
      {
        chave: "viagem",
        titulo: "Receba a primeira viagem do app",
        descricao:
          "Quem lança é o motorista, pelo celular, na hora da carga. Aqui você confere, corrige e fecha o mês. Histórico importado não vale para este passo — ele é sobre o ciclo rodando.",
        rota: "/viagens",
        cumprido: viagens > 0,
      },
    ];

    /**
     * Ofertas: o que se PODE fazer, nunca o que falta fazer.
     *
     * A diferença não é de texto, é de consequência: passo entra no placar, no
     * "faltam algumas coisas" e segura o card na home até ser cumprido. Nada
     * aqui faz isso.
     *
     * O preço já foi passo e estava errado. Nada no sistema para sem tabela de
     * preço — a viagem entra valendo zero, e há empresa que fatura fora daqui e
     * nunca vai preencher isso. Como passo, ele reabria um caminho que estava
     * fechado havia meses: cliente que usa o painel todo dia viu voltar um
     * "faltam coisas" por causa de uma funcionalidade que ele decidiu não usar.
     */
    const ofertas: PrimeiroPasso[] = [
      /**
       * A importação sai da SEQUÊNCIA e vira oferta paralela.
       *
       * Ela chegou a ser o primeiro passo e estava errado: a lista é uma ordem
       * de dependência ("sem local o app não abre o lançamento"), e um atalho
       * que pula metade dela não tem posição numa ordem — no topo ainda por
       * cima, ela recebe quem acabou de entrar com um pedido de planilha, que
       * parece trabalho antes de o sistema ter mostrado serventia nenhuma.
       *
       * Como oferta, ela responde a uma pergunta que a pessoa faz sozinha ("vou
       * ter que digitar tudo isso?") em vez de mandar fazer.
       */
      {
        chave: "historico",
        titulo: "Já tem tudo numa planilha?",
        descricao:
          "Motoristas, caminhões, locais e o histórico de viagens entram de uma vez, com os valores. Subir de novo atualiza, não duplica.",
        rota: "/importacao",
        cumprido: importadas > 0,
      },
      // Só depois que existe viagem — real ou importada. Antes disso "quanto
      // vale" é abstrato: não há o que precificar, e a pergunta chega antes de
      // a pessoa ter motivo pra fazê-la.
      ...(viagens > 0 || importadas > 0
        ? [
            {
              chave: "preco",
              titulo: "Diga quanto vale a viagem",
              descricao:
                "Com tabela de preço, o fechamento sai com a coluna de dinheiro preenchida sozinha. Sem ela, a viagem entra valendo zero — e isso é uma escolha válida.",
              rota: "/tabelas-preco/novo",
              cumprido: precos > 0,
            },
          ]
        : []),
    ];

    // Só sobra o que ESTA pessoa consegue fazer nesta conta. Filtrar aqui, e não
    // na tela, é o que garante que `concluido` (que apaga o card) signifique
    // "acabou o seu caminho", e não "acabou o caminho de outra pessoa".
    const modulos = await modulosDaConta(this.prisma, contaIdAtual());
    const permissoes = new Set(usuario.permissoes);

    const alcancavel = (item: PrimeiroPasso) => {
      const exigencia = EXIGENCIAS.find((e) => e.passo === item.chave);
      if (!exigencia) return true;
      const recurso = exigencia.perm.split(".")[0]!;
      const modulo = moduloDoRecurso(recurso);
      if (modulo && !modulos.has(modulo)) return false;
      // Operador da plataforma enxerga tudo — é ele quem configura a conta nova.
      if (usuario.plataforma) return true;
      // Duas permissões, porque são duas portas: o `TelaGuard` abre a tela por
      // `<recurso>.ver` e a ação exige a dela. Checar só uma deixaria o mesmo
      // beco sem saída de pé, com outro texto.
      return permissoes.has(`${recurso}.ver`) && permissoes.has(exigencia.perm);
    };

    const visiveis = passos.filter(alcancavel);

    return {
      concluido: visiveis.every((p) => p.cumprido),
      passos: visiveis,
      ofertas: ofertas.filter(alcancavel),
      /**
       * A conta já roda: a primeira viagem do app chegou.
       *
       * O checklist é o caminho ATÉ ela — "faltam algumas coisas para você
       * lançar sua primeira viagem" vira mentira no segundo seguinte. Daí a
       * regra: passo novo não reabre caminho que já se fechou. Sem isto,
       * qualquer item acrescentado aqui reaparece na home de quem usa o
       * sistema há meses, como se a pessoa estivesse começando de novo.
       *
       * A lista inteira continua em /comecar, que é onde ela serve pra
       * explicar o sistema pra quem entra novo no time.
       */
      veterana: viagens > 0,
    };
  }
}
