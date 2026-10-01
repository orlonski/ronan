import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { parseArquivo } from "../../fechamentos/parsers";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import {
  CAMPOS_EXTRATO,
  conciliarCartao,
  lerExtrato,
  normalizarPlacaCartao,
  type ResultadoLeitura,
  type SituacaoConciliacao,
} from "../../common/cartao-combustivel";
import { inicioDoDiaBR } from "../../common/timezone";

/** Teto por extrato: um mês de uma frota grande cabe com folga. */
const MAX_LINHAS = 20_000;

type Arquivo = { buffer: Buffer; originalname: string; mimetype: string };

/**
 * Extrato do cartão combustível: importar e conciliar com o que foi lançado.
 *
 * Duas etapas, como a importação de cadastros: `previa` lê e conta sem gravar;
 * `importar` grava. As passadas ficam guardadas; a conciliação é calculada a
 * cada leitura, porque o lançamento do motorista pode chegar (offline) depois
 * do extrato.
 */
@Injectable()
export class CartaoCombustivelService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lê a primeira aba em que o cabeçalho do extrato aparece. */
  private async ler(arquivo: Arquivo | undefined): Promise<ResultadoLeitura & { aba: string }> {
    if (!arquivo) throw new BadRequestException("Envie o arquivo do extrato (planilha ou CSV).");
    let parsed;
    try {
      parsed = await parseArquivo(arquivo.buffer, arquivo.originalname, arquivo.mimetype);
    } catch {
      throw new BadRequestException("Não consegui abrir o arquivo. Use a planilha (.xlsx) ou o .csv que a operadora exporta.");
    }
    let melhor: (ResultadoLeitura & { aba: string }) | null = null;
    for (const aba of parsed.abas) {
      const r = lerExtrato(aba.linhas);
      if (r.linhaCabecalho < 0) continue;
      if (!melhor || r.transacoes.length > melhor.transacoes.length) melhor = { ...r, aba: aba.nome };
    }
    if (!melhor) {
      throw new BadRequestException(
        "Não achei as colunas do extrato. A planilha precisa ter pelo menos Data, Placa e Valor no cabeçalho.",
      );
    }
    if (melhor.faltando.length > 0) {
      const nomes = CAMPOS_EXTRATO.filter((c) => melhor!.faltando.includes(c.chave)).map((c) => c.rotulo);
      throw new BadRequestException(`Faltou a coluna de ${nomes.join(" e ")} no extrato.`);
    }
    if (melhor.transacoes.length > MAX_LINHAS) {
      throw new BadRequestException(`O extrato tem mais de ${MAX_LINHAS.toLocaleString("pt-BR")} linhas. Divida por período.`);
    }
    return melhor;
  }

  private async placasDoCadastro(): Promise<Map<string, string>> {
    const veiculos = await this.prisma.veiculo.findMany({ select: { id: true, placa: true } });
    return new Map(veiculos.map((v) => [normalizarPlacaCartao(v.placa), v.id]));
  }

  async previa(arquivo: Arquivo | undefined) {
    const r = await this.ler(arquivo);
    const [placas, jaExistem] = await Promise.all([
      this.placasDoCadastro(),
      this.prisma.transacaoCartao.findMany({
        where: { chave: { in: r.transacoes.map((t) => t.chave) } },
        select: { chave: true },
      }),
    ]);
    const repetidas = new Set(jaExistem.map((t) => t.chave));
    const desconhecidas = [
      ...new Set(r.transacoes.filter((t) => !placas.has(normalizarPlacaCartao(t.placa))).map((t) => t.placa)),
    ];
    const datas = r.transacoes.map((t) => t.data.getTime());
    return {
      aba: r.aba,
      colunas: CAMPOS_EXTRATO.map((c) => ({ ...c, achada: r.mapa[c.chave] !== undefined })),
      total: r.transacoes.length,
      novas: r.transacoes.filter((t) => !repetidas.has(t.chave)).length,
      repetidas: repetidas.size,
      ignoradas: r.ignoradas,
      erros: r.erros.slice(0, 50),
      totalErros: r.erros.length,
      placasDesconhecidas: desconhecidas.slice(0, 30),
      valor: Math.round(r.transacoes.reduce((s, t) => s + t.valor, 0) * 100) / 100,
      periodo: datas.length
        ? { de: new Date(Math.min(...datas)).toISOString(), ate: new Date(Math.max(...datas)).toISOString() }
        : null,
    };
  }

  async importar(arquivo: Arquivo | undefined, operadora: string | null, usuarioId: string) {
    const r = await this.ler(arquivo);
    if (r.transacoes.length === 0) throw new BadRequestException("O extrato não tem nenhuma passada pra importar.");
    const placas = await this.placasDoCadastro();
    const datas = r.transacoes.map((t) => t.data.getTime());

    return this.prisma.$transaction(async (tx) => {
      const extrato = await tx.extratoCartao.create({
        data: {
          nomeArquivo: arquivo!.originalname.slice(0, 200),
          operadora: operadora?.trim().slice(0, 60) || null,
          periodoDe: new Date(Math.min(...datas)),
          periodoAte: new Date(Math.max(...datas)),
          transacoes: 0,
          importadoPorId: usuarioId,
        },
      });
      const criadas = await tx.transacaoCartao.createMany({
        data: r.transacoes.map((t) => ({
          extratoId: extrato.id,
          chave: t.chave,
          data: t.data,
          placa: t.placa.slice(0, 20),
          veiculoId: placas.get(normalizarPlacaCartao(t.placa)) ?? null,
          motorista: t.motorista?.slice(0, 120) ?? null,
          posto: t.posto?.slice(0, 160) ?? null,
          combustivel: t.combustivel?.slice(0, 60) ?? null,
          litros: t.litros,
          valor: t.valor,
          odometro: t.odometro,
        })),
        // A mesma passada vinda de outro extrato (ou do mesmo, subido de novo) fica como estava.
        skipDuplicates: true,
      });
      return tx.extratoCartao.update({ where: { id: extrato.id }, data: { transacoes: criadas.count } });
    });
  }

  listarExtratos() {
    return this.prisma.extratoCartao.findMany({
      orderBy: { importadoEm: "desc" },
      take: 50,
      include: { importadoPor: { select: { nome: true } } },
    });
  }

  /** Desfaz uma importação errada (arquivo trocado, mês errado). Leva as passadas dela. */
  async excluirExtrato(id: string) {
    const e = await this.prisma.extratoCartao.findUnique({ where: { id }, select: { id: true } });
    if (!e) throw new NotFoundException("Extrato não encontrado.");
    await this.prisma.extratoCartao.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * As passadas do período ao lado do que foi lançado. Calculado agora, não
   * gravado: o abastecimento que o motorista lançar amanhã já casa amanhã.
   */
  async conciliacao(q: { de: string; ate: string; situacao?: SituacaoConciliacao }, escopo: EscopoAdmin) {
    const inicio = inicioDoDiaBR(q.de);
    const fim = new Date(inicioDoDiaBR(q.ate).getTime() + 86_400_000);
    const filtroVeiculo = escopo ? { veiculo: filtroEscopo(escopo) as Prisma.VeiculoWhereInput } : {};

    const transacoes = await this.prisma.transacaoCartao.findMany({
      where: { data: { gte: inicio, lt: fim }, ...filtroVeiculo },
      orderBy: { data: "desc" },
      include: { veiculo: { select: { id: true, placa: true } } },
    });
    // Um dia de folga de cada lado: o casamento aceita o dia vizinho.
    const veiculoIds = [...new Set(transacoes.map((t) => t.veiculoId).filter((v): v is string => v != null))];
    const abastecimentos = await this.prisma.abastecimento.findMany({
      where: {
        data: { gte: new Date(inicio.getTime() - 86_400_000), lt: new Date(fim.getTime() + 86_400_000) },
        ...(escopo ? { veiculo: filtroEscopo(escopo) as Prisma.VeiculoWhereInput } : {}),
      },
      select: {
        id: true,
        veiculoId: true,
        data: true,
        litros: true,
        valorTotal: true,
        emComboio: true,
        postoNome: true,
        motorista: { select: { nome: true } },
        veiculo: { select: { placa: true } },
      },
    });

    const { itens, lancadosSemCartao } = conciliarCartao(
      transacoes.map((t) => ({
        id: t.id,
        data: t.data,
        placa: t.placa,
        veiculoId: t.veiculoId,
        litros: t.litros != null ? Number(t.litros) : null,
        valor: Number(t.valor),
      })),
      abastecimentos.map((a) => ({
        id: a.id,
        veiculoId: a.veiculoId,
        data: a.data,
        litros: Number(a.litros),
        valorTotal: a.valorTotal != null ? Number(a.valorTotal) : null,
        emComboio: a.emComboio,
      })),
    );

    const abastPorId = new Map(abastecimentos.map((a) => [a.id, a]));
    const itemPorId = new Map(itens.map((i) => [i.transacaoId, i]));
    const linhas = transacoes.map((t) => {
      const it = itemPorId.get(t.id)!;
      const a = it.abastecimentoId ? abastPorId.get(it.abastecimentoId) : undefined;
      return {
        id: t.id,
        data: t.data,
        placa: t.veiculo?.placa ?? t.placa,
        veiculoId: t.veiculoId,
        motorista: t.motorista,
        posto: t.posto,
        combustivel: t.combustivel,
        litros: t.litros != null ? Number(t.litros) : null,
        valor: Number(t.valor),
        situacao: it.situacao,
        texto: it.texto,
        lancado: a
          ? {
              id: a.id,
              data: a.data,
              litros: Number(a.litros),
              valor: a.valorTotal != null ? Number(a.valorTotal) : null,
              motorista: a.motorista.nome,
            }
          : null,
      };
    });

    const resumo = { CONFERE: 0, DIVERGE: 0, SO_NO_CARTAO: 0, PLACA_DESCONHECIDA: 0 } as Record<SituacaoConciliacao, number>;
    for (const l of linhas) resumo[l.situacao]++;
    // Só conta os lançados de caminhões que aparecem no extrato: caminhão que
    // não usa cartão não é "lançado sem cartão", é outro jeito de pagar.
    const noExtrato = new Set(veiculoIds);
    const semCartao = lancadosSemCartao
      .map((id) => abastPorId.get(id)!)
      .filter((a) => noExtrato.has(a.veiculoId) && a.data >= inicio && a.data < fim);

    return {
      periodo: { de: q.de, ate: q.ate },
      resumo: {
        ...resumo,
        valorCartao: Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 100) / 100,
        valorSemLancamento:
          Math.round(linhas.filter((l) => l.situacao === "SO_NO_CARTAO").reduce((s, l) => s + l.valor, 0) * 100) / 100,
        lancadosSemCartao: semCartao.length,
      },
      linhas: q.situacao ? linhas.filter((l) => l.situacao === q.situacao) : linhas,
      lancadosSemCartao: semCartao.slice(0, 100).map((a) => ({
        id: a.id,
        data: a.data,
        placa: a.veiculo.placa,
        motorista: a.motorista.nome,
        litros: Number(a.litros),
        valor: a.valorTotal != null ? Number(a.valorTotal) : null,
        posto: a.postoNome,
      })),
    };
  }
}
