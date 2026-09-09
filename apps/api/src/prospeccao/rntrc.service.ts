import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import {
  dataBr,
  pontuar,
  qualificar,
  type LinhaRntrc,
  type MotivoDescarte,
} from "./regras-rntrc";

/**
 * Importa o cadastro de transportadores da ANTT (RNTRC).
 *
 * O arquivo tem ~159 MB, 1,15 milhão de linhas, vem em ISO-8859-1 com CRLF e é
 * publicado mensalmente sob licença CC-BY. Nada disso cabe na memória de um
 * container, então tudo aqui é streaming: baixa, decodifica e descarta linha a
 * linha, gravando em lotes.
 *
 * Fonte: https://dados.antt.gov.br/dataset/rntrc
 */

const CKAN_PACOTE = "https://dados.antt.gov.br/api/3/action/package_show?id=rntrc";

/** Quantos leads por INSERT. 500 mantém o statement longe do limite de parâmetros. */
const TAMANHO_LOTE = 500;

export type ResultadoImportacao = {
  arquivo: string;
  linhasLidas: number;
  qualificados: number;
  inseridos: number;
  descartes: Record<MotivoDescarte, number>;
  duracaoMs: number;
};

type RecursoCkan = { url?: string; format?: string; name?: string; created?: string };

@Injectable()
export class RntrcService {
  private readonly log = new Logger("RNTRC");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Descobre a URL do CSV mais recente pelo catálogo CKAN da ANTT.
   *
   * A competência vem do NOME DO ARQUIVO na URL
   * (`transportadores_rntrc_07_2026.csv`) — o campo `name` do recurso é
   * "Jul26 - RNTRC", mês abreviado em português, que é frágil de parsear e já
   * mudou de forma no passado. Ordenar por `created` não serve: recursos de uma
   * mesma carga saem com datas iguais e a escolha viraria sorteio.
   */
  async urlDoCsvMaisRecente(): Promise<{ url: string; nome: string }> {
    const resposta = await fetch(CKAN_PACOTE, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "Movatruck/1.0 (+https://www.movatruck.com.br)" },
    });

    if (!resposta.ok) {
      throw new Error(`Catálogo da ANTT respondeu ${resposta.status}`);
    }

    const corpo = (await resposta.json()) as {
      result?: { resources?: RecursoCkan[] };
    };

    const candidatos = (corpo.result?.resources ?? [])
      .filter((r) => (r.format ?? "").toUpperCase() === "CSV")
      .map((r) => {
        const url = r.url ?? "";
        return {
          url,
          nome: url.split("/").pop() || r.name || "",
          ordem: competenciaDoRecurso(url, r.name ?? ""),
        };
      })
      .filter((r) => r.url && r.ordem > 0)
      .sort((a, b) => b.ordem - a.ordem);

    const escolhido = candidatos[0];
    if (!escolhido) {
      throw new Error("Nenhum CSV datado encontrado no catálogo do RNTRC");
    }

    return { url: escolhido.url, nome: escolhido.nome };
  }

  /**
   * Baixa e importa. Não atualiza quem já está na base — a chave única é o
   * CNPJ e a carga mensal só acrescenta.
   *
   * Não atualizar é decisão, não preguiça: `status`, `score` e `observacao` são
   * escritos por quem trabalha o lead, e uma reimportação que sobrescrevesse
   * apagaria o trabalho de campo todo mês.
   */
  async importar(opcoes: { ufs?: string[]; urlDireta?: string } = {}): Promise<ResultadoImportacao> {
    const inicio = Date.now();
    const ufs = opcoes.ufs ?? this.ufsPadrao();

    const { url, nome } = opcoes.urlDireta
      ? { url: opcoes.urlDireta, nome: opcoes.urlDireta.split("/").pop() ?? "manual" }
      : await this.urlDoCsvMaisRecente();

    this.log.log(`Importando ${nome} (UFs: ${ufs.length ? ufs.join(",") : "todas"})`);

    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(15 * 60_000),
      headers: { "User-Agent": "Movatruck/1.0 (+https://www.movatruck.com.br)" },
    });

    if (!resposta.ok || !resposta.body) {
      throw new Error(`Download do RNTRC falhou: HTTP ${resposta.status}`);
    }

    const descartes: Record<MotivoDescarte, number> = {
      SITUACAO_INATIVA: 0,
      UF_FORA_DO_ALVO: 0,
      CATEGORIA_NAO_EMPRESA: 0,
      EMPRESARIO_INDIVIDUAL: 0,
    };

    let linhasLidas = 0;
    let qualificados = 0;
    let inseridos = 0;
    let lote: LeadNovo[] = [];

    const coletadoEm = new Date();
    const origemDado = `RNTRC/ANTT — ${nome} (dado aberto, CC-BY)`;

    // O arquivo é ISO-8859-1: decodificar como UTF-8 transforma "RIBEIRÃO" em
    // lixo e o nome da cidade fica ilegível na tela do painel.
    // A decodificação acontece AINDA no mundo web (pipeThrough), e só depois o
    // stream vira Node pra alimentar o readline. Fazer `Readable.fromWeb(...)`
    // antes e tentar `.pipe(TextDecoderStream)` não funciona: são dois tipos de
    // stream diferentes, e o erro só aparece em runtime.
    const texto = (resposta.body as ReadableStream<Uint8Array>).pipeThrough(
      new TextDecoderStream("iso-8859-1"),
    );

    const linhas = createInterface({
      input: Readable.fromWeb(texto as never),
      crlfDelay: Infinity,
    });

    for await (const bruta of linhas) {
      if (linhasLidas++ === 0) continue; // cabeçalho

      const linha = parsearLinha(bruta);
      if (!linha) continue;

      const veredito = qualificar(linha, { ufs, agora: coletadoEm });
      if (!veredito.entra) {
        descartes[veredito.motivo]++;
        continue;
      }

      qualificados++;
      lote.push({
        empresa: linha.nomeTransportador,
        cnpj: linha.cpfCnpj,
        rntrc: linha.numeroRntrc,
        municipio: linha.municipio,
        uf: linha.uf,
        cep: linha.cep || null,
        categoria: linha.categoria,
        registradoEm: dataBr(linha.dataPrimeiroCadastro),
        score: veredito.score,
        scoreMotivo: veredito.scoreMotivo,
        origem: "PROSPECCAO_ATIVA",
        origemDado,
        coletadoEm,
      });

      if (lote.length >= TAMANHO_LOTE) {
        inseridos += await this.gravarLote(lote);
        lote = [];
      }
    }

    if (lote.length > 0) inseridos += await this.gravarLote(lote);

    const resultado: ResultadoImportacao = {
      arquivo: nome,
      linhasLidas: linhasLidas - 1,
      qualificados,
      inseridos,
      descartes,
      duracaoMs: Date.now() - inicio,
    };

    this.log.log(
      `RNTRC importado: ${resultado.linhasLidas} linhas, ${qualificados} qualificados, ` +
        `${inseridos} novos em ${Math.round(resultado.duracaoMs / 1000)}s`,
    );

    return resultado;
  }

  /**
   * Repontua a base já importada.
   *
   * A régua comercial muda toda semana; baixar 159 MB de novo só pra mudar um
   * número seria absurdo. Mexe SÓ em `score` e `scoreMotivo` — `status`,
   * `observacao` e o histórico de interação são trabalho de gente e não se
   * tocam aqui.
   */
  async recalcularScores(): Promise<{ avaliados: number; alterados: number }> {
    const agora = new Date();
    let avaliados = 0;
    let alterados = 0;
    let cursor: string | undefined;

    for (;;) {
      const pagina = await comoSistema(async () =>
        this.prisma.lead.findMany({
          where: { origem: "PROSPECCAO_ATIVA" },
          select: { id: true, empresa: true, registradoEm: true, score: true },
          orderBy: { id: "asc" },
          take: 1000,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        }),
      );

      if (pagina.length === 0) break;
      cursor = pagina[pagina.length - 1]?.id;

      for (const lead of pagina) {
        avaliados++;
        const { score, motivo } = pontuar(lead.empresa, lead.registradoEm, agora);
        if (score === lead.score) continue;
        alterados++;
        await comoSistema(async () =>
          this.prisma.lead.update({
            where: { id: lead.id },
            data: { score, scoreMotivo: motivo },
          }),
        );
      }
    }

    this.log.log(`Scores recalculados: ${alterados} de ${avaliados} mudaram`);
    return { avaliados, alterados };
  }

  /**
   * `skipDuplicates` faz a reimportação ser barata e segura: quem já está na
   * base pelo CNPJ passa batido, com o trabalho de campo intacto.
   */
  private async gravarLote(lote: LeadNovo[]): Promise<number> {
    const { count } = await comoSistema(async () =>
      this.prisma.lead.createMany({ data: lote, skipDuplicates: true }),
    );
    return count;
  }

  /** Recorte geográfico. Vazio = Brasil inteiro. */
  private ufsPadrao(): string[] {
    const bruto = this.config.get<string>("PROSPECCAO_UFS") ?? "PR";
    return bruto
      .split(",")
      .map((u) => u.trim().toUpperCase())
      .filter(Boolean);
  }
}

