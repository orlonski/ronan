import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  LinhaResultadoObraDetalhe,
  RelatorioResultadoObraDetalheQuery,
  RelatorioResultadoObraQuery,
  RelatorioResultadoObraResposta,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import type { EscopoAdmin } from "../../common/escopo/escopo";
import { calcularResultadoObras, type ResultadoObrasCalculado } from "../../common/resultado-obra";
import { RelatoriosLucroService } from "./relatorios-lucro.service";

/**
 * Resultado por obra. Parte das MESMAS entradas do lucro por caminhão
 * (`carregarCaminhoes`) e acrescenta só o que o caminhão não tem: a estadia
 * faturada de cada viagem. A conta mora em `common/resultado-obra.ts`.
 */
@Injectable()
export class RelatoriosResultadoObraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lucro: RelatoriosLucroService,
  ) {}

  private async calcular(
    q: RelatorioResultadoObraQuery,
    escopo: EscopoAdmin,
  ): Promise<ResultadoObrasCalculado> {
    const caminhoes = await this.lucro.carregarCaminhoes(
      { de: q.de, ate: q.ate, transportadoraId: q.transportadoraId },
      escopo,
    );

    // Estadia que já virou linha de fatura viva. Ligada pela parada
    // (EventoViagem), não pela viagem: a linha de estadia nasce avulsa
    // (`viagemId` nulo). Fatura cancelada não é receita.
    const viagemIds = caminhoes.flatMap((c) => c.entrada.viagens.map((v) => v.id));
    if (viagemIds.length) {
      const linhas = await this.prisma.faturaLinha.findMany({
        where: {
          eventoViagem: { viagemId: { in: viagemIds } },
          fatura: { status: { not: "CANCELADA" } },
        },
        select: { valor: true, eventoViagem: { select: { viagemId: true } } },
      });
      const estadia = new Map<string, Prisma.Decimal>();
      for (const l of linhas) {
        const id = l.eventoViagem?.viagemId;
        if (!id) continue;
        estadia.set(id, (estadia.get(id) ?? new Prisma.Decimal(0)).add(l.valor));
      }
      for (const c of caminhoes) {
        for (const v of c.entrada.viagens) v.estadia = estadia.get(v.id) ?? null;
      }
    }

    return calcularResultadoObras(
      caminhoes.map((c) => ({ veiculoId: c.veiculo.id, placa: c.veiculo.placa, entrada: c.entrada })),
      q.empresaId,
    );
  }

  /** A tabela. Sem a lista de viagens: num mês cheio são milhares, e a gaveta pede a dela. */
  async resumo(q: RelatorioResultadoObraQuery, escopo: EscopoAdmin): Promise<RelatorioResultadoObraResposta> {
    const r = await this.calcular(q, escopo);
    const semLista = ({ viagensLista: _lista, ...l }: LinhaResultadoObraDetalhe) => l;
    return {
      periodo: { de: q.de, ate: q.ate },
      obras: r.obras.map(semLista),
      semObra: r.semObra ? semLista(r.semObra) : null,
      parado: r.parado,
      total: r.total,
      conferencia: r.conferencia,
    };
  }

  /** Uma obra, com as viagens dela — o que a gaveta mostra. */
  async detalhe(
    q: RelatorioResultadoObraDetalheQuery,
    escopo: EscopoAdmin,
  ): Promise<LinhaResultadoObraDetalhe> {
    const r = await this.calcular({ de: q.de, ate: q.ate, transportadoraId: q.transportadoraId }, escopo);
    const linha = [...r.obras, ...(r.semObra ? [r.semObra] : [])].find((l) => l.chave === q.obra);
    if (!linha) throw new NotFoundException("Essa obra não teve viagem no período.");
    return linha;
  }

  /** Pro export: tudo, com as viagens. */
  async completo(q: RelatorioResultadoObraQuery, escopo: EscopoAdmin) {
    const r = await this.calcular(q, escopo);
    return { periodo: { de: q.de, ate: q.ate }, ...r };
  }
}
