import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  OrigemAceite,
  PublicarTermoInput,
  ReciboAceite,
  StatusAceite,
  TermoPublico,
  TipoTermo,
} from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";

/** Os documentos que toda conta precisa ter aceitos pra operar. */
const EXIGIDOS: TipoTermo[] = ["USO", "PRIVACIDADE"];

export function hashDoCorpo(corpo: string): string {
  return createHash("sha256").update(corpo, "utf8").digest("hex");
}

/**
 * Aceite de termos: publicar versão, saber quem deve aceitar, e gravar a prova.
 *
 * `comoSistema` em quase tudo porque `TermoVersao` é model GLOBAL — não tem
 * `contaId` pra trava filtrar. Toda consulta cita o alvo no `where`, que é a
 * regra da casa pra model global.
 */
@Injectable()
export class TermosService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────── leitura

  /**
   * A versão que vale hoje, por tipo.
   *
   * `vigenteDesde <= agora` e não simplesmente "a última": publicar com
   * vigência futura é o caminho certo quando a mudança é significativa — a
   * cláusula 12 dos próprios Termos promete 30 dias de aviso, e ignorar a
   * vigência faria o sistema quebrar a promessa que o texto faz.
   */
  async vigente(tipo: TipoTermo) {
    return comoSistema(() =>
      this.prisma.termoVersao.findFirst({
        where: { tipo, publicadoEm: { not: null }, vigenteDesde: { lte: new Date() } },
        orderBy: { vigenteDesde: "desc" },
      }),
    );
  }

  /** Tudo que já foi publicado, pra tela pública de leitura. */
  async listarPublicados(tipo?: TipoTermo): Promise<TermoPublico[]> {
    const linhas = await comoSistema(() =>
      this.prisma.termoVersao.findMany({
        where: { publicadoEm: { not: null }, ...(tipo ? { tipo } : {}) },
        orderBy: [{ tipo: "asc" }, { vigenteDesde: "desc" }],
      }),
    );
    return linhas.map((t) => ({
      id: t.id,
      tipo: t.tipo,
      versao: t.versao,
      corpo: t.corpo,
      sha256: t.sha256,
      vigenteDesde: t.vigenteDesde.toISOString(),
      publicadoEm: t.publicadoEm?.toISOString() ?? null,
      oQueMudou: t.oQueMudou,
    }));
  }

  // ─────────────────────────────────────────────────────── status

  /**
   * O que esta conta ainda precisa aceitar.
   *
   * Devolver lista vazia é o caso normal e o mais importante: é ele que impede
   * o modal de aparecer pra quem já está em dia. Bloqueio que aparece sem
   * necessidade treina o usuário a clicar sem ler — e clique sem leitura é
   * exatamente o que esvazia a prova.
   */
  async status(contaId: string): Promise<StatusAceite> {
    const pendentes: StatusAceite["pendentes"] = [];

    for (const tipo of EXIGIDOS) {
      const vigente = await this.vigente(tipo);
      if (!vigente) continue; // nada publicado ainda: não há o que exigir

      const jaAceitou = await comoSistema(() =>
        this.prisma.aceiteTermo.findFirst({
          where: { contaId, termoVersaoId: vigente.id },
          select: { id: true },
        }),
      );
      if (jaAceitou) continue;

      // Já aceitou ALGUMA versão deste tipo? Muda o texto do modal: primeira
      // vez é "leia e aceite"; reaceite é "mudou isto aqui".
      const aceiteAnterior = await comoSistema(() =>
        this.prisma.aceiteTermo.findFirst({
          where: { contaId, termoVersao: { tipo } },
          select: { id: true },
        }),
      );

      pendentes.push({
        termoVersaoId: vigente.id,
        tipo: vigente.tipo,
        versao: vigente.versao,
        oQueMudou: vigente.oQueMudou,
        primeiroAceite: !aceiteAnterior,
      });
    }

    return { pendentes };
  }

  // ─────────────────────────────────────────────────────── gravar a prova

  /**
   * Grava o aceite.
   *
   * Tudo que vira prova — nome, e-mail, documento, IP, user agent — chega por
   * PARÂMETRO, vindo do token e da conexão. Nada disso sai do corpo da
   * requisição: prova que a parte interessada preenche não é prova.
   */
  async aceitar(dados: {
    contaId: string;
    termoVersaoId: string;
    sha256: string;
    userId?: string | null;
    nome: string;
    email: string;
    documento?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    origem: OrigemAceite;
  }) {
    const versao = await comoSistema(() =>
      this.prisma.termoVersao.findUnique({ where: { id: dados.termoVersaoId } }),
    );
    if (!versao) throw new NotFoundException("Essa versão dos termos não existe.");
    if (!versao.publicadoEm) {
      throw new BadRequestException("Essa versão ainda não foi publicada.");
    }

    // O HASH TEM QUE BATER.
    //
    // Sem esta checagem, uma aba aberta há três dias aceita a versão antiga
    // depois de você publicar uma nova — e o registro diria que a pessoa
    // concordou com um texto que ela nunca viu. Recusar e mandar recarregar é
    // ruim de UX e é a única coisa honesta a fazer.
    if (versao.sha256 !== dados.sha256) {
      throw new ConflictException(
        "O texto mudou enquanto você lia. Recarregue a página e leia a versão atual antes de aceitar.",
      );
    }

    // Idempotente: clicar duas vezes (ou dois cliques na mesma conta) não gera
    // duas provas. A primeira é a que vale.
    const existente = await comoSistema(() =>
      this.prisma.aceiteTermo.findFirst({
        where: { contaId: dados.contaId, termoVersaoId: versao.id },
      }),
    );
    if (existente) return existente;

    return comoSistema(() =>
      this.prisma.aceiteTermo.create({
        data: {
          contaId: dados.contaId,
          termoVersaoId: versao.id,
          userId: dados.userId ?? null,
          nomeQuemAceitou: dados.nome,
          emailQuemAceitou: dados.email,
          documento: dados.documento ?? null,
          ip: dados.ip ?? null,
          userAgent: dados.userAgent?.slice(0, 500) ?? null,
          origem: dados.origem,
        },
      }),
    );
  }

  /** O histórico de aceites da conta — o recibo que o cliente pode baixar. */
  async recibos(contaId: string): Promise<ReciboAceite[]> {
    const linhas = await comoSistema(() =>
      this.prisma.aceiteTermo.findMany({
        where: { contaId },
        orderBy: { aceitoEm: "desc" },
        include: { termoVersao: { select: { tipo: true, versao: true, sha256: true } } },
      }),
    );
    return linhas.map((a) => ({
      tipo: a.termoVersao.tipo,
      versao: a.termoVersao.versao,
      sha256: a.termoVersao.sha256,
      aceitoEm: a.aceitoEm.toISOString(),
      nomeQuemAceitou: a.nomeQuemAceitou,
      emailQuemAceitou: a.emailQuemAceitou,
      documento: a.documento,
      origem: a.origem as OrigemAceite,
    }));
  }

  // ─────────────────────────────────────────────────────── publicar

  /** Publica uma versão nova. Só a plataforma chama isto. */
  async publicar(input: PublicarTermoInput) {
    const sha256 = hashDoCorpo(input.corpo);

    const jaExiste = await comoSistema(() =>
      this.prisma.termoVersao.findUnique({
        where: { tipo_versao: { tipo: input.tipo, versao: input.versao } },
      }),
    );
    if (jaExiste) {
      throw new ConflictException(
        `A versão ${input.versao} de ${input.tipo} já existe. ` +
          `Texto publicado não se corrige: publique ${proximaVersao(input.versao)}.`,
      );
    }

    return comoSistema(() =>
      this.prisma.termoVersao.create({
        data: {
          tipo: input.tipo,
          versao: input.versao,
          corpo: input.corpo,
          sha256,
          vigenteDesde: new Date(`${input.vigenteDesde}T00:00:00-03:00`),
          publicadoEm: new Date(),
          oQueMudou: input.oQueMudou ?? null,
        },
      }),
    );
  }
}

function proximaVersao(versao: string): string {
  const [maior, menor] = versao.split(".").map(Number);
  return `${maior}.${(menor ?? 0) + 1}`;
}
