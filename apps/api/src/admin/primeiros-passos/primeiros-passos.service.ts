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
 * A permissão que o passo exige pra ser CUMPRIDO — não a de ver a tela.
 *
 * Um passo pendente que abre "Você não tem acesso a esta tela" é pior que passo
 * nenhum: a lista promete um caminho e entrega uma porta fechada, e "fale com um
 * administrador" não ajuda quem já é o administrador da própria empresa.
 *
 * A chave também diz de qual MÓDULO o passo é (moduloDoRecurso): conta que não
 * contratou Comercial não tem "diga quanto vale a viagem" no caminho dela —
 * esse passo não está pendente, ele não existe.
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

  async listar(
    usuario: { permissoes: string[]; plataforma: boolean },
  ): Promise<{ concluido: boolean; passos: PrimeiroPasso[] }> {
    const [veiculos, motoristas, locais, empresas, clientes, viagens, motoristasNoApp, precos] =
      await Promise.all([
        this.prisma.veiculo.count(),
        this.prisma.motorista.count(),
        this.prisma.local.count(),
        this.prisma.empresa.count(),
        this.prisma.cliente.count(),
        // Viagem em andamento não conta como "já rodou": o ciclo pode ter sido
        // aberto e abandonado, e o passo é sobre ter chegado ao fim uma vez.
        this.prisma.viagem.count({ where: { status: { notIn: STATUS_FORA_FECHAMENTO } } }),
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
        titulo: "Cadastre a empresa que te contrata",
        descricao:
          "É quem manda a planilha ou recebe o fechamento. Os clientes ficam dentro dela, então ela vem antes.",
        rota: "/empresas/novo",
        cumprido: empresas > 0,
      },
      {
        chave: "cliente",
        titulo: "Cadastre um cliente",
        descricao: "Dentro da empresa acima. É pra quem você fatura no fim do mês.",
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
        titulo: "Receba a primeira viagem",
        descricao:
          "Quem lança é o motorista, pelo app, na hora da carga. Aqui você confere, corrige e fecha o mês.",
        rota: "/viagens",
        cumprido: viagens > 0,
      },
      // Só entra na lista depois que existe viagem: antes disso é abstrato
      // demais, e a lista some assim que o último passo fecha — levando junto a
      // única bússola que a pessoa tinha. Com viagem na mão, "vale R$ 0" é uma
      // pergunta que ela já está se fazendo.
      ...(viagens > 0
        ? [
            {
              chave: "preco",
              titulo: "Diga quanto vale a viagem",
              descricao:
                "Sem tabela de preço a viagem entra valendo zero e a planilha de fechamento sai sem a coluna de dinheiro.",
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

    const visiveis = passos.filter((p) => {
      const exigencia = EXIGENCIAS.find((e) => e.passo === p.chave);
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
    });

    return { concluido: visiveis.every((p) => p.cumprido), passos: visiveis };
  }
}
