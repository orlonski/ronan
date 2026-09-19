import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { TIPOS_DOCUMENTO_MOTORISTA, type TipoDocumentoMotorista } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";

/** Mesmo teto e mesma lista do upload pelo painel: um caminho só de verdade. */
const MIMES_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Teto de arquivos por link.
 *
 * Não é desconfiança de quem recebe o link: é que endpoint público de escrita
 * sem teto vira hospedagem grátis pra quem descobrir a URL. Generoso o
 * bastante pra ninguém legítimo esbarrar.
 */
const MAX_ENVIOS_POR_CONVITE = 40;

/** Quanto tempo o link vale. Curto o bastante pra um link vazado envelhecer. */
const DIAS_DE_VALIDADE = 14;

/**
 * A admissão: os papéis que o contratante exige antes do caminhão entrar na
 * obra, e o link por onde eles chegam.
 *
 * ⚠️ O sistema não nomeia documento. O título é o que a operação escreveu,
 * copiando o que o contratante pede — ver o comentário do model
 * `DocumentoExigido`. Nós transportamos o arquivo.
 */
@Injectable()
export class AdmissaoService {
  private readonly log = new Logger(AdmissaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  // --------------------------------------------------- o que se exige ---

  /**
   * O que é exigido deste motorista.
   *
   * Junta a exigência da transportadora (empresa nula) com a do contratante da
   * obra em que ele está. Sem alocação, valem só as gerais — é o caso de quem
   * está sendo admitido antes de ter obra.
   */
  async exigidosPara(motoristaId: string) {
    const alocacao = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId, ativa: true },
      include: { cliente: { select: { empresaId: true } } },
    });
    const empresaId = alocacao?.cliente.empresaId;

    return this.prisma.documentoExigido.findMany({
      where: {
        ativo: true,
        OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])],
      },
      orderBy: [{ ordem: "asc" }, { titulo: "asc" }],
    });
  }

  listarExigidos(empresaId?: string) {
    return this.prisma.documentoExigido.findMany({
      where: empresaId ? { OR: [{ empresaId: null }, { empresaId }] } : {},
      orderBy: [{ ordem: "asc" }, { titulo: "asc" }],
    });
  }

  criarExigido(dados: {
    titulo: string;
    tipo: string;
    empresaId?: string;
    obrigatorio?: boolean;
    ordem?: number;
  }) {
    this.assertTipo(dados.tipo);
    return this.prisma.documentoExigido.create({
      data: {
        titulo: dados.titulo,
        tipo: dados.tipo,
        empresaId: dados.empresaId ?? null,
        obrigatorio: dados.obrigatorio ?? true,
        ordem: dados.ordem ?? 0,
      },
    });
  }

  async removerExigido(id: string) {
    const e = await this.prisma.documentoExigido.findFirst({ where: { id } });
    if (!e) throw new NotFoundException("Exigência não encontrada.");
    // Desativa em vez de apagar: coleta antiga referencia o que era exigido na
    // época, e sumir com a linha faria um pacote entregue parecer incompleto.
    return this.prisma.documentoExigido.update({ where: { id }, data: { ativo: false } });
  }

  private assertTipo(tipo: string): TipoDocumentoMotorista {
    if (!(TIPOS_DOCUMENTO_MOTORISTA as readonly string[]).includes(tipo)) {
      throw new BadRequestException(`Gaveta de documento inválida: ${tipo}`);
    }
    return tipo as TipoDocumentoMotorista;
  }

  // ------------------------------------------------------------ link ---

  /**
   * Gera o link de coleta. Serve ao dono do caminhão E ao motorista.
   *
   * 192 bits de aleatoriedade, como o comprovante de viagem: o link É a
   * credencial, então adivinhar tem que ser impossível.
   */
  async criarConvite(motoristaId: string, usuarioId: string) {
    const m = await this.prisma.motorista.findFirst({
      where: { id: motoristaId },
      select: { id: true, nome: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado.");

    const expiraEm = new Date(Date.now() + DIAS_DE_VALIDADE * 86_400_000);
    const convite = await this.prisma.conviteColeta.create({
      data: {
        motoristaId,
        token: randomBytes(24).toString("base64url"),
        criadoPorId: usuarioId,
        expiraEm,
      },
    });
    this.log.log(`Convite de coleta criado para ${m.nome}.`);
    return convite;
  }

  listarConvites(motoristaId: string) {
    return this.prisma.conviteColeta.findMany({
      where: { motoristaId },
      orderBy: { criadoEm: "desc" },
    });
  }

  /** Soft-revoke: a linha fica, pra o histórico de quem expôs o quê sobreviver. */
  async revogarConvite(id: string) {
    const c = await this.prisma.conviteColeta.findFirst({ where: { id } });
    if (!c) throw new NotFoundException("Convite não encontrado.");
    if (c.revogadoEm) return c;
    return this.prisma.conviteColeta.update({
      where: { id },
      data: { revogadoEm: new Date() },
    });
  }

  // -------------------------------------------------------- o público ---

  /**
   * Resolve o token. Roda `comoSistema` porque rota pública não tem conta no
   * contexto — é o token que diz de qual conta é.
   *
   * 404 genérico pra token inválido, expirado e revogado: distinguir os três
   * contaria a quem tem um link velho que ele já existiu.
   */
  private async resolverToken(token: string) {
    const c = await comoSistema(() =>
      this.prisma.conviteColeta.findFirst({
        where: { token },
        include: { motorista: { select: { id: true, nome: true } } },
      }),
    );
    if (!c || c.revogadoEm || c.expiraEm.getTime() < Date.now()) {
      throw new NotFoundException("Este link não está mais disponível.");
    }
    return c;
  }

  /**
   * O que a página pública mostra.
   *
   * NUNCA lista o que já foi enviado, nem devolve arquivo: só o que falta e
   * quantos já chegaram. Quem abre o link pode não ser o titular dos
   * documentos — o dono do caminhão é um caso previsto —, e link que exibe
   * documento de gente é como documento de gente vaza.
   */
  async paginaPublica(token: string, ip?: string) {
    const c = await this.resolverToken(token);

    await comoSistema(() =>
      this.prisma.conviteColeta.update({
        where: { id: c.id },
        data: {
          visualizacoes: { increment: 1 },
          primeiroAcessoEm: c.primeiroAcessoEm ?? new Date(),
          ultimoAcessoEm: new Date(),
          ultimoAcessoIp: ip ?? null,
        },
      }),
    );

    return comConta(c.contaId, async () => {
      const exigidos = await this.exigidosPara(c.motoristaId);
      const enviados = await this.prisma.motoristaDocumento.findMany({
        where: { motoristaId: c.motoristaId },
        select: { tipo: true },
      });
      const jaTem = new Set<string>(enviados.map((e) => e.tipo));

      return {
        motorista: c.motorista.nome,
        expiraEm: c.expiraEm,
        // Só os que faltam. O que já chegou vira contagem, não lista.
        faltando: exigidos
          .filter((e) => !jaTem.has(e.tipo))
          .map((e) => ({ tipo: e.tipo, titulo: e.titulo, obrigatorio: e.obrigatorio })),
        jaRecebidos: exigidos.filter((e) => jaTem.has(e.tipo)).length,
        total: exigidos.length,
      };
    });
  }

  /**
   * Recebe um arquivo pelo link público.
   *
   * O `comConta` embrulha a escrita inteira e o `await` mora DENTRO dele: a
   * promise do Prisma é preguiçosa, e devolvê-la pra fora do `run` faria a
   * consulta executar sem conta no contexto — a trava lançaria, ou pior,
   * gravaria no lugar errado.
   */
  async receberArquivo(
    token: string,
    tipo: string,
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    const c = await this.resolverToken(token);

    if (c.enviosFeitos >= MAX_ENVIOS_POR_CONVITE) {
      throw new ForbiddenException("Este link já recebeu arquivos demais. Peça um novo.");
    }
    if (!MIMES_PERMITIDOS.has(arquivo.mimetype)) {
      throw new BadRequestException("Mande uma foto ou um PDF.");
    }
    if (arquivo.size > MAX_BYTES) {
      throw new BadRequestException("O arquivo é grande demais. O limite é 25 MB.");
    }
    this.assertTipo(tipo);

    return comConta(c.contaId, async () => {
      // Só aceita o que ESTE motorista precisa mandar. Sem isto, um link
      // válido viraria upload livre de qualquer gaveta.
      const exigidos = await this.exigidosPara(c.motoristaId);
      if (!exigidos.some((e) => e.tipo === tipo)) {
        throw new BadRequestException("Este documento não é pedido aqui.");
      }

      const storageKey = await this.uploads.putMotoristaDocumento(
        arquivo.buffer,
        arquivo.mimetype,
        c.motoristaId,
        tipo,
        arquivo.originalname,
      );

      await this.prisma.motoristaDocumento.upsert({
        where: { motoristaId_tipo: { motoristaId: c.motoristaId, tipo: tipo as never } },
        create: {
          motoristaId: c.motoristaId,
          tipo: tipo as never,
          storageKey,
          nomeArquivo: arquivo.originalname,
          mimetype: arquivo.mimetype,
          tamanho: arquivo.size,
        },
        update: {
          storageKey,
          nomeArquivo: arquivo.originalname,
          mimetype: arquivo.mimetype,
          tamanho: arquivo.size,
        },
      });

      await this.prisma.conviteColeta.update({
        where: { id: c.id },
        data: { enviosFeitos: { increment: 1 } },
      });

      this.log.log(`Documento ${tipo} recebido pelo link de coleta.`);
      return { recebido: true, tipo };
    });
  }
}
