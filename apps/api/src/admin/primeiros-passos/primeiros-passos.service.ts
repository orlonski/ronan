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
  { passo: "veiculo", perm: "veiculos.criar" },
  { passo: "local", perm: "locais.criar" },
  { passo: "empresa", perm: "empresas.criar" },
  { passo: "app", perm: "motoristas.ver" },
  { passo: "convite", perm: "motoristas.criar" },
  { passo: "preco", perm: "tabelas-preco.criar" },
  { passo: "historico", perm: "importacao.executar" },
];

/**
 * O caminho da conta vazia até o primeiro motorista convidado.
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
      clientes,
      viagens,
      importadas,
      precos,
    ] = await Promise.all([
        // Todo passo só pergunta "já tem?" (`> 0`; locais, `> 1`), então a
        // contagem para no primeiro que acha. Contar tudo percorria o histórico
        // inteiro de viagens a cada abertura da home, pra dizer "sim" de novo.
        this.prisma.veiculo.count({ take: 1 }),
        // Conta o convite ainda PENDENTE de propósito: o caminho termina quando
        // a empresa convida, e o sim é do motorista, não um passo dela.
        this.prisma.motorista.count({ take: 1 }),
        this.prisma.local.count({ take: 2 }),
        this.prisma.cliente.count({ take: 1 }),
        // Não é passo: é o que diz se a conta é `veterana`. Viagem em andamento
        // não conta como "já rodou" — o ciclo pode ter sido aberto e
        // abandonado. E viagem IMPORTADA também não: ela prova que o histórico
        // subiu, não que o motorista lançou.
        this.prisma.viagem.count({
          where: {
            status: { notIn: STATUS_FORA_FECHAMENTO },
            NOT: { clientId: { startsWith: PREFIXO_IMPORTACAO } },
          },
          take: 1,
        }),
        this.prisma.viagem.count({ where: { clientId: { startsWith: PREFIXO_IMPORTACAO } }, take: 1 }),
        this.prisma.tabelaPreco.count({ take: 1 }),
      ]);

    const passos: PrimeiroPasso[] = [
      // O caminhão vem antes porque o convite por CPF não leva placa: quem
      // chega pelo convite entra só com a pessoa, e a viagem precisa dos dois.
      {
        chave: "veiculo",
        titulo: "Cadastre um caminhão",
        descricao: "Nenhuma viagem sai sem caminhão. Basta a placa pra começar.",
        rota: "/veiculos/novo",
        cumprido: veiculos > 0,
      },
      // Dois locais, não um: a viagem exige `localCargaId` E `localDescargaId`
      // (shared-types/viagem.ts). Com `locais > 0` a pessoa cumpria os passos,
      // ia dormir tranquila, e o motorista continuava travado no app sem ter
      // onde descarregar.
      {
        chave: "local",
        titulo: "Cadastre onde você carrega e onde descarrega",
        descricao:
          "A pedreira e a obra — os dois. O motorista escolhe de onde saiu e onde descarregou, então uma viagem precisa dos dois cadastrados.",
        rota: "/locais/novo",
        cumprido: locais > 1,
      },
      // Um passo só (era "cliente" e depois "obra"): o cliente nasce com a
      // obra de mesmo nome, e é a OBRA que o motorista escolhe. Por isso o
      // cumprido olha as obras — cliente sem obra não aparece no app.
      {
        chave: "empresa",
        titulo: "Cadastre o cliente que te contrata",
        descricao:
          "É quem paga o frete e manda a planilha ou recebe o fechamento. A obra com o mesmo nome nasce junto — é o que o motorista escolhe no app.",
        rota: "/empresas/novo",
        cumprido: clientes > 0,
      },
      /**
       * Os dois últimos são o motorista entrando, na ordem em que acontece:
       * ELE baixa o app e cria o cadastro com o CPF dele (sem código de
       * empresa), e DEPOIS a empresa convida esse CPF. Antes do convite a
       * pessoa não tem vínculo nenhum com esta conta — o painel não tem como
       * saber que ela baixou —, então os dois fecham juntos quando o primeiro
       * motorista entra na lista, convite aceito ou não.
       *
       * O caminho TERMINA no convite. A primeira viagem já foi passo, e fazia
       * o checklist cobrar do dono algo que só o motorista faz: com o
       * motorista convidado, a parte da empresa acabou.
       */
      {
        chave: "app",
        titulo: "Mande o app pro motorista",
        descricao:
          "Ele baixa e cria o cadastro com o CPF dele — não precisa de código de empresa nem de senha sua.",
        rota: "/motoristas",
        cumprido: motoristas > 0,
      },
      {
        chave: "convite",
        titulo: "Convide o motorista pelo CPF",
        descricao:
          "Depois que ele se cadastrou, digite o CPF dele aqui. Ele aceita o convite no celular e já pode lançar viagem.",
        rota: "/motoristas#convidar",
        cumprido: motoristas > 0,
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
