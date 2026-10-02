import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import {
  LIMITE_ANEXO_PEDIDO,
  type AnexoPedidoAdmin,
  type AnexoPedidoMotorista,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { checarArquivoEnviado } from "../../common/arquivo-enviado";
import { assinarLink, lerLinkAssinado } from "../../common/link-assinado";
import { comConta } from "../../common/conta/conta-context";
import { inicioDiasAtras } from "../../common/timezone";

/** Tipo do link assinado. Diferente do do acerto: um token nunca abre o outro. */
const TIPO_LINK = "anexo-pedido";
/**
 * Curto de propósito: o link só existe pra entregar o PDF ao leitor do
 * sistema NO MOMENTO em que ele toca. Não é pra guardar nem repassar — quem
 * quer o arquivo depois abre de novo pelo app, que confere o acesso de novo.
 */
const VALIDADE_LINK_MS = 10 * 60_000;

/**
 * Status em que a programação já é do motorista. Rascunho (`PLANEJADA`) é do
 * escritório e não vaza; recusada, furada e cancelada não levam ninguém à obra.
 */
export const STATUS_COM_ACESSO = ["PUBLICADA", "ACEITA", "EM_EXECUCAO", "CUMPRIDA"] as const;

/** A janela da programação no app: de ontem em diante (no calendário de SP). */
export function inicioJanelaProgramacao(): Date {
  // Ontem entra porque quem abre o app às 5h ainda está terminando o dia
  // anterior — e a lista e o acesso ao arquivo TÊM que usar a mesma janela:
  // documento listado que dá 404 ao tocar é pior que documento nenhum.
  return inicioDiasAtras(1);
}

type ArquivoRecebido = { buffer: Buffer; mimetype: string; size: number; originalname: string };

/**
 * Nome do arquivo como veio do navegador. O Multer entrega o `originalname`
 * em latin1 — "croqui-acesso-ó.pdf" chegava como "croqui-acesso-Ã³.pdf".
 */
function nomeLegivel(original: string): string {
  let nome = original;
  try {
    const convertido = Buffer.from(original, "latin1").toString("utf8");
    if (!convertido.includes("�")) nome = convertido;
  } catch {
    /* fica como veio */
  }
  // Barra e caractere de controle não entram: o nome volta no
  // Content-Disposition e no nome do arquivo salvo no celular.
  nome = nome.replace(/[\\/\x00-\x1f]+/g, "-").trim();
  return (nome || "documento").slice(0, 160);
}

function paraAdmin(a: {
  id: string;
  pedidoId: string;
  nome: string;
  mime: string;
  tamanho: number;
  visivelMotorista: boolean;
  criadoEm: Date;
  enviadoPor: { id: string; nome: string } | null;
}): AnexoPedidoAdmin {
  return { ...a, criadoEm: a.criadoEm.toISOString() };
}

export function paraMotorista(a: {
  id: string;
  pedidoId: string;
  nome: string;
  mime: string;
  tamanho: number;
  criadoEm: Date;
}): AnexoPedidoMotorista {
  return {
    id: a.id,
    pedidoId: a.pedidoId,
    nome: a.nome,
    mime: a.mime,
    tamanho: a.tamanho,
    criadoEm: a.criadoEm.toISOString(),
  };
}

/**
 * Os papéis do pedido: croqui de acesso, OS do cliente, autorização de entrada.
 *
 * Mora aqui a regra de QUEM pode baixar cada arquivo, nos dois lados — o
 * painel (por permissão) e o motorista (só se tem programação desse pedido).
 */
@Injectable()
export class AnexosPedidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
  ) {}

  // ───────────────────────────────────────────────────────────── painel

  async listar(pedidoId: string): Promise<AnexoPedidoAdmin[]> {
    await this.exigirPedido(pedidoId);
    const linhas = await this.prisma.anexoPedido.findMany({
      where: { pedidoId },
      orderBy: { criadoEm: "asc" },
      select: {
        id: true,
        pedidoId: true,
        nome: true,
        mime: true,
        tamanho: true,
        visivelMotorista: true,
        criadoEm: true,
        enviadoPor: { select: { id: true, nome: true } },
      },
    });
    return linhas.map(paraAdmin);
  }

  async anexar(pedidoId: string, arquivo: ArquivoRecebido | undefined, userId: string) {
    checarArquivoEnviado(arquivo, {
      mimes: LIMITE_ANEXO_PEDIDO.mimes,
      maxBytes: LIMITE_ANEXO_PEDIDO.bytes,
      comoDizer: "Mande um PDF ou uma foto (JPG ou PNG).",
    });
    await this.exigirPedido(pedidoId);
    const ja = await this.prisma.anexoPedido.count({ where: { pedidoId } });
    if (ja >= LIMITE_ANEXO_PEDIDO.porPedido) {
      throw new BadRequestException(
        `Este pedido já tem ${LIMITE_ANEXO_PEDIDO.porPedido} anexos. Exclua algum antes de mandar outro.`,
      );
    }
    // `image/jpg` não existe no padrão mas algumas galerias mandam: guarda o
    // nome certo, que é o que volta como Content-Type.
    const mime = arquivo.mimetype === "image/jpg" ? "image/jpeg" : arquivo.mimetype;
    const storageKey = await this.uploads.putPedidoAnexo(arquivo.buffer, mime, pedidoId);
    const criado = await this.prisma.anexoPedido.create({
      data: {
        pedidoId,
        nome: nomeLegivel(arquivo.originalname),
        mime,
        tamanho: arquivo.size,
        storageKey,
        enviadoPorId: userId,
      },
      select: {
        id: true,
        pedidoId: true,
        nome: true,
        mime: true,
        tamanho: true,
        visivelMotorista: true,
        criadoEm: true,
        enviadoPor: { select: { id: true, nome: true } },
      },
    });
    return paraAdmin(criado);
  }

  async alterarVisibilidade(pedidoId: string, anexoId: string, visivelMotorista: boolean) {
    const a = await this.prisma.anexoPedido.findFirst({
      where: { id: anexoId, pedidoId },
      select: { id: true },
    });
    if (!a) throw new NotFoundException("Anexo não encontrado.");
    await this.prisma.anexoPedido.update({ where: { id: anexoId }, data: { visivelMotorista } });
    return { ok: true, visivelMotorista };
  }

  async excluir(pedidoId: string, anexoId: string) {
    const a = await this.prisma.anexoPedido.findFirst({
      where: { id: anexoId, pedidoId },
      select: { id: true, storageKey: true },
    });
    if (!a) throw new NotFoundException("Anexo não encontrado.");
    await this.prisma.anexoPedido.delete({ where: { id: a.id } });
    // Depois do banco: se o storage falhar, o registro já saiu e ninguém mais
    // chega no arquivo. `removerObjeto` nunca lança, só avisa no log.
    await this.uploads.removerObjeto(a.storageKey);
    return { ok: true };
  }

  async doPainel(pedidoId: string, anexoId: string) {
    const a = await this.prisma.anexoPedido.findFirst({
      where: { id: anexoId, pedidoId },
      select: { nome: true, mime: true, storageKey: true },
    });
    if (!a) throw new NotFoundException("Anexo não encontrado.");
    return a;
  }

  // ─────────────────────────────────────────────────────────── motorista

  /**
   * O anexo, se ESTE motorista pode vê-lo. Senão, 404 — e sempre o mesmo 404:
   * "existe mas não é seu" e "não existe" têm que ser indistinguíveis, senão
   * o endpoint vira um jeito de descobrir pedido dos outros.
   *
   * Pode quando: o anexo está marcado visível E ele tem programação desse
   * pedido já publicada pra ele, de ontem em diante — ou ligada à viagem que
   * ele está rodando agora. A conta vem da trava do Prisma: anexo de outra
   * empresa nem aparece na busca.
   */
  async doMotorista(motoristaId: string, pedidoId: string, anexoId: string) {
    await this.exigirAprovado(motoristaId);
    const [anexo, programada] = await Promise.all([
      this.prisma.anexoPedido.findFirst({
        where: { id: anexoId, pedidoId, visivelMotorista: true },
        select: {
          id: true,
          pedidoId: true,
          nome: true,
          mime: true,
          tamanho: true,
          criadoEm: true,
          storageKey: true,
        },
      }),
      this.prisma.viagemPlanejada.findFirst({
        where: {
          pedidoId,
          motoristaId,
          status: { in: [...STATUS_COM_ACESSO] },
          OR: [
            { dataPrevista: { gte: inicioJanelaProgramacao() } },
            { viagem: { status: "EM_ANDAMENTO" } },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (!anexo || !programada) throw new NotFoundException("Documento não encontrado.");
    return anexo;
  }

  /**
   * Link curto pro leitor de PDF do sistema. Assinado com a CONTA dentro: a
   * rota pública não tem sessão, e é o token que diz de quem é o arquivo.
   */
  linkAssinado(anexoId: string, contaId: string): string {
    const token = assinarLink(
      { tipo: TIPO_LINK, id: anexoId, contaId, expiraEm: new Date(Date.now() + VALIDADE_LINK_MS) },
      this.segredo(),
    );
    return `/publico/anexos-pedido/${token}`;
  }

  /** O arquivo pelo link assinado. Anexo que ficou oculto no meio do caminho não sai. */
  async peloLink(token: string) {
    const lido = lerLinkAssinado(token, TIPO_LINK, this.segredo());
    if (!lido) throw new NotFoundException("Link vencido. Abra o documento de novo pelo app.");
    const a = await comConta(lido.contaId, () =>
      this.prisma.anexoPedido.findFirst({
        where: { id: lido.id, visivelMotorista: true },
        select: { nome: true, mime: true, storageKey: true },
      }),
    );
    if (!a) throw new NotFoundException("Documento não encontrado.");
    return a;
  }

  // ─────────────────────────────────────────────────────────────── comum

  /** Manda o arquivo pro cliente, com o nome que a pessoa reconhece. */
  async servir(a: { nome: string; mime: string; storageKey: string }, res: Response) {
    const stream = await this.uploads.getObjectStream(a.storageKey);
    res.setHeader("Content-Type", a.mime);
    // `inline`: o leitor do sistema abre na hora em vez de só baixar. O nome
    // vai nas duas formas porque navegador antigo não lê `filename*`.
    const ascii = a.nome.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${ascii || "documento"}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
    );
    // Privado: nenhum proxy no meio do 4G guarda papel de obra de cliente.
    res.setHeader("Cache-Control", "private, max-age=86400");
    stream.pipe(res);
  }

  private async exigirPedido(pedidoId: string) {
    const p = await this.prisma.pedido.findFirst({ where: { id: pedidoId }, select: { id: true } });
    if (!p) throw new NotFoundException("Pedido não encontrado.");
  }

  /** Sem `@AcessoMotorista` o guard não confere aprovação — confere aqui. */
  private async exigirAprovado(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { status: true },
    });
    if (m?.status !== "APROVADO") {
      throw new ForbiddenException("Seu cadastro ainda está em análise.");
    }
  }

  private segredo(): string {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }
}
