import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type TipoCombustivel } from "@prisma/client";
import {
  GRUPO_SEM_VALOR,
  type GrupoRelatorioAbastecimentos,
  type RelatorioAbastecimentosFiltros,
  type RelatorioAbastecimentosQuery,
  type RelatorioAbastecimentosResposta,
  TIPO_COMBUSTIVEL_LABEL,
  type TotaisRelatorioAbastecimentos,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import type { EscopoAdmin } from "../../common/escopo/escopo";
import { comEscopo } from "../../common/escopo/escopo";
import { inicioDoDiaBR } from "../../common/timezone";
import type { RotuloGrupo } from "./dimensoes";
import {
  chaveDoGrupoAbastecimento,
  type LinhaAgregacaoAbastecimento,
  resolverRotulosAbastecimento,
  rotuloDaLinha,
} from "./dimensoes-abastecimento";

/** Mesmo racional do relatório de viagens: o pico de memória é ~CHUNK linhas. */
const CHUNK = 5_000;

/** Teto absoluto — estourar devolve 400 em vez de segurar o pool por minutos. */
const MAX_LINHAS = 200_000;

const SELECT_AGREGACAO = {
  id: true,
  motoristaId: true,
  veiculoId: true,
  empresaId: true,
  transportadoraId: true,
  tipo: true,
  postoNome: true,
  litros: true,
  valorTotal: true,
  emComboio: true,
} as const;

type LinhaBruta = LinhaAgregacaoAbastecimento & {
  litros: Prisma.Decimal;
  valorTotal: Prisma.Decimal | null;
  emComboio: boolean;
};

type Acumulador = {
  abastecimentos: number;
  litros: Prisma.Decimal;
  valor: Prisma.Decimal;
  /** Denominador do preço médio — só os litros que têm valor informado. */
  litrosComValor: Prisma.Decimal;
  semValor: number;
  emComboio: number;
};

/** Uma linha na aba de detalhe do XLSX. */
export type LinhaDetalheAbastecimento = {
  data: Date;
  motorista: string;
  placa: string;
  empresa: string | null;
  tipo: TipoCombustivel;
  posto: string | null;
  litros: string;
  valor: string | null;
  precoLitro: string | null;
  odometro: number;
  tanqueCheio: boolean;
  emComboio: boolean;
};

const zerado = (): Acumulador => ({
  abastecimentos: 0,
  litros: new Prisma.Decimal(0),
  valor: new Prisma.Decimal(0),
  litrosComValor: new Prisma.Decimal(0),
  semValor: 0,
  emComboio: 0,
});

@Injectable()
export class RelatoriosAbastecimentosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O `where` de todo mundo (contagem, agregação, detalhe) sai daqui.
   *
   * `Abastecimento.data` é TIMESTAMP, não @db.Date como a viagem: o dia civil
   * tem que ser ancorado em America/Sao_Paulo com `inicioDoDiaBR`, e o fim do
   * período é `lt` no dia seguinte. Copiar o `lte: new Date(ate)` do relatório
   * de viagens aqui cortaria as 21h de Brasília em diante do último dia.
   */
  montarWhere(
    f: RelatorioAbastecimentosFiltros,
    escopo: EscopoAdmin,
  ): Prisma.AbastecimentoWhereInput {
    const base: Prisma.AbastecimentoWhereInput = {
      data: {
        gte: inicioDoDiaBR(f.de),
        lt: new Date(inicioDoDiaBR(f.ate).getTime() + 86_400_000),
      },
    };

    if (f.motoristaId) base.motoristaId = f.motoristaId;
    if (f.veiculoId) base.veiculoId = f.veiculoId;
    if (f.empresaId) base.empresaId = f.empresaId;
    if (f.transportadoraId) base.transportadoraId = f.transportadoraId;
    if (f.tipo) base.tipo = f.tipo;
    // Posto é texto livre: comparação exata mas sem diferenciar caixa, pela
    // mesma razão que a chave do grupo é normalizada.
    if (f.posto) base.postoNome = { equals: f.posto, mode: "insensitive" };

    return comEscopo(base, escopo) as Prisma.AbastecimentoWhereInput;
  }

  async resumo(
    q: RelatorioAbastecimentosQuery,
    escopo: EscopoAdmin,
  ): Promise<RelatorioAbastecimentosResposta> {
    const where = this.montarWhere(q, escopo);

    const total = await this.prisma.abastecimento.count({ where });
    if (total > MAX_LINHAS) {
      throw new BadRequestException(
        `Este recorte tem ${total.toLocaleString("pt-BR")} abastecimentos, acima do limite de ${MAX_LINHAS.toLocaleString("pt-BR")}. Reduza o período ou aplique um filtro.`,
      );
    }

    const grupos = new Map<string, Acumulador>();
    // Rótulo de dimensão que não é FK (posto/tipo). "Posto Shell", "posto shell"
    // e "POSTO SHELL" viram UM grupo (a chave é normalizada), mas a tela precisa
    // escolher uma grafia: vence a mais repetida, não a primeira que o cursor
    // encontrou — ordem de uuid não tem nada a ver com o que o pessoal digita.
    const grafias = new Map<string, Map<string, { n: number; detalhe: string | null }>>();
    let processadas = 0;
    let cursor: string | undefined;

    // Cursor por `id`, nunca por `data`: empate de timestamp faria o cursor
    // pular ou repetir linhas e corromper o total em silêncio.
    for (;;) {
      const lote: LinhaBruta[] = await this.prisma.abastecimento.findMany({
        where,
        select: SELECT_AGREGACAO,
        orderBy: { id: "asc" },
        take: CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (lote.length === 0) break;

      for (const linha of lote) {
        const chave = chaveDoGrupoAbastecimento(q.agruparPor, linha);
        let acc = grupos.get(chave);
        if (!acc) {
          acc = zerado();
          grupos.set(chave, acc);
        }
        // GRUPO_SEM_VALOR não tem rótulo na linha (é justamente a linha que não
        // preencheu o campo) — quem nomeia esse grupo é o resolver.
        if (chave !== GRUPO_SEM_VALOR) {
          const rotulo = rotuloDaLinha(q.agruparPor, linha);
          if (rotulo) contarGrafia(grafias, chave, rotulo);
        }
        acumular(acc, linha);
        processadas++;
      }

      cursor = lote[lote.length - 1]!.id;
      if (lote.length < CHUNK) break;
    }

    const rotulos = await resolverRotulosAbastecimento(
      this.prisma,
      q.agruparPor,
      [...grupos.keys()],
      grafiaVencedora(grafias),
    );

    let linhas: GrupoRelatorioAbastecimentos[] = [...grupos.entries()].map(([chave, acc]) => {
      const r = rotulos.get(chave);
      return {
        chave,
        nome: r?.nome ?? "(desconhecido)",
        detalhe: r?.detalhe ?? null,
        ...serializar(acc),
      };
    });

    linhas = ordenar(linhas, q.ordenarPor, q.ordem);

    // Totais = soma dos acumuladores, nunca um aggregate paralelo: dois
    // caminhos de cálculo divergem cedo ou tarde e o rodapé é o que o
    // financeiro confere na mão.
    const totalAcc = zerado();
    for (const acc of grupos.values()) somar(totalAcc, acc);

    const totais: TotaisRelatorioAbastecimentos = {
      grupos: grupos.size,
      ...serializar(totalAcc),
    };

    return {
      periodo: { de: q.de, ate: q.ate, dias: diasEntre(q.de, q.ate) },
      agruparPor: q.agruparPor,
      grupos: linhas,
      totais,
      meta: { geradoEm: new Date().toISOString(), linhasProcessadas: processadas },
    };
  }

  /**
   * Abastecimento a abastecimento do mesmo recorte, pra 2ª aba do XLSX. Não
   * pagina: o teto é `limite` e o que passar é cortado com aviso — o resumo
   * segue correto porque é calculado à parte.
   */
  async detalhe(
    f: RelatorioAbastecimentosFiltros,
    escopo: EscopoAdmin,
    limite: number,
  ): Promise<{ linhas: LinhaDetalheAbastecimento[]; truncado: boolean }> {
    const where = this.montarWhere(f, escopo);
    const total = await this.prisma.abastecimento.count({ where });

    const rows = await this.prisma.abastecimento.findMany({
      where,
      take: limite,
      orderBy: [{ data: "desc" }, { id: "asc" }],
      select: {
        data: true,
        tipo: true,
        litros: true,
        valorTotal: true,
        precoLitro: true,
        odometro: true,
        postoNome: true,
        tanqueCheio: true,
        emComboio: true,
        motorista: { select: { nome: true } },
        veiculo: { select: { placa: true } },
        empresa: { select: { nome: true } },
      },
    });

    const linhas: LinhaDetalheAbastecimento[] = rows.map((a) => ({
      data: a.data,
      motorista: a.motorista.nome,
      placa: a.veiculo.placa,
      empresa: a.empresa?.nome ?? null,
      tipo: a.tipo,
      posto: a.postoNome ?? null,
      litros: a.litros.toFixed(3),
      // Null de propósito: comboio sem valor não é R$ 0,00, e a planilha
      // precisa mostrar célula vazia pra soma não mentir.
      valor: a.valorTotal ? a.valorTotal.toFixed(2) : null,
      precoLitro: a.precoLitro ? a.precoLitro.toFixed(3) : null,
      odometro: a.odometro,
      tanqueCheio: a.tanqueCheio,
      emComboio: a.emComboio,
    }));

    return { linhas, truncado: total > limite };
  }
}

type Grafias = Map<string, Map<string, { n: number; detalhe: string | null }>>;

function contarGrafia(grafias: Grafias, chave: string, rotulo: RotuloGrupo): void {
  let porNome = grafias.get(chave);
  if (!porNome) {
    porNome = new Map();
    grafias.set(chave, porNome);
  }
  const atual = porNome.get(rotulo.nome);
  if (atual) atual.n++;
  else porNome.set(rotulo.nome, { n: 1, detalhe: rotulo.detalhe });
}

/** Empate resolve pela ordem alfabética, pra o rótulo não dançar entre cargas. */
function grafiaVencedora(grafias: Grafias): Map<string, RotuloGrupo> {
  const out = new Map<string, RotuloGrupo>();
  for (const [chave, porNome] of grafias) {
    let melhor: { nome: string; n: number; detalhe: string | null } | null = null;
    for (const [nome, { n, detalhe }] of porNome) {
      if (!melhor || n > melhor.n || (n === melhor.n && nome.localeCompare(melhor.nome, "pt-BR") < 0)) {
        melhor = { nome, n, detalhe };
      }
    }
    if (melhor) out.set(chave, { nome: melhor.nome, detalhe: melhor.detalhe });
  }
  return out;
}

function acumular(acc: Acumulador, linha: LinhaBruta): void {
  acc.abastecimentos++;
  // Decimal do começo ao fim: float acumula deriva visível no rodapé.
  acc.litros = acc.litros.plus(linha.litros);

  if (linha.valorTotal) {
    acc.valor = acc.valor.plus(linha.valorTotal);
    acc.litrosComValor = acc.litrosComValor.plus(linha.litros);
  } else {
    acc.semValor++;
  }
  if (linha.emComboio) acc.emComboio++;
}

function somar(alvo: Acumulador, parcela: Acumulador): void {
  alvo.abastecimentos += parcela.abastecimentos;
  alvo.litros = alvo.litros.plus(parcela.litros);
  alvo.valor = alvo.valor.plus(parcela.valor);
  alvo.litrosComValor = alvo.litrosComValor.plus(parcela.litrosComValor);
  alvo.semValor += parcela.semValor;
  alvo.emComboio += parcela.emComboio;
}

function serializar(acc: Acumulador) {
  return {
    abastecimentos: acc.abastecimentos,
    litros: acc.litros.toFixed(3),
    valor: acc.valor.toFixed(2),
    precoMedio: acc.litrosComValor.isZero()
      ? "0.000"
      : acc.valor.div(acc.litrosComValor).toFixed(3),
    litrosComValor: acc.litrosComValor.toFixed(3),
    semValor: acc.semValor,
    emComboio: acc.emComboio,
  };
}

type CampoOrdenavel = "abastecimentos" | "litros" | "valor" | "precoMedio";

function ordenar(
  linhas: GrupoRelatorioAbastecimentos[],
  por: RelatorioAbastecimentosQuery["ordenarPor"],
  ordem: "asc" | "desc",
): GrupoRelatorioAbastecimentos[] {
  const sinal = ordem === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    if (por === "nome") return sinal * a.nome.localeCompare(b.nome, "pt-BR");
    const campo = por as CampoOrdenavel;
    const va = Number(a[campo] ?? 0);
    const vb = Number(b[campo] ?? 0);
    // Number() só pra ordenar; o que aparece segue sendo a string do Decimal.
    if (va === vb) return a.nome.localeCompare(b.nome, "pt-BR");
    return sinal * (va - vb);
  });
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
}

/** Rótulo do combustível pro export — a API não devolve o enum traduzido. */
export function labelCombustivel(tipo: TipoCombustivel): string {
  return TIPO_COMBUSTIVEL_LABEL[tipo] ?? tipo;
}
