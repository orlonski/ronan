import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import {
  RETENCAO_PDF_TAG_MESES,
  type AceitarSugestoesTagInput,
  type ConfirmarPracaTagInput,
  type DecidirAchadoTagInput,
  type DecidirLigacaoTagInput,
  type EixosVeiculoInput,
  type ResponderCargaTagInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { contaIdAtual, comoSistema } from "../../common/conta/conta-context";
import { comLockDeCron } from "../../common/cron-exclusivo";
import type { AuthAdminUser } from "../../auth/types";
import { lerFaturaSemParar, type LeituraFatura } from "../../common/tag-pedagio/leitor-sem-parar";
import {
  chaveDaPraca,
  chavesDasLinhas,
  eixosDaCategoria,
  instanteDaPassagem,
  MIN,
  normalizarPlaca,
  offsetDaUf,
  rotuloHora,
  ufDaPassagem,
  variantesDaPlaca,
  type LinhaParaChave,
} from "../../common/tag-pedagio/normalizacao";
import { TagProcessamentoService } from "./tag-processamento.service";
import { pedagioDaViagem } from "../../common/acerto-motorista";
import { decisaoAindaVale, situacaoTagDaViagem } from "../../common/tag-pedagio/pedagio-lancado";
import { tagDasViagens } from "../../common/tag-pedagio/tag-das-viagens";

type Arquivo = { buffer: Buffer; originalname: string; mimetype: string; size?: number };

const OPERADORA = "SEM_PARAR";
const MAX_BYTES = 15 * 1024 * 1024;
const cent = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Math.round(Number(d) * 100));
const reais = (c: number) => c / 100;
const raizCnpj = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(0, 8);

/** Status final de um trecho: decisão de gente > ligação do sistema > sugestão. */
type Cruzamento = {
  status: string;
  viagemId: string | null;
  ligariaSozinho: boolean;
  motivo: string;
  candidatas: { viagemId: string; pontos: number; razao: string; janela: string }[];
  pracas: string[];
};

async function textoDoPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    return (await parser.getText()).text ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Conferência da tag de pedágio (módulo `tag-pedagio`). Importa a fatura do
 * Sem Parar, guarda o PDF (só a API serve), roda o motor e responde às telas
 * do raio-x, do casamento e das praças. Toda decisão tem autor e é desfazível.
 */
@Injectable()
export class TagPedagioService {
  private readonly log = new Logger(TagPedagioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly motor: TagProcessamentoService,
  ) {}

  // ============================================================ importar

  async importar(arquivo: Arquivo | undefined, confirmarCnpj: boolean, user: AuthAdminUser) {
    if (!arquivo) throw new BadRequestException("Envie o PDF da fatura do Sem Parar.");
    if (!/pdf$/i.test(arquivo.mimetype) && !/\.pdf$/i.test(arquivo.originalname))
      throw new BadRequestException("Envie a fatura em PDF, do jeito que o Sem Parar manda.");
    if (arquivo.buffer.length > MAX_BYTES) throw new BadRequestException("O PDF passa de 15 MB.");
    const nomeArquivo = arquivo.originalname.slice(0, 200);
    const hashArquivo = createHash("sha256").update(arquivo.buffer).digest("hex");

    const mesmoArquivo = await this.prisma.extratoTag.findUnique({
      where: { contaId_hashArquivo: { contaId: contaIdAtual(), hashArquivo } },
    });
    if (mesmoArquivo && mesmoArquivo.status !== "FALHOU")
      return { jaImportado: true as const, extrato: this.resumoExtrato(mesmoArquivo), motivo: `Este arquivo já foi importado em ${mesmoArquivo.importadoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` };
    if (mesmoArquivo) await this.prisma.extratoTag.delete({ where: { id: mesmoArquivo.id } });

    let leitura: LeituraFatura;
    try {
      leitura = lerFaturaSemParar(await textoDoPdf(arquivo.buffer));
    } catch (e) {
      this.log.warn(`PDF da tag não abriu: ${(e as Error).message}`);
      return this.gravarFalha(nomeArquivo, hashArquivo, user.id, "Não consegui abrir o PDF. Confira se o arquivo não está corrompido ou protegido por senha.", null);
    }
    if (leitura.status === "FALHOU") return this.gravarFalha(nomeArquivo, hashArquivo, user.id, leitura.motivo!, leitura);

    // A mesma fatura baixada de novo muda de hash (o PDF carimba data): o nº resolve.
    const mesmaFatura = await this.prisma.extratoTag.findFirst({
      where: { operadora: OPERADORA, numeroFatura: leitura.cabecalho.numeroFatura, status: { not: "FALHOU" } },
    });
    if (mesmaFatura)
      return { jaImportado: true as const, extrato: this.resumoExtrato(mesmaFatura), motivo: `A fatura ${leitura.cabecalho.numeroFatura} já foi importada em ${mesmaFatura.importadoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` };

    // A fatura é desta empresa? (04-qa I4) Raiz do CNPJ, porque a fatura traz o da filial.
    const conta = await this.prisma.conta.findUnique({ where: { id: contaIdAtual() }, select: { cnpj: true, nome: true } });
    const bate = !!conta?.cnpj && raizCnpj(conta.cnpj) === raizCnpj(leitura.cabecalho.cnpj);
    if (!bate && !confirmarCnpj)
      throw new ConflictException({
        code: "CNPJ_DIFERENTE",
        message: conta?.cnpj
          ? `Esta fatura é de ${leitura.cabecalho.nome ?? "outra empresa"} (CNPJ ${formatarCnpj(leitura.cabecalho.cnpj)}), e o CNPJ desta empresa é outro. É mesmo dela?`
          : `Esta fatura é de ${leitura.cabecalho.nome ?? "?"} (CNPJ ${formatarCnpj(leitura.cabecalho.cnpj)}), e a empresa não tem CNPJ cadastrado pra conferir. É mesmo dela?`,
        nomeLido: leitura.cabecalho.nome,
        cnpjLido: leitura.cabecalho.cnpj,
      });

    const arquivoKey = await this.uploads.putFaturaTag(arquivo.buffer);
    const expira = new Date();
    expira.setMonth(expira.getMonth() + RETENCAO_PDF_TAG_MESES);

    try {
      const extrato = await this.gravarLeitura(leitura, {
        nomeArquivo,
        hashArquivo,
        arquivoKey,
        arquivoExpiraEm: expira,
        importadoPorId: user.id,
        cnpjConfirmadoPorId: bate ? null : user.id,
      });
      try {
        await this.motor.processar();
      } catch (e) {
        this.log.error(`Processamento da tag falhou: ${(e as Error).stack ?? e}`);
      }
      return { jaImportado: false as const, extrato: this.resumoExtrato(extrato), motivo: extrato.motivo };
    } catch (e) {
      await this.uploads.removerObjeto(arquivoKey);
      throw e;
    }
  }

