import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";

export type PrimeiroPasso = {
  chave: string;
  titulo: string;
  /** O porquê, não o quê. Quem lê já sabe o que é "cadastrar um caminhão". */
  descricao: string;
  rota: string;
  cumprido: boolean;
};

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

  async listar(): Promise<{ concluido: boolean; passos: PrimeiroPasso[] }> {
    const [veiculos, motoristas, locais, empresas, clientes, viagens] = await Promise.all([
      this.prisma.veiculo.count(),
      this.prisma.motorista.count(),
      this.prisma.local.count(),
      this.prisma.empresa.count(),
      this.prisma.cliente.count(),
      // Viagem em andamento não conta como "já rodou": o ciclo pode ter sido
      // aberto e abandonado, e o passo é sobre ter chegado ao fim uma vez.
      this.prisma.viagem.count({ where: { status: { notIn: STATUS_FORA_FECHAMENTO } } }),
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
      {
        chave: "local",
        titulo: "Cadastre onde você carrega",
        descricao:
          "A pedreira, o areal, a obra. O app baixa esses lugares pro motorista escolher sem digitar.",
        rota: "/locais/novo",
        cumprido: locais > 0,
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
    ];

    return { concluido: passos.every((p) => p.cumprido), passos };
  }
}