type LeadNovo = {
  empresa: string;
  cnpj: string;
  rntrc: string;
  municipio: string;
  uf: string;
  cep: string | null;
  categoria: string;
  registradoEm: Date | null;
  score: number;
  scoreMotivo: string;
  origem: string;
  origemDado: string;
  coletadoEm: Date;
};

/**
 * Cada campo vem entre aspas, separado por ponto e vírgula. Um split cru por
 * `;` quebraria em razão social com ponto e vírgula dentro — raro, mas existe
 * em 1,1 milhão de linhas.
 */
export function parsearLinha(bruta: string): LinhaRntrc | null {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < bruta.length; i++) {
    const c = bruta[i];
    if (c === '"') {
      if (dentroDeAspas && bruta[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
    } else if (c === ";" && !dentroDeAspas) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);

  if (campos.length < 9) return null;

  const limpo = campos.map((c) => c.trim());
  if (!limpo[4]) return null; // sem CNPJ não há como deduplicar

  return {
    nomeTransportador: limpo[0],
    numeroRntrc: limpo[1],
    dataPrimeiroCadastro: limpo[2],
    situacaoRntrc: limpo[3],
    cpfCnpj: limpo[4],
    categoria: limpo[5],
    cep: limpo[6],
    municipio: limpo[7],
    uf: limpo[8],
  };
}

/** Mês abreviado como a ANTT escreve no título do recurso ("Jul26 - RNTRC"). */
const MESES_ABREV: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/**
 * Competência do arquivo como número ordenável (aaaamm).
 *
 * Tenta primeiro a URL, que traz `_MM_AAAA.csv` e é o formato estável. Só cai
 * no título ("Jul26 - RNTRC") se a URL não disser nada — assim uma mudança em
 * qualquer um dos dois lados não deixa a importação escolher o arquivo errado
 * em silêncio.
 *
 * Devolve 0 quando não dá pra saber, e quem chama descarta.
 */
export function competenciaDoRecurso(url: string, titulo: string): number {
  const naUrl = url.match(/_(\d{2})_(\d{4})\.csv/i);
  if (naUrl) return Number(naUrl[2]) * 100 + Number(naUrl[1]);

  const noTitulo = titulo.trim().match(/^([A-Za-zç]{3})(\d{2})/);
  if (noTitulo) {
    const mes = MESES_ABREV[noTitulo[1].toLowerCase()];
    if (mes) return (2000 + Number(noTitulo[2])) * 100 + mes;
  }

  return 0;
}