  private async gravarFalha(nomeArquivo: string, hashArquivo: string, usuarioId: string, motivo: string, leitura: LeituraFatura | null) {
    const extrato = await this.prisma.extratoTag.create({
      data: {
        operadora: OPERADORA,
        formato: "PDF_FATURA",
        status: "FALHOU",
        motivo,
        nomeArquivo,
        hashArquivo,
        numeroFatura: leitura?.cabecalho.numeroFatura ?? null,
        conferencia: (leitura ? { checagens: leitura.checagens, naoLidas: leitura.naoLidas.slice(0, 50) } : {}) as Prisma.InputJsonValue,
        importadoPorId: usuarioId,
      },
    });
    return { jaImportado: false as const, extrato: this.resumoExtrato(extrato), motivo };
  }

  private async gravarLeitura(
    leitura: LeituraFatura,
    meta: {
      nomeArquivo: string;
      hashArquivo: string;
      arquivoKey: string;
      arquivoExpiraEm: Date;
      importadoPorId: string;
      cnpjConfirmadoPorId: string | null;
    },
  ) {
    const veiculos = await this.prisma.veiculo.findMany({ select: { id: true, placa: true } });
    const veiculoDe = new Map<string, string>();
    for (const v of veiculos) for (const x of variantesDaPlaca(v.placa)) veiculoDe.set(x, v.id);

    // Concessionária da praça (a linha C do vale não traz): pelas passagens e pelas linhas D.
    const concDaPraca = new Map<string, string>();
    for (const b of leitura.placas)
      for (const x of [...b.passagens, ...b.vales]) if (x.concessionaria) concDaPraca.set(chaveDaPraca(x.rodovia, x.kmMetros), x.concessionaria);

    const linhas: (LinhaParaChave & { linha: (typeof leitura.placas)[number]["passagens"][number] & { embarcadorTexto?: string } })[] = [];
    for (const b of leitura.placas) {
      for (const x of b.passagens) linhas.push({ ...x, linha: x, operadora: OPERADORA, placa: b.placa, tipo: "PEDAGIO" });
      for (const x of b.vales)
        linhas.push({ ...x, linha: x, operadora: OPERADORA, placa: b.placa, tipo: "VALE", numeroViagemVale: x.numeroViagem });
    }
    const chaves = chavesDasLinhas(linhas);
    const c4 = leitura.checagens.find((c) => c.n === 4);
    const valeNaoConfiavel = leitura.placas
      .filter((b) => c4 && !c4.ok && c4.detalhe.includes(`${b.placa}: vale`))
      .map((b) => b.placa);
    const totalNota = leitura.nf.totalCent;

    return this.prisma.$transaction(
      async (tx) => {
        const extrato = await tx.extratoTag.create({
          data: {
            operadora: OPERADORA,
            formato: "PDF_FATURA",
            status: leitura.status,
            motivo: leitura.motivo,
            nomeArquivo: meta.nomeArquivo,
            hashArquivo: meta.hashArquivo,
            arquivoKey: meta.arquivoKey,
            arquivoExpiraEm: meta.arquivoExpiraEm,
            numeroFatura: leitura.cabecalho.numeroFatura,
            numeroNotaFiscal: leitura.cabecalho.numeroNotaFiscal,
            codigoCliente: leitura.cabecalho.codigoCliente,
            cnpjFatura: leitura.cabecalho.cnpj,
            nomeFatura: leitura.cabecalho.nome,
            cnpjConfirmadoPorId: meta.cnpjConfirmadoPorId,
            periodoDe: leitura.cabecalho.periodoDe ? new Date(leitura.cabecalho.periodoDe) : null,
            periodoAte: leitura.cabecalho.periodoAte ? new Date(leitura.cabecalho.periodoAte) : null,
            emitidoEm: leitura.cabecalho.emitidoEm ? new Date(leitura.cabecalho.emitidoEm) : null,
            totalNota: totalNota == null ? null : reais(totalNota),
            conferencia: {
              checagens: leitura.checagens,
              naoLidas: leitura.naoLidas,
              recargas: leitura.recargas,
              nf: leitura.nf,
              registrosCrus: leitura.registrosCrus,
              valeNaoConfiavel,
            } as unknown as Prisma.InputJsonValue,
            passagens: linhas.length,
            importadoPorId: meta.importadoPorId,
          },
        });
        for (const b of leitura.placas) {
          const r = leitura.resumo.find((x) => x.placa === b.placa);
          const soma =
            b.passagens.reduce((s, x) => s + (x.dc === "D" ? x.valorCent : -x.valorCent), 0) +
            b.vales.reduce((s, x) => s + (x.dc === "D" ? x.valorCent : -x.valorCent), 0);
          await tx.extratoTagVeiculo.create({
            data: {
              extratoId: extrato.id,
              placaTexto: b.placa,
              veiculoId: veiculoDe.get(b.placa) ?? null,
              plano: reais(r?.planoCent ?? 0),
              uso: reais(r?.usoCent ?? soma),
              qtdUsos: r?.qtd ?? b.passagens.length + b.vales.length,
              outras: reais(b.totais.outrasCent ?? 0),
              somaDetalhe: reais(soma),
              qtdDetalhe: b.passagens.length + b.vales.length,
              ajuste: reais((r?.usoCent ?? soma) - soma),
              taxas: [
                ...leitura.planos.filter((p) => p.placa === b.placa).map((p) => ({ descricao: p.descricao, valorCent: p.valorCent })),
                ...b.outras.map((o) => ({ descricao: o.descricao, valorCent: o.dc === "C" ? -o.valorCent : o.valorCent })),
              ] as Prisma.InputJsonValue,
            },
          });
        }
        await tx.passagemTag.createMany({
          data: linhas.map((x, i) => {
            const chavePraca = chaveDaPraca(x.rodovia, x.kmMetros);
            const conc = x.linha.concessionaria ?? concDaPraca.get(chavePraca) ?? null;
            const uf = ufDaPassagem(conc, x.rodovia);
            const offset = offsetDaUf(uf);
            return {
              extratoId: extrato.id,
              chave: chaves[i]!,
              tipo: x.tipo,
              dc: x.dc,
              placaTexto: x.placa,
              veiculoId: veiculoDe.get(normalizarPlaca(x.placa)) ?? null,
              ocorridoEm: instanteDaPassagem(x.data, x.hora, offset),
              dataHoraTexto: `${x.data} ${x.hora}`,
              fusoOffsetMin: offset,
              concessionaria: conc,
              pracaTexto: x.linha.pracaTexto,
              chavePraca,
              rodovia: x.rodovia,
              kmMetros: x.kmMetros,
              sentido: x.sentido,
              cidade: x.linha.cidade,
              uf,
              categoria: x.categoria,
              eixosCobrados: eixosDaCategoria(x.categoria) ?? 0,
              valor: reais(x.valorCent),
              embarcadorTexto: x.linha.embarcadorTexto ?? null,
              numeroViagemVale: x.numeroViagemVale ?? null,
              linhaOriginal: x.linha.original.slice(0, 500),
              linhaPdf: x.linha.linha,
            };
          }),
        });
        return extrato;
      },
      { timeout: 60_000 },
    );
  }

