import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { comoSistema } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";

export type FaixaInput = {
  deVeiculos: number;
  ateVeiculos: number | null;
  valorCentavos: number;
  rotulo?: string | null;
};

/**
 * A tabela de preço do produto, por tamanho de frota.
 *
 * Mora no banco e se edita por tela porque preço muda — e mudar preço não pode
 * pedir deploy. É daqui que sai a resposta de "quanto custa?", seja de quem
 * atende, seja de um agente.
 */
@Injectable()
export class PrecosService {
  private readonly log = new Logger(PrecosService.name);

  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return comoSistema(() =>
      this.prisma.faixaPreco.findMany({ orderBy: { deVeiculos: "asc" } }),
    );
  }

  /**
   * Troca a tabela inteira de uma vez, em vez de editar faixa a faixa.
   *
   * Preço é um conjunto: faixa com buraco ("6 a 20" e depois "25 pra cima") ou
   * com sobreposição responde errado, e isso só dá pra conferir olhando todas
   * juntas. Salvar uma por vez deixaria a tabela inconsistente no meio.
   */
  async substituir(faixas: FaixaInput[]) {
    if (faixas.length === 0) {
      throw new BadRequestException("A tabela precisa de pelo menos uma faixa.");
    }

    const ordenadas = [...faixas].sort((a, b) => a.deVeiculos - b.deVeiculos);

    for (const [i, f] of ordenadas.entries()) {
      if (f.deVeiculos < 1) throw new BadRequestException("A frota começa em 1 caminhão.");
      if (f.ateVeiculos !== null && f.ateVeiculos < f.deVeiculos) {
        throw new BadRequestException(
          `A faixa que começa em ${f.deVeiculos} termina antes de começar.`,
        );
      }
      if (f.valorCentavos < 0) throw new BadRequestException("Preço não pode ser negativo.");

      const anterior = ordenadas[i - 1];
      if (!anterior) continue;
      if (anterior.ateVeiculos === null) {
        throw new BadRequestException("Só a última faixa pode ser aberta (sem teto).");
      }
      if (f.deVeiculos !== anterior.ateVeiculos + 1) {
        // Buraco ou sobreposição: com 6 caminhões, ou nenhuma faixa responde,
        // ou duas respondem valores diferentes.
        throw new BadRequestException(
          `A faixa de ${f.deVeiculos} deveria começar em ${anterior.ateVeiculos + 1}, ` +
            "pra não deixar frota sem preço nem em duas faixas ao mesmo tempo.",
        );
      }
    }

    if (ordenadas[ordenadas.length - 1]!.ateVeiculos !== null) {
      throw new BadRequestException(
        "A última faixa precisa ser aberta, senão frota grande fica sem preço.",
      );
    }

    await comoSistema(async () => {
      await this.prisma.faixaPreco.deleteMany({});
      await this.prisma.faixaPreco.createMany({
        data: ordenadas.map((f) => ({
          deVeiculos: f.deVeiculos,
          ateVeiculos: f.ateVeiculos,
          valorCentavos: f.valorCentavos,
          rotulo: f.rotulo ?? null,
        })),
      });
    });

    this.log.log(`Tabela de preço atualizada: ${ordenadas.length} faixa(s).`);
    return this.listar();
  }

  /**
   * Quanto custa pra uma frota deste tamanho.
   *
   * É o que responde "quanto custa?". Devolve `null` se a tabela estiver vazia
   * ou não cobrir o tamanho — e quem chama tem que tratar isso dizendo que vai
   * confirmar, nunca inventando um número.
   */
  async precoPara(veiculos: number) {
    const faixas = await this.listar();
    const faixa = faixas.find(
      (f) => veiculos >= f.deVeiculos && (f.ateVeiculos === null || veiculos <= f.ateVeiculos),
    );
    if (!faixa) return null;
    return {
      valorCentavos: faixa.valorCentavos,
      rotulo: faixa.rotulo,
      deVeiculos: faixa.deVeiculos,
      ateVeiculos: faixa.ateVeiculos,
    };
  }
}
