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
    const [veiculos, motoristas, locais, clientes, viagens] = await Promise.all([
      this.prisma.veiculo.count(),
      this.prisma.motorista.count(),
      this.prisma.local.count(),
      this.prisma.cliente.count(),
      // Viagem em andamento não conta como "já rodou": o ciclo pode ter sido
      // aberto e abandonado, e o passo é sobre ter chegado ao fim uma vez.
      this.prisma.viagem.count({ where: { status: { notIn: STATUS_FORA_FECHAMENTO } } }),
    ]);

    const passos: PrimeiroPasso[] = [
      {
        chave: "veiculo",
        titulo: "Cadastre um caminhão",
        descricao: "Toda viagem sai de um caminhão — sem pelo menos um, não dá pra lançar.",
        rota: "/veiculos/novo",
        cumprido: veiculos > 0,
      },
      {
        chave: "motorista",
        titulo: "Cadastre um motorista",
        descricao: "Ele recebe o convite e lança as viagens pelo app, do celular dele.",
        rota: "/motoristas/novo",
        cumprido: motoristas > 0,
      },
      {
        chave: "local",
        titulo: "Cadastre onde você carrega",
        descricao:
          "A pedreira, o areal, a obra. O app baixa esses lugares pro motorista escolher sem digitar.",
        rota: "/locais/novo",
        cumprido: locais > 0,
      },
      {
        chave: "cliente",
        titulo: "Cadastre um cliente",
        descricao: "É pra quem você fatura. Sem ele o fechamento do mês não fecha.",
        rota: "/clientes/novo",
        cumprido: clientes > 0,
      },
      {
        chave: "viagem",
        titulo: "Lance a primeira viagem",
        descricao: "Pelo app do motorista ou aqui pelo painel. É o que o sistema existe pra fazer.",
        rota: "/viagens",
        cumprido: viagens > 0,
      },
    ];

    return { concluido: passos.every((p) => p.cumprido), passos };
  }
}