  private resumoExtrato(e: {
    id: string;
    status: string;
    motivo: string | null;
    nomeArquivo: string;
    numeroFatura: string | null;
    periodoDe: Date | null;
    periodoAte: Date | null;
    importadoEm: Date;
    passagens: number;
  }) {
    return {
      id: e.id,
      status: e.status,
      motivo: e.motivo,
      nomeArquivo: e.nomeArquivo,
      numeroFatura: e.numeroFatura,
      periodoDe: e.periodoDe,
      periodoAte: e.periodoAte,
      importadoEm: e.importadoEm,
      passagens: e.passagens,
    };
  }

  async listarExtratos() {
    const es = await this.prisma.extratoTag.findMany({
      orderBy: [{ periodoAte: "desc" }, { importadoEm: "desc" }],
      take: 60,
      include: {
        importadoPor: { select: { nome: true } },
        veiculos: { select: { placaTexto: true, somaDetalhe: true, veiculoId: true } },
      },
    });
    return es.map((e) => ({
      ...this.resumoExtrato(e),
      nomeFatura: e.nomeFatura,
      cnpjConfirmado: !!e.cnpjConfirmadoPorId,
      temArquivo: !!e.arquivoKey,
      arquivoExpiraEm: e.arquivoExpiraEm,
      importadoPor: e.importadoPor?.nome ?? null,
      placas: e.veiculos.map((v) => ({ placa: v.placaTexto, pedagio: Number(v.somaDetalhe), cadastrada: !!v.veiculoId })),
      totalPedagio: e.veiculos.reduce((s, v) => s + Number(v.somaDetalhe), 0),
      checagens: ((e.conferencia as { checagens?: unknown[] })?.checagens ?? []) as { n: number; nome: string; ok: boolean; detalhe: string }[],
      naoLidas: (((e.conferencia as { naoLidas?: unknown[] })?.naoLidas ?? []) as { linha: number; texto: string; motivo: string }[]).slice(0, 20),
    }));
  }

  /** Desfaz a importação: some com as passagens, o PDF e o que foi calculado delas. */
  async excluirExtrato(id: string) {
    const e = await this.prisma.extratoTag.findUnique({ where: { id }, select: { id: true, arquivoKey: true } });
    if (!e) throw new NotFoundException("Fatura não encontrada.");
    await this.prisma.extratoTag.delete({ where: { id } });
    if (e.arquivoKey) await this.uploads.removerObjeto(e.arquivoKey);
    await this.motor.processar();
    return { ok: true };
  }

  async arquivo(id: string): Promise<{ buffer: Buffer; nome: string }> {
    const e = await this.prisma.extratoTag.findUnique({ where: { id }, select: { arquivoKey: true, nomeArquivo: true } });
    if (!e) throw new NotFoundException("Fatura não encontrada.");
    if (!e.arquivoKey) throw new NotFoundException("O PDF original desta fatura não está mais guardado.");
    return { buffer: await this.uploads.getObjectBuffer(e.arquivoKey), nome: e.nomeArquivo };
  }

  recalcular() {
    return this.motor.processar();
  }

  // ============================================================ leituras

  /** Decisões de gente e ligações do sistema, por âncora. */
  private async ligacoesAtivas(ancoras: string[]) {
    const ls = await this.prisma.ligacaoTagViagem.findMany({
      where: { passagemAncoraId: { in: ancoras }, desfeitaEm: null },
      orderBy: { criadoEm: "desc" },
    });
    const m = new Map<string, (typeof ls)[number]>();
    for (const l of ls) if (!m.has(l.passagemAncoraId)) m.set(l.passagemAncoraId, l);
    return m;
  }

  /** "decidido" | "sugestao" | ... — o estado que a tela mostra pro trecho. */
  private situacao(t: { estado: string; cruzamento: unknown }, lig: { tipo: string; viagemId: string | null; autorId: string | null } | undefined) {
    const c = t.cruzamento as Cruzamento;
    if (lig) {
      return {
        situacao: lig.tipo === "AUTO" ? "LIGADA_SOZINHA" : lig.tipo === "NAO_E_VIAGEM" ? "NAO_E_VIAGEM" : lig.tipo === "RETORNO" ? "RETORNO_CONFIRMADO" : "LIGADA",
        viagemId: lig.viagemId,
        decidida: true,
      };
    }
    const mapa: Record<string, string> = {
      SUGESTAO: c.ligariaSozinho ? "LIGARIA_SOZINHA" : "SUGESTAO",
      SOBRA: "SEM_VIAGEM",
      RETORNO: "RETORNO",
      IDA_VAZIA: "IDA_VAZIA",
      VAZIO_SOLTO: "VAZIO_SOLTO",
      AUTO: "LIGADA_SOZINHA",
    };
    return { situacao: mapa[c.status] ?? c.status, viagemId: c.viagemId, decidida: false };
  }

