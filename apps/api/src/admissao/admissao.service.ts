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
import { detectarAssinaturaEmbutida, hashDoArquivo } from "./assinatura-arquivo";

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
 * O arquivo assinado do gov.br/assinador: `.p7s` (destacado) e `.p7m`.
 *
 * Passa pela lista de mimes porque o navegador manda esses como
 * `application/octet-stream` na metade das vezes — a extensão é o único
 * sinal na hora do upload. Deixar entrar NÃO é confiar nela: logo abaixo, o
 * arquivo só é aceito se o conteúdo carregar mesmo o OID de PKCS#7, então um
 * JPEG renomeado pra `.p7s` continua sendo recusado.
 */
function ehExtensaoAssinada(nome: string): boolean {
  const n = nome.toLowerCase();
  return n.endsWith(".p7s") || n.endsWith(".p7m");
}

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
    exigeAssinatura?: boolean;
    exigeIcpBrasil?: boolean;
  }) {
    this.assertTipo(dados.tipo);
    return this.prisma.documentoExigido.create({
      data: {
        titulo: dados.titulo,
        tipo: dados.tipo,
        empresaId: dados.empresaId ?? null,
        obrigatorio: dados.obrigatorio ?? true,
        ordem: dados.ordem ?? 0,
        exigeAssinatura: dados.exigeAssinatura ?? false,
        // ICP sem assinatura não quer dizer nada: o contratante que exige
        // certificado está exigindo uma assinatura, por definição.
        exigeIcpBrasil: (dados.exigeAssinatura ?? false) && (dados.exigeIcpBrasil ?? false),
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
   * ⚠️ ISTO JÁ FOI MAIS FECHADO E ESTAVA ERRADO. A primeira versão devolvia só
   * o que FALTAVA, escondendo o que já tinha chegado, com o argumento de que
   * quem abre o link pode não ser o titular. Na prática: a pessoa mandava sete
   * arquivos sem saber qual entrou, não tinha como trocar uma foto tremida, e
   * o link virava um buraco. O argumento também não se sustentava — a página
   * já mostra o NOME do motorista, então esconder "CNH recebida" protegia
   * quase nada e custava o uso inteiro.
   *
   * O que continua valendo: NUNCA devolve o arquivo, nem o nome dele, nem a
   * chave de storage, nem miniatura. Só o TIPO pedido e se chegou ou não —
   * que é exatamente o que quem está enviando precisa saber.
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

      const assinaturas = await this.prisma.assinaturaDocumento.findMany({
        where: { motoristaId: c.motoristaId },
        select: { tipoDocumento: true, modo: true, assinadoEm: true },
      });
      const assinado = new Map(assinaturas.map((a) => [a.tipoDocumento, a]));

      const documentos = exigidos.map((e) => ({
        tipo: e.tipo,
        titulo: e.titulo,
        obrigatorio: e.obrigatorio,
        recebido: jaTem.has(e.tipo),
        exigeAssinatura: e.exigeAssinatura,
        exigeIcpBrasil: e.exigeIcpBrasil,
        assinado: assinado.has(e.tipo),
        /** Só a data. Nome, CPF e hash são evidência, não coisa de tela pública. */
        assinadoEm: assinado.get(e.tipo)?.assinadoEm ?? null,
      }));

      // "Pronto" agora é receber E assinar o que precisa de assinatura. Sem
      // isso a página diria "recebemos todos" com um contrato por assinar.
      const pendente = (d: (typeof documentos)[number]) =>
        !d.recebido || (d.exigeAssinatura && !d.assinado);

      return {
        motorista: c.motorista.nome,
        expiraEm: c.expiraEm,
        documentos,
        recebidos: documentos.filter((d) => !pendente(d)).length,
        total: documentos.length,
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
    if (!MIMES_PERMITIDOS.has(arquivo.mimetype) && !ehExtensaoAssinada(arquivo.originalname)) {
      throw new BadRequestException("Mande uma foto, um PDF ou o arquivo assinado (.p7s).");
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

      // Reenviar o mesmo tipo SUBSTITUI. É o "refazer a foto": a primeira saiu
      // tremida, a segunda vale. O upsert abaixo já fazia isso no banco; o que
      // faltava era a página oferecer o caminho.
      const storageKey = await this.uploads.putMotoristaDocumento(
        arquivo.buffer,
        arquivo.mimetype,
        c.motoristaId,
        tipo,
        arquivo.originalname,
      );

      const exigencia = exigidos.find((e) => e.tipo === tipo)!;

      // Contratante que exige ICP não pode receber um escaneado em PDF: a
      // pessoa salva, acha que assinou, e a transportadora só descobre na
      // auditoria. Recusar aqui é o único momento em que dá pra explicar.
      const deteccao = detectarAssinaturaEmbutida(
        arquivo.buffer,
        arquivo.mimetype,
        arquivo.originalname,
      );
      // `.p7s` que não carrega PKCS#7 é lixo (ou um arquivo renomeado pra
      // furar a exigência). Recusa antes de guardar.
      if (ehExtensaoAssinada(arquivo.originalname) && !deteccao.temAssinaturaEmbutida) {
        throw new BadRequestException(
          "Esse arquivo .p7s não tem assinatura digital dentro. Gere de novo no assinador.",
        );
      }
      if (exigencia.exigeIcpBrasil && !deteccao.temAssinaturaEmbutida) {
        throw new BadRequestException(
          "Este documento precisa vir assinado com certificado digital (ICP-Brasil). " +
            "Assine em gov.br/assinatura-eletronica ou no seu assinador e mande o arquivo assinado (.p7s ou PDF assinado).",
        );
      }

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

      // Reenviar o arquivo DERRUBA a assinatura antiga. Ela apontava, pelo
      // hash, pro papel anterior — mantê-la faria a tela dizer que a pessoa
      // assinou um documento que ela nunca viu.
      await this.prisma.assinaturaDocumento.deleteMany({
        where: { motoristaId: c.motoristaId, tipoDocumento: tipo },
      });

      // Arquivo que já chega assinado dispensa o aceite: a assinatura é o
      // próprio arquivo, e pedir pra digitar o nome depois seria teatro.
      if (deteccao.temAssinaturaEmbutida && exigencia.exigeAssinatura) {
        await this.prisma.assinaturaDocumento.create({
          data: {
            motoristaId: c.motoristaId,
            tipoDocumento: tipo,
            modo: "ICP_BRASIL",
            hashArquivo: hashDoArquivo(arquivo.buffer),
            conviteColetaId: c.id,
          },
        });
      }

      await this.prisma.conviteColeta.update({
        where: { id: c.id },
        data: { enviosFeitos: { increment: 1 } },
      });

      this.log.log(`Documento ${tipo} recebido pelo link de coleta.`);
      return { recebido: true, tipo, assinaturaEmbutida: deteccao.temAssinaturaEmbutida };
    });
  }

  /**
   * O aceite eletrônico de um documento já enviado.
   *
   * Assinatura eletrônica SIMPLES, que a MP 2.200-2 (art. 10, §2º) admite
   * quando as partes aceitam — e o que dá valor a ela é a trilha, não o
   * clique: quem declarou ser, o CPF, o IP, a hora e o HASH do arquivo
   * naquele momento.
   *
   * O hash é a peça que não pode faltar. Sem ele, "fulano assinou a ordem de
   * serviço" é frase solta: trocar o arquivo depois deixaria a assinatura
   * apontando pro papel novo. Com ele, reenviar derruba a assinatura e a tela
   * diz isso em vez de mentir.
   *
   * ⚠️ O CPF tem que ser o DO MOTORISTA. É o que impede o dono do caminhão
   * assinar no lugar dele — que é exatamente o que aconteceria, por
   * conveniência, se a página aceitasse qualquer nome.
   */
  async assinarDocumento(
    token: string,
    dados: { tipo: string; nome: string; cpf: string },
    ip?: string,
    userAgent?: string,
  ) {
    const c = await this.resolverToken(token);
    this.assertTipo(dados.tipo);

    return comConta(c.contaId, async () => {
      const exigidos = await this.exigidosPara(c.motoristaId);
      const exigencia = exigidos.find((e) => e.tipo === dados.tipo);
      if (!exigencia) throw new BadRequestException("Este documento não é pedido aqui.");
      if (!exigencia.exigeAssinatura) {
        throw new BadRequestException("Este documento não precisa de assinatura.");
      }
      if (exigencia.exigeIcpBrasil) {
        throw new BadRequestException(
          "Este documento exige certificado digital: mande o arquivo já assinado, não há o que aceitar aqui.",
        );
      }

      const doc = await this.prisma.motoristaDocumento.findFirst({
        where: { motoristaId: c.motoristaId, tipo: dados.tipo as never },
        select: { storageKey: true },
      });
      if (!doc) throw new BadRequestException("Mande o arquivo antes de assinar.");

      const motorista = await this.prisma.motorista.findFirst({
        where: { id: c.motoristaId },
        select: { cpf: true },
      });
      const so = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
      if (motorista?.cpf && so(motorista.cpf) !== so(dados.cpf)) {
        throw new BadRequestException(
          "O CPF não confere com o do motorista. Quem assina tem que ser ele.",
        );
      }

      // O hash sai do arquivo que está GUARDADO, não de um que veio junto: é o
      // papel que a pessoa está assinando agora.
      const buffer = await this.uploads.getObjectBuffer(doc.storageKey);

      const assinatura = await this.prisma.assinaturaDocumento.upsert({
        where: {
          motoristaId_tipoDocumento: { motoristaId: c.motoristaId, tipoDocumento: dados.tipo },
        },
        create: {
          motoristaId: c.motoristaId,
          tipoDocumento: dados.tipo,
          modo: "SIMPLES",
          nomeDeclarado: dados.nome,
          cpfDeclarado: so(dados.cpf),
          ip: ip ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
          hashArquivo: hashDoArquivo(buffer),
          conviteColetaId: c.id,
        },
        update: {
          modo: "SIMPLES",
          nomeDeclarado: dados.nome,
          cpfDeclarado: so(dados.cpf),
          ip: ip ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
          hashArquivo: hashDoArquivo(buffer),
          conviteColetaId: c.id,
          assinadoEm: new Date(),
        },
      });

      this.log.log(`Documento ${dados.tipo} assinado pelo link de coleta.`);
      return { assinado: true, tipo: dados.tipo, assinadoEm: assinatura.assinadoEm };
    });
  }
}
