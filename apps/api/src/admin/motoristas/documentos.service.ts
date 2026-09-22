import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { TipoDocumentoMotorista, MotoristaDocumento } from "@prisma/client";
import { AdmissaoService } from "../../admissao/admissao.service";
import { chaveDaGaveta } from "../../common/chave-documento";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";

/**
 * Os documentos do motorista pelo lado do ESCRITÓRIO.
 *
 * ⚠️ A gravação NÃO mora aqui. Ela mora em `AdmissaoService.receberDocumento`,
 * e este service só decide QUAL documento está sendo tocado. Enquanto as duas
 * portas tinham cada uma a sua regra, o painel trocava o arquivo de um
 * documento assinado e deixava a `AssinaturaDocumento` de pé, apontando pelo
 * hash pra um arquivo que ele mesmo tinha acabado de apagar do MinIO — o
 * sistema afirmando que o motorista assinou um papel que não existe mais.
 */
@Injectable()
export class MotoristasDocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly admissao: AdmissaoService,
  ) {}

  async list(motoristaId: string) {
    await this.garantirMotorista(motoristaId);
    return this.prisma.motoristaDocumento.findMany({
      where: { motoristaId },
      // O título da exigência vem junto porque, com duas exigências na mesma
      // gaveta, o rótulo da gaveta deixa de distinguir as linhas na tela.
      include: { exigencia: { select: { id: true, titulo: true, exigeAssinatura: true } } },
      orderBy: [{ tipo: "asc" }, { criadoEm: "asc" }],
    });
  }

  /**
   * Acha o documento pelo que veio na URL.
   *
   * As rotas do painel são `/documentos/:tipo` desde sempre e continuam
   * funcionando assim — mas `tipo` deixou de ser identidade quando duas
   * exigências passaram a poder dividir a mesma gaveta. Então: uma chave
   * (`exig:<id>` / `gaveta:<TIPO>`) é usada direto; uma gaveta procura o anexo
   * avulso e, se não houver, o único documento daquela gaveta. Mais de um,
   * recusa e diz os nomes — escolher um por sorteio é como o defeito antigo
   * apagava arquivo em silêncio.
   */
  private async resolverDocumento(motoristaId: string, chaveOuTipo: string) {
    if (chaveOuTipo.startsWith("exig:") || chaveOuTipo.startsWith("gaveta:")) {
      const doc = await this.prisma.motoristaDocumento.findFirst({
        where: { motoristaId, chave: chaveOuTipo },
      });
      if (!doc) throw new NotFoundException("Documento não encontrado");
      return doc;
    }

    const avulso = await this.prisma.motoristaDocumento.findFirst({
      where: { motoristaId, chave: chaveDaGaveta(chaveOuTipo) },
    });
    if (avulso) return avulso;

    const daGaveta = await this.prisma.motoristaDocumento.findMany({
      where: { motoristaId, tipo: chaveOuTipo as TipoDocumentoMotorista },
      include: { exigencia: { select: { titulo: true } } },
    });
    if (daGaveta.length === 0) throw new NotFoundException("Documento não encontrado");
    if (daGaveta.length > 1) {
      throw new BadRequestException(
        `Mais de um documento usa essa gaveta (${daGaveta
          .map((d) => d.exigencia?.titulo ?? d.nomeArquivo)
          .join(", ")}). Abra pelo documento, não pela gaveta.`,
      );
    }
    return daGaveta[0];
  }

  async findOne(motoristaId: string, chaveOuTipo: string) {
    await this.garantirMotorista(motoristaId);
    return this.resolverDocumento(motoristaId, chaveOuTipo);
  }

  /**
   * Upload pelo painel.
   *
   * Passa pela regra comum, então derruba a assinatura do documento trocado
   * exatamente como o link público sempre fez.
   */
  async upload(
    motoristaId: string,
    tipo: TipoDocumentoMotorista,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    validade: string | null | undefined,
    exigenciaId?: string | null,
  ): Promise<MotoristaDocumento> {
    await this.garantirMotorista(motoristaId);

    // Quando o escritório sobe pra uma exigência, é ela que manda — inclusive
    // na gaveta, que é detalhe de armazenamento dela.
    let exigencia = exigenciaId
      ? await this.prisma.documentoExigido.findFirst({ where: { id: exigenciaId } })
      : null;
    if (exigenciaId && !exigencia) throw new NotFoundException("Exigência não encontrada");

    /**
     * ⚠️ UM DOCUMENTO, UMA LINHA.
     *
     * Anexar pela gaveta quando existe UMA exigência ativa nela cai nessa
     * exigência, em vez de criar um anexo solto ao lado. Sem isto, a mesma CNH
     * passava a existir duas vezes na ficha — uma "anexo do escritório" e
     * outra atendendo a exigência —, e o motorista continuava sendo cobrado de
     * um documento que já estava ali do lado.
     *
     * Com DUAS exigências na mesma gaveta (RG e CTPS em `REGISTRO_MOTORISTA`)
     * não há como adivinhar qual é, e aí o anexo continua avulso: escolher uma
     * por sorteio é como o arquivo sumia antes.
     */
    if (!exigencia) {
      const daGaveta = await this.prisma.documentoExigido.findMany({
        where: { tipo, ativo: true },
        take: 2,
      });
      if (daGaveta.length === 1) exigencia = daGaveta[0]!;
    }

    const { doc } = await this.admissao.receberDocumento({
      motoristaId,
      exigencia,
      tipo: exigencia?.tipo ?? tipo,
      arquivo: file,
      origem: "PAINEL",
      validade: parseValidade(validade),
    });
    return doc;
  }

  async atualizarValidade(
    motoristaId: string,
    chaveOuTipo: string,
    validade: string | null,
  ): Promise<MotoristaDocumento> {
    const doc = await this.findOne(motoristaId, chaveOuTipo);
    return this.prisma.motoristaDocumento.update({
      where: { id: doc.id },
      data: { validade: parseValidade(validade) },
    });
  }

  async remove(motoristaId: string, chaveOuTipo: string): Promise<void> {
    const doc = await this.findOne(motoristaId, chaveOuTipo);
    await this.uploads.removerObjeto(doc.storageKey);
    // A assinatura vai junto: sem o arquivo ela não prova nada, e deixá-la
    // órfã é a mesma mentira que o reenvio produzia.
    await this.prisma.assinaturaDocumento.deleteMany({
      where: { motoristaId, chave: doc.chave },
    });
    await this.prisma.motoristaDocumento.delete({ where: { id: doc.id } });
  }

  private async garantirMotorista(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
  }
}

function parseValidade(input: string | null | undefined): Date | null {
  if (input == null || input === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException("Validade inválida (use YYYY-MM-DD)");
  }
  const d = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException("Validade inválida");
  }
  return d;
}