  private async passagensPorId(ids: string[]) {
    const ps = await this.prisma.passagemTag.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        tipo: true,
        dc: true,
        ocorridoEm: true,
        fusoOffsetMin: true,
        dataHoraTexto: true,
        cidade: true,
        rodovia: true,
        kmMetros: true,
        sentido: true,
        categoria: true,
        eixosCobrados: true,
        valor: true,
        placaTexto: true,
        embarcadorTexto: true,
        numeroViagemVale: true,
        concessionaria: true,
      },
    });
    return new Map(
      ps.map((p) => [
        p.id,
        {
          id: p.id,
          tipo: p.tipo,
          dc: p.dc,
          quando: p.dataHoraTexto,
          hora: rotuloHora(p.ocorridoEm.getTime(), p.fusoOffsetMin).slice(6),
          ocorridoEm: p.ocorridoEm,
          praca: `${p.cidade} (${p.rodovia} km ${(p.kmMetros / 1000).toLocaleString("pt-BR")})`,
          cidade: p.cidade,
          sentido: p.sentido,
          categoria: p.categoria,
          eixos: p.eixosCobrados,
          valor: Number(p.valor),
          placa: p.placaTexto,
          concessionaria: p.concessionaria,
          vale: p.tipo === "VALE" ? { viagem: p.numeroViagemVale } : null,
        },
      ]),
    );
  }

  private async rotulosDeViagens(ids: string[]) {
    if (!ids.length) return new Map<string, { id: string; rotulo: string; data: string | null; placa: string; empresaId: string | null; motorista: string; guiada: boolean }>();
    const vs = await this.prisma.viagem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        data: true,
        iniciadoEm: true,
        status: true,
        veiculo: { select: { placa: true } },
        motorista: { select: { nome: true } },
        localCarga: { select: { nome: true, cidade: true } },
        localDescarga: { select: { nome: true, cidade: true } },
        cliente: { select: { nome: true, empresaId: true } },
      },
    });
    return new Map(
      vs.map((v) => [
        v.id,
        {
          id: v.id,
          rotulo: `${v.localCarga?.cidade ?? v.localCarga?.nome ?? "?"} → ${v.localDescarga?.cidade ?? v.localDescarga?.nome ?? "?"}`,
          data: v.data ? v.data.toISOString().slice(0, 10) : v.iniciadoEm ? v.iniciadoEm.toISOString().slice(0, 10) : null,
          placa: v.veiculo.placa,
          empresaId: v.cliente?.empresaId ?? null,
          cliente: v.cliente?.nome ?? null,
          motorista: v.motorista.nome,
          guiada: !!v.iniciadoEm,
        },
      ]),
    );
  }

  /** O raio-x de uma fatura: três caixas, cada passagem em uma só. */
  async raioX(extratoId: string) {
    const e = await this.prisma.extratoTag.findUnique({
      where: { id: extratoId },
      include: { veiculos: { include: { veiculo: { select: { id: true, placa: true, tipoProprietario: true, cpfCnpjProprietario: true } } } } },
    });
    if (!e) throw new NotFoundException("Fatura não encontrada.");
    const conta = await this.prisma.conta.findUnique({ where: { id: contaIdAtual() }, select: { cnpj: true, ligacaoAutomaticaTag: true } });
    const achados = await this.prisma.achadoTag.findMany({ where: { extratoId, vigente: true }, orderBy: [{ valor: "desc" }] });
    const ancoras = achados.map((a) => a.passagemAncoraId).filter((x): x is string => !!x);
    const respostas = await this.prisma.respostaCargaTag.findMany({
      where: { passagemAncoraId: { in: ancoras } },
      include: { empresa: { select: { id: true, nome: true } } },
    });
    const respostaDe = new Map(respostas.map((r) => [r.passagemAncoraId, r]));
    const passagens = await this.passagensPorId(achados.flatMap((a) => a.passagemIds));

    // Sugestão de "de quem era a carga": o cliente da viagem ligada ao 1º trecho.
    const trechos = await this.prisma.trechoTag.findMany({
      where: {
        placaTexto: { in: e.veiculos.map((v) => v.placaTexto) },
        ...(e.periodoDe && e.periodoAte ? { ini: { gte: new Date(e.periodoDe.getTime() - 86_400_000), lte: new Date(e.periodoAte.getTime() + 2 * 86_400_000) } } : {}),
      },
      orderBy: { ini: "asc" },
    });
    const ligs = await this.ligacoesAtivas(trechos.map((t) => t.passagemAncoraId));
    const viagemDoTrecho = new Map<string, string | null>();
    for (const t of trechos) viagemDoTrecho.set(t.passagemAncoraId, this.situacao(t, ligs.get(t.passagemAncoraId)).viagemId ?? null);
    const rotulos = await this.rotulosDeViagens([...new Set([...viagemDoTrecho.values()].filter((x): x is string => !!x))]);

    const itens = achados.map((a) => {
      const r = a.passagemAncoraId ? respostaDe.get(a.passagemAncoraId) : undefined;
      const viagemId = a.passagemAncoraId ? viagemDoTrecho.get(a.passagemAncoraId) ?? null : null;
      const viagem = viagemId ? rotulos.get(viagemId) ?? null : null;
      return {
        id: a.id,
        tipo: a.tipo,
        caixa: a.caixa,
        placa: a.placaTexto,
        valor: a.valor == null ? null : Number(a.valor),
        titulo: a.titulo,
        explicacao: a.explicacao,
        explicacoes: (a.explicacoes as string[] | null) ?? null,
        prazoEm: a.prazoEm,
        status: a.status,
        motivo: a.motivo,
        passagemAncoraId: a.passagemAncoraId,
        passagens: a.passagemIds.map((id) => passagens.get(id)).filter(Boolean),
        viagem,
        resposta: r
          ? { resposta: r.resposta, empresa: r.empresa, comprovante: r.comprovante, observacao: r.observacao, respondidoEm: r.respondidoEm }
          : null,
        empresaSugeridaId: viagem?.empresaId ?? null,
      };
    });

    const carregados = itens.filter((i) => i.tipo === "CARREGADO_SEM_VALE");
    const abertos = carregados.filter((i) => !i.resposta || i.resposta.resposta === "NAO_SEI" || i.resposta.resposta === "CLIENTE");
    const parcial = itens.filter((i) => i.tipo === "VALE_PARCIAL");
    const confirmados = carregados.filter((i) => i.resposta?.resposta === "CLIENTE");
    const soma = (xs: { valor: number | null }[]) => Math.round(xs.reduce((s, x) => s + (x.valor ?? 0), 0) * 100) / 100;
    const contestar = itens.filter((i) => i.caixa === "PRA_CONTESTAR" && i.status !== "DESCARTADO");
    const prazos = contestar.map((i) => i.prazoEm).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime());

    // Viagens × tag (só o período desta fatura).
    const doPeriodo = trechos.filter((t) => !e.periodoDe || !e.periodoAte || (t.ini >= e.periodoDe && t.ini.getTime() <= e.periodoAte.getTime() + 86_400_000 + 6 * 3_600_000));
    const sit = doPeriodo.map((t) => ({ t, s: this.situacao(t, ligs.get(t.passagemAncoraId)) }));
    const conta_ = (f: (x: (typeof sit)[number]) => boolean) => sit.filter(f);
    const valorDe = (xs: typeof sit) => Math.round(xs.reduce((s, x) => s + Number(x.t.valorTag), 0) * 100) / 100;
    const ligadas = conta_((x) => ["LIGADA_SOZINHA", "LIGADA"].includes(x.s.situacao));
    const sugestoes = conta_((x) => ["SUGESTAO", "LIGARIA_SOZINHA"].includes(x.s.situacao));
    const semViagem = conta_((x) => x.s.situacao === "SEM_VIAGEM");
    const soltos = conta_((x) => x.s.situacao === "VAZIO_SOLTO");
    const retornos = conta_((x) => ["RETORNO", "IDA_VAZIA", "RETORNO_CONFIRMADO"].includes(x.s.situacao));

    // Viagem lançada com praça (da fatura) na rota e NENHUMA passagem ligada ou
    // sugerida: a tag não leu, pagou por fora, foi outro caminho — ou a viagem
    // não existiu como lançada. Não é achado contra ninguém (03, 1.4.9).
    const veiculoIds = e.veiculos.map((v) => v.veiculoId).filter((x): x is string => !!x);
    const viagensPeriodo =
      veiculoIds.length && e.periodoDe && e.periodoAte
        ? await this.prisma.viagem.findMany({
            where: { veiculoId: { in: veiculoIds }, data: { gte: e.periodoDe, lte: e.periodoAte } },
            select: { id: true },
          })
        : [];
    const tocadas = new Set<string>([
      ...[...viagemDoTrecho.values()].filter((x): x is string => !!x),
      ...trechos.flatMap((t) => ((t.cruzamento as Cruzamento).candidatas ?? []).map((c) => c.viagemId)),
    ]);
    const semTocar = viagensPeriodo.map((v) => v.id).filter((id) => !tocadas.has(id));
    const rotas = semTocar.length ? await this.motor.pracasDasViagens(semTocar) : new Map();
    const semPassagem = semTocar
      .map((id) => ({ id, pracas: ((rotas.get(id) ?? []) as { chave: string; nome: string }[]).filter((p) => !p.chave.startsWith("?")) }))
      .filter((x) => x.pracas.length > 0);
    const rotSem = await this.rotulosDeViagens(semPassagem.map((x) => x.id));
    const terceiro = (v: { tipoProprietario: string | null; cpfCnpjProprietario: string | null } | null) =>
      !!v && (/TERC/i.test(v.tipoProprietario ?? "") || (!!v.cpfCnpjProprietario && !!conta?.cnpj && raizCnpj(v.cpfCnpjProprietario) !== raizCnpj(conta.cnpj)));
    const conferencia = e.conferencia as { checagens?: unknown[]; naoLidas?: unknown[] };

    return {
      extrato: {
        ...this.resumoExtrato(e),
        nomeFatura: e.nomeFatura,
        cnpjConfirmado: !!e.cnpjConfirmadoPorId,
        temArquivo: !!e.arquivoKey,
        totalNota: e.totalNota == null ? null : Number(e.totalNota),
        checagens: conferencia.checagens ?? [],
        naoLidas: conferencia.naoLidas ?? [],
        placas: e.veiculos.map((v) => ({
          placa: v.placaTexto,
          pedagio: Number(v.somaDetalhe),
          usos: v.qtdDetalhe,
          veiculoId: v.veiculoId,
          cadastrada: !!v.veiculoId,
          terceiro: terceiro(v.veiculo),
        })),
        totalPedagio: e.veiculos.reduce((s, v) => s + Number(v.somaDetalhe), 0),
      },
      ligacaoAutomatica: !!conta?.ligacaoAutomaticaTag,
      podeSerSeu: {
        ate: soma([...abertos, ...parcial]),
        viagens: abertos.length,
        carregadoSemVale: soma(abertos),
        valeParcial: soma(parcial),
        confirmado: soma(confirmados),
        viagensConfirmadas: confirmados.length,
        itens: itens.filter((i) => i.caixa === "PODE_SER_SEU"),
      },
      praContestar: {
        valor: soma(contestar),
        prazoAte: prazos[0] ?? null,
        itens: itens.filter((i) => i.caixa === "PRA_CONTESTAR"),
      },
      praConversar: {
        valor: soma(itens.filter((i) => i.caixa === "PRA_CONVERSAR")),
        itens: itens.filter((i) => i.caixa === "PRA_CONVERSAR"),
      },
      viagensSemPassagem: semPassagem.map((x) => ({ viagem: rotSem.get(x.id) ?? null, pracas: x.pracas.length })),
      viagensXTag: {
        ligadas: ligadas.length,
        sugestoes: sugestoes.length,
        ligariamSozinhas: sugestoes.filter((x) => x.s.situacao === "LIGARIA_SOZINHA").length,
        semViagem: { trechos: semViagem.length, valor: valorDe(semViagem) },
        vaziosSoltos: { trechos: soltos.length, valor: valorDe(soltos) },
        retornos: { trechos: retornos.length, valor: valorDe(retornos) },
        carregados: doPeriodo.filter((t) => t.estado === "CARREGADO").length,
      },
    };
  }

  /** "Casar passagens com viagens": um caminhão, um dia. */
  /**
   * O quadro "Pedágio pela tag" da ficha da viagem: as passagens ligadas a ela
   * (ida e volta vazia), o que ficou como sugestão esperando alguém, o que o
   * motorista lançou e o que o acerto sugere devolver. Só leitura.
   */
  async daViagem(viagemId: string) {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        data: true,
        veiculoId: true,
        valorPedagioTotal: true,
        pedagios: { select: { id: true, valor: true } },
        veiculo: { select: { placa: true } },
      },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada.");
    const tag = await tagDasViagens(this.prisma, [v]);
    if (!tag) return { modulo: false as const };
    const t = tag.get(v.id)!;
    const lancado = pedagioDaViagem(v).valor;
    const sit = situacaoTagDaViagem({ ...t, lancado });

    const ligs = await this.prisma.ligacaoTagViagem.findMany({
      where: { viagemId: v.id, desfeitaEm: null, tipo: { not: "NAO_E_VIAGEM" } },
      select: { passagemAncoraId: true, tipo: true, criadoEm: true },
    });
    // Sugestões que apontam pra esta viagem e ninguém decidiu: o caminhão, numa
    // janela larga em volta da data (viagem longa passa praça dias depois).
    const d0 = v.data ?? new Date();
    const vizinhos = v.veiculoId
      ? await this.prisma.trechoTag.findMany({
          where: {
            veiculoId: v.veiculoId,
            ini: { gte: new Date(d0.getTime() - 2 * 86_400_000), lte: new Date(d0.getTime() + 6 * 86_400_000) },
          },
        })
      : [];
    const ligadas = new Set(ligs.map((l) => l.passagemAncoraId));
    const ativasDosVizinhos = await this.ligacoesAtivas(vizinhos.map((x) => x.passagemAncoraId));
    const pendentes = vizinhos.filter(
      (x) =>
        !ligadas.has(x.passagemAncoraId) &&
        !ativasDosVizinhos.has(x.passagemAncoraId) &&
        (x.cruzamento as Cruzamento).viagemId === v.id,
    );
    const trechosLigados = ligs.length
      ? await this.prisma.trechoTag.findMany({ where: { passagemAncoraId: { in: [...ligadas] } } })
      : [];
    const passagens = await this.passagensPorId([...trechosLigados, ...pendentes].flatMap((x) => x.passagemIds));
    const tipoDe = new Map(ligs.map((l) => [l.passagemAncoraId, l.tipo]));
    const trecho = (x: (typeof vizinhos)[number]) => ({
      passagemAncoraId: x.passagemAncoraId,
      estado: x.estado,
      ini: x.ini,
      fim: x.fim,
      valorTag: Number(x.valorTag),
      valorVale: Number(x.valorVale),
      passagens: x.passagemIds.map((id) => passagens.get(id)).filter(Boolean),
    });

    const decisao = await this.prisma.decisaoPedagioTag.findFirst({
      where: { viagemId: v.id },
      include: { decididoPor: { select: { nome: true } } },
    });
    const valida = decisao && decisaoAindaVale(decisao, lancado, t.cobertura) ? decisao : null;
    return {
      modulo: true as const,
      placa: v.veiculo?.placa ?? null,
      situacao: sit.situacao,
      lancado: lancado.toFixed(2),
      tag: sit.situacao === "TAG_PAGOU" ? sit.tag : "0.00",
      vale: sit.situacao === "TAG_PAGOU" ? sit.vale : "0.00",
      retorno: sit.situacao === "TAG_PAGOU" ? sit.retorno : "0.00",
      sugestao: sit.situacao === "TAG_PAGOU" ? sit.sugestao : null,
      ligados: trechosLigados
        .sort((a, b) => a.ini.getTime() - b.ini.getTime())
        .map((x) => ({ ...trecho(x), ligacao: tipoDe.get(x.passagemAncoraId) ?? null })),
      pendentes: pendentes
        .sort((a, b) => a.ini.getTime() - b.ini.getTime())
        .map((x) => ({ ...trecho(x), status: (x.cruzamento as Cruzamento).status })),
      decisao: valida
        ? {
            valorReembolso: valida.valorReembolso.toFixed(2),
            motivo: valida.motivo,
            decididoPor: valida.decididoPor?.nome ?? null,
            decididoEm: valida.decididoEm,
          }
        : null,
    };
  }

  async casamento(placa: string, dia?: string) {
    const p = normalizarPlaca(placa);
    const trechos = await this.prisma.trechoTag.findMany({ where: { placaTexto: p }, orderBy: { ini: "asc" } });
    if (!trechos.length) return { placa: p, dias: [], dia: null, trechos: [], viagensDoDia: [] };
    const passagens = await this.passagensPorId(trechos.flatMap((t) => t.passagemIds));
    const offsetDe = new Map(
      (await this.prisma.passagemTag.findMany({ where: { id: { in: trechos.map((t) => t.passagemAncoraId) } }, select: { id: true, fusoOffsetMin: true } })).map(
        (x) => [x.id, x.fusoOffsetMin],
      ),
    );
    const diaDe = (t: (typeof trechos)[number]) => new Date(t.ini.getTime() + (offsetDe.get(t.passagemAncoraId) ?? -180) * MIN).toISOString().slice(0, 10);
    const ligs = await this.ligacoesAtivas(trechos.map((t) => t.passagemAncoraId));

    const porDia = new Map<string, { dia: string; trechos: number; pendentes: number }>();
    for (const t of trechos) {
      const d = diaDe(t);
      const s = this.situacao(t, ligs.get(t.passagemAncoraId));
      const x = porDia.get(d) ?? { dia: d, trechos: 0, pendentes: 0 };
      x.trechos++;
      if (!s.decidida && ["SUGESTAO", "LIGARIA_SOZINHA", "SEM_VIAGEM"].includes(s.situacao)) x.pendentes++;
      porDia.set(d, x);
    }
    const dias = [...porDia.values()];
    const escolhido = dia && porDia.has(dia) ? dia : (dias.find((d) => d.pendentes > 0) ?? dias[0]!).dia;
    const doDia = trechos.filter((t) => diaDe(t) === escolhido);

    const idsCands = doDia.flatMap((t) => [
      ...((t.cruzamento as Cruzamento).candidatas ?? []).map((c) => c.viagemId),
      ...((t.cruzamento as Cruzamento).viagemId ? [(t.cruzamento as Cruzamento).viagemId!] : []),
      ...(ligs.get(t.passagemAncoraId)?.viagemId ? [ligs.get(t.passagemAncoraId)!.viagemId!] : []),
    ]);
    // Viagens do caminhão no dia ±1, pra "Outra viagem".
    const veiculoId = doDia.find((t) => t.veiculoId)?.veiculoId ?? null;
    const d0 = new Date(`${escolhido}T00:00:00Z`);
    const doCaminhao = veiculoId
      ? await this.prisma.viagem.findMany({
          where: {
            veiculoId,
            OR: [
              { data: { gte: new Date(d0.getTime() - 86_400_000), lte: new Date(d0.getTime() + 86_400_000) } },
              { iniciadoEm: { gte: new Date(d0.getTime() - 86_400_000), lte: new Date(d0.getTime() + 2 * 86_400_000) } },
            ],
          },
          select: { id: true },
          take: 30,
        })
      : [];
    const rotulos = await this.rotulosDeViagens([...new Set([...idsCands, ...doCaminhao.map((v) => v.id)])]);

    const saida = doDia.map((t) => {
      const c = t.cruzamento as Cruzamento;
      const lig = ligs.get(t.passagemAncoraId);
      const s = this.situacao(t, lig);
      return {
        passagemAncoraId: t.passagemAncoraId,
        estado: t.estado,
        ini: t.ini,
        fim: t.fim,
        valorTag: Number(t.valorTag),
        valorVale: Number(t.valorVale),
        passagens: t.passagemIds.map((id) => passagens.get(id)).filter(Boolean),
        situacao: s.situacao,
        decidida: s.decidida,
        viagem: s.viagemId ? rotulos.get(s.viagemId) ?? { id: s.viagemId, rotulo: "viagem" } : null,
        motivo: lig ? lig.motivo : c.motivo,
        razao: c.candidatas?.[0]?.razao ?? null,
        ligacao: lig ? { tipo: lig.tipo, autorId: lig.autorId, criadoEm: lig.criadoEm } : null,
        candidatas: (c.candidatas ?? []).map((x) => ({ ...x, viagem: rotulos.get(x.viagemId) ?? null })),
      };
    });

    // Praças da rota que a tag não cobrou (viagens ligadas neste dia).
    const ligadasNoDia = new Map<string, string[]>();
    for (const t of saida) {
      if (t.viagem && t.estado === "CARREGADO" && !["NAO_E_VIAGEM"].includes(t.situacao)) {
        const trecho = doDia.find((x) => x.passagemAncoraId === t.passagemAncoraId)!;
        ligadasNoDia.set(t.viagem.id, [...(ligadasNoDia.get(t.viagem.id) ?? []), ...((trecho.cruzamento as Cruzamento).pracas ?? [])]);
      }
    }
    // Só as viagens ligadas neste dia, e as lançadas NESTE dia sem passagem nenhuma
    // ligada (o caso "praça na rota e nenhuma passagem") — nunca as do dia vizinho.
    const comLigacao = new Set(
      (await this.prisma.ligacaoTagViagem.findMany({ where: { viagemId: { in: doCaminhao.map((v) => v.id) }, desfeitaEm: null }, select: { viagemId: true } })).map((l) => l.viagemId),
    );
    const sugeridas = new Set(trechos.map((t) => (t.cruzamento as Cruzamento).viagemId).filter(Boolean));
    const doDiaSemNada = doCaminhao
      .map((v) => rotulos.get(v.id))
      .filter((v): v is NonNullable<typeof v> => !!v && v.data === escolhido && !comLigacao.has(v.id) && !sugeridas.has(v.id))
      .map((v) => v.id);
    const esperadas = await this.motorEsperadas([...new Set([...ligadasNoDia.keys(), ...doDiaSemNada])], ligadasNoDia);

    return {
      placa: p,
      dias,
      dia: escolhido,
      trechos: saida,
      viagensDoDia: doCaminhao.map((v) => rotulos.get(v.id)!).filter(Boolean),
      pracasSemCobranca: esperadas,
    };
  }

  /** Praças na rota da viagem que nenhuma passagem ligada cobriu. */
  private async motorEsperadas(viagemIds: string[], cobertas: Map<string, string[]>) {
    if (!viagemIds.length) return [];
    const emOrdem = await this.motor.pracasDasViagens(viagemIds);
    const out: { viagemId: string; praca: string; chave: string }[] = [];
    for (const id of viagemIds) {
      const lista = emOrdem.get(id);
      if (!lista) continue;
      const passou = new Set(cobertas.get(id) ?? []);
      if (!cobertas.has(id) && lista.length === 0) continue;
      // Só praça que a fatura conhece ("?" = cabine do mapa que o Sem Parar nunca cobrou desta empresa).
      for (const p of lista) if (!p.chave.startsWith("?") && !passou.has(p.chave)) {
          const [rod, km] = p.chave.split("|");
          out.push({ viagemId: id, praca: `${rod} km ${(Number(km) / 1000).toLocaleString("pt-BR")} (${p.nome})`, chave: p.chave });
        }
    }
    return out;
  }

  // ============================================================ decisões

  async decidirLigacao(input: DecidirLigacaoTagInput, user: AuthAdminUser) {
    const t = await this.prisma.trechoTag.findUnique({
      where: { contaId_passagemAncoraId: { contaId: contaIdAtual(), passagemAncoraId: input.passagemAncoraId } },
    });
    if (!t) throw new NotFoundException("Trecho não encontrado. Recalcule a conferência e tente de novo.");
    const c = t.cruzamento as Cruzamento;
    const ativas = await this.prisma.ligacaoTagViagem.findMany({ where: { passagemAncoraId: input.passagemAncoraId, desfeitaEm: null } });
    const desfazer = () =>
      ativas.length
        ? this.prisma.ligacaoTagViagem.updateMany({
            where: { id: { in: ativas.map((a) => a.id) } },
            data: { desfeitaEm: new Date(), desfeitaPorId: user.id, desfeitaMotivo: input.motivo ?? null },
          })
        : null;

    if (input.acao === "DESFAZER") {
      if (!ativas.length) throw new BadRequestException("Não há ligação pra desfazer neste trecho.");
      await desfazer();
      return { ok: true };
    }
    let viagemId: string | null = null;
    let tipo: string;
    let motivo: string;
    if (input.acao === "ACEITAR") {
      viagemId = input.viagemId ?? c.viagemId;
      if (!viagemId) throw new BadRequestException("Este trecho não tem sugestão pra aceitar.");
      tipo = c.status === "RETORNO" || c.status === "IDA_VAZIA" ? "RETORNO" : "SUGESTAO";
      motivo = c.candidatas.find((x) => x.viagemId === viagemId)?.razao ?? c.motivo ?? "sugestão aceita";
    } else if (input.acao === "NAO_E_VIAGEM") {
      tipo = "NAO_E_VIAGEM";
      motivo = input.motivo || "não é viagem";
    } else {
      viagemId = input.viagemId!;
      tipo = input.acao === "RETORNO" ? "RETORNO" : "MANUAL";
      motivo = input.motivo || (tipo === "RETORNO" ? "retorno da viagem" : "ligada à mão");
    }
    if (viagemId) {
      const v = await this.prisma.viagem.findUnique({ where: { id: viagemId }, select: { id: true } });
      if (!v) throw new BadRequestException("Viagem não encontrada.");
    }
    await desfazer();
    await this.prisma.ligacaoTagViagem.create({
      data: { passagemAncoraId: input.passagemAncoraId, viagemId, tipo, motivo: motivo.slice(0, 500), autorId: user.id },
    });
    return { ok: true };
  }

  async aceitarSugestoes(input: AceitarSugestoesTagInput, user: AuthAdminUser) {
    const ts = await this.prisma.trechoTag.findMany({ where: { passagemAncoraId: { in: input.passagemAncoraIds } } });
    const ligs = await this.ligacoesAtivas(ts.map((t) => t.passagemAncoraId));
    let aceitas = 0;
    for (const t of ts) {
      const c = t.cruzamento as Cruzamento;
      if (ligs.has(t.passagemAncoraId) || !c.viagemId || !["SUGESTAO", "RETORNO", "IDA_VAZIA"].includes(c.status)) continue;
      // Em lote, nunca o que precisa de olho: comboio ("confira a placa") e empate.
      if (/^comboio|empate/.test(c.motivo ?? "")) continue;
      await this.prisma.ligacaoTagViagem.create({
        data: {
          passagemAncoraId: t.passagemAncoraId,
          viagemId: c.viagemId,
          tipo: c.status === "SUGESTAO" ? "SUGESTAO" : "RETORNO",
          motivo: (c.candidatas[0]?.razao ?? c.motivo ?? "sugestão aceita").slice(0, 500),
          autorId: user.id,
        },
      });
      aceitas++;
    }
    return { aceitas };
  }

  async responderCarga(input: ResponderCargaTagInput, user: AuthAdminUser) {
    const t = await this.prisma.trechoTag.findFirst({ where: { viagemInferidaAncoraId: input.passagemAncoraId } });
    if (!t) throw new NotFoundException("Viagem da tag não encontrada.");
    if (input.empresaId) {
      const emp = await this.prisma.empresa.findUnique({ where: { id: input.empresaId }, select: { id: true } });
      if (!emp) throw new BadRequestException("Cliente não encontrado.");
    }
    const dados = {
      resposta: input.resposta,
      empresaId: input.resposta === "CLIENTE" ? input.empresaId! : null,
      comprovante: input.resposta === "PAGOU_DE_OUTRO_JEITO" ? input.comprovante ?? null : null,
      observacao: input.observacao ?? null,
      autorId: user.id,
    };
    await this.prisma.respostaCargaTag.upsert({
      where: { contaId_passagemAncoraId: { contaId: contaIdAtual(), passagemAncoraId: input.passagemAncoraId } },
      create: { passagemAncoraId: input.passagemAncoraId, ...dados },
      update: dados,
    });
    return { ok: true };
  }

  async decidirAchado(id: string, input: DecidirAchadoTagInput, user: AuthAdminUser) {
    const a = await this.prisma.achadoTag.findUnique({ where: { id }, select: { id: true } });
    if (!a) throw new NotFoundException("Achado não encontrado.");
    await this.prisma.achadoTag.update({
      where: { id },
      data: {
        status: input.status,
        motivo: input.motivo ?? null,
        decididoPorId: input.status === "ABERTO" ? null : user.id,
        decididoEm: input.status === "ABERTO" ? null : new Date(),
      },
    });
    return { ok: true };
  }

  /** Relatório por contratante: só viagem que GENTE confirmou "de terceiro, sem vale". */
  async relatorioContratantes() {
    const rs = await this.prisma.respostaCargaTag.findMany({
      where: { resposta: "CLIENTE" },
      include: { empresa: { select: { id: true, nome: true, cnpj: true } } },
    });
    const achados = await this.prisma.achadoTag.findMany({
      where: { tipo: "CARREGADO_SEM_VALE", vigente: true, passagemAncoraId: { in: rs.map((r) => r.passagemAncoraId) } },
    });
    const ps = await this.passagensPorId(achados.flatMap((a) => a.passagemIds));
    const grupos = new Map<string, { empresa: { id: string; nome: string; cnpj: string | null }; viagens: unknown[]; total: number }>();
    for (const r of rs) {
      const a = achados.find((x) => x.passagemAncoraId === r.passagemAncoraId);
      if (!a || !r.empresa) continue;
      const g = grupos.get(r.empresa.id) ?? { empresa: r.empresa, viagens: [], total: 0 };
      g.viagens.push({ placa: a.placaTexto, titulo: a.titulo, valor: Number(a.valor ?? 0), passagens: a.passagemIds.map((id) => ps.get(id)).filter(Boolean) });
      g.total = Math.round((g.total + Number(a.valor ?? 0)) * 100) / 100;
      grupos.set(r.empresa.id, g);
    }
    return [...grupos.values()].sort((a, b) => b.total - a.total);
  }

  /** Lista pra contestação no Sem Parar: data, hora, praça, sentido, valor e prazo. */
  async contestacao(extratoId: string) {
    const as = await this.prisma.achadoTag.findMany({
      where: { extratoId, vigente: true, caixa: "PRA_CONTESTAR", status: { not: "DESCARTADO" }, passagemIds: { isEmpty: false } },
      orderBy: { prazoEm: "asc" },
    });
    const ps = await this.passagensPorId(as.flatMap((a) => a.passagemIds));
    return as.flatMap((a) =>
      a.passagemIds
        .map((id) => ps.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p && p.tipo === "PEDAGIO")
        .map((p) => ({ ...p, achado: a.titulo, tipoAchado: a.tipo, status: a.status, prazoEm: a.prazoEm })),
    );
  }

  // ============================================================ praças

  async filaPracas() {
    return this.motor.filaDePracas();
  }

  async confirmarPraca(input: ConfirmarPracaTagInput, user: AuthAdminUser) {
    const pr = await this.prisma.pedagioRodovia.findUnique({ where: { id: input.pedagioRodoviaId }, select: { id: true } });
    if (!pr) throw new BadRequestException("Praça do mapa não encontrada.");
    if (input.global) {
      // Vale pra todas as empresas: só a equipe da plataforma (04-qa M6). Fail-closed.
      if (!user.plataforma) throw new ForbiddenException("Só a equipe da Movatruck confirma a praça pra todas as empresas.");
      await this.prisma.pracaTagDePara.upsert({
        where: { operadora_chavePraca: { operadora: input.operadora, chavePraca: input.chavePraca } },
        create: { operadora: input.operadora, chavePraca: input.chavePraca, pedagioRodoviaId: pr.id, origem: "CONFIRMADA", confirmadoPorId: user.id, confirmadoEm: new Date() },
        update: { pedagioRodoviaId: pr.id, origem: "CONFIRMADA", confirmadoPorId: user.id, confirmadoEm: new Date() },
      });
    } else {
      await this.prisma.pracaTagDeParaConta.upsert({
        where: { contaId_operadora_chavePraca: { contaId: contaIdAtual(), operadora: input.operadora, chavePraca: input.chavePraca } },
        create: { operadora: input.operadora, chavePraca: input.chavePraca, pedagioRodoviaId: pr.id, confirmadoPorId: user.id },
        update: { pedagioRodoviaId: pr.id, confirmadoPorId: user.id, confirmadoEm: new Date() },
      });
    }
    await this.motor.processar();
    return { ok: true };
  }

  // ============================================================ caminhões

  async caminhoes() {
    const placas = await this.prisma.extratoTagVeiculo.findMany({
      distinct: ["placaTexto"],
      select: { placaTexto: true, veiculoId: true },
    });
    const sugestoes = await this.motor.eixosDasPlacas();
    const ids = placas.map((p) => p.veiculoId).filter((x): x is string => !!x);
    const vs = await this.prisma.veiculo.findMany({
      where: { id: { in: ids } },
      select: { id: true, placa: true, eixosCavalo: true, eixosComposicao: true, eixosSuspensosVazio: true, eixosConfirmadoEm: true, tipoProprietario: true },
    });
    return placas.map((p) => {
      const v = vs.find((x) => x.id === p.veiculoId) ?? null;
      const s = sugestoes.get(p.placaTexto);
      return {
        placa: p.placaTexto,
        veiculo: v,
        sugestao: s
          ? {
              eixosComposicao: s.sugestaoComposicao,
              eixosSuspensosVazio: s.sugestaoComposicao && s.modaVazio ? s.sugestaoComposicao - s.modaVazio : null,
              contagem: s.contagem,
            }
          : null,
      };
    });
  }

  async salvarEixos(veiculoId: string, input: EixosVeiculoInput, user: AuthAdminUser) {
    const v = await this.prisma.veiculo.findUnique({ where: { id: veiculoId }, select: { id: true } });
    if (!v) throw new NotFoundException("Caminhão não encontrado.");
    await this.prisma.veiculo.update({
      where: { id: veiculoId },
      data: { ...input, eixosConfirmadoPorId: user.id, eixosConfirmadoEm: new Date() },
    });
    await this.motor.processar();
    return { ok: true };
  }

  async configuracao() {
    const c = await this.prisma.conta.findUnique({ where: { id: contaIdAtual() }, select: { ligacaoAutomaticaTag: true } });
    return { ligacaoAutomaticaTag: !!c?.ligacaoAutomaticaTag };
  }

  async salvarConfiguracao(ligacaoAutomaticaTag: boolean, user: AuthAdminUser) {
    // O 1º mês é em sombra: quem libera a ligação automática é a Movatruck,
    // depois de medir a sugestão contra o que o escritório confirmou.
    if (!user.plataforma) throw new ForbiddenException("A ligação automática é liberada pela equipe da Movatruck depois do 1º mês.");
    await this.prisma.conta.update({ where: { id: contaIdAtual() }, data: { ligacaoAutomaticaTag } });
    await this.motor.processar();
    return { ligacaoAutomaticaTag };
  }

  // ============================================================ retenção

  /**
   * O PDF original fica 13 meses (prazo do vale-pedágio + folga) e some antes
   * se a conta for desativada. Fica só o que foi lido (04-qa I5).
   */
  @Cron("0 20 3 * * *", { name: "tag-pdf-retencao", timeZone: "America/Sao_Paulo" })
  async apagarPdfsVencidos(): Promise<void> {
    await comLockDeCron(this.prisma, "tag-pdf-retencao", async () => {
      await comoSistema(async () => {
        const vencidos = await this.prisma.extratoTag.findMany({
          where: { arquivoKey: { not: null }, OR: [{ arquivoExpiraEm: { lt: new Date() } }, { conta: { ativa: false } }] },
          select: { id: true, arquivoKey: true },
          take: 500,
        });
        for (const e of vencidos) {
          await this.uploads.removerObjeto(e.arquivoKey!);
          await this.prisma.extratoTag.update({ where: { id: e.id }, data: { arquivoKey: null } });
        }
        if (vencidos.length) this.log.log(`PDF da tag: ${vencidos.length} original(is) apagado(s) pela retenção.`);
      });
    });
  }
}

function formatarCnpj(c: string | null) {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c ?? "?";
}
