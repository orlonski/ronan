import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import archiver from "archiver";
import type { Response } from "express";
import {
  AtualizarValidadeDocumentoInput,
  RecusarDocumentoInput,
  TIPOS_DOCUMENTO_MOTORISTA,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AVISO_ICP } from "../../admissao/assinatura-arquivo";
import { AdmissaoService } from "../../admissao/admissao.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { MotoristasDocumentosService } from "./documentos.service";

const MIMES_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 25 * 1024 * 1024;

function assertTipo(tipo: string): TipoDocumentoMotorista {
  if (!(TIPOS_DOCUMENTO_MOTORISTA as readonly string[]).includes(tipo)) {
    throw new BadRequestException(`Tipo de documento inválido: ${tipo}`);
  }
  return tipo as TipoDocumentoMotorista;
}

/**
 * O que a URL está apontando.
 *
 * As rotas são `/documentos/:tipo` desde sempre, e continuam aceitando a
 * gaveta. Mas gaveta deixou de ser identidade quando duas exigências passaram
 * a poder cair na mesma, então a chave (`exig:<id>`) também vale aqui — é como
 * a tela aponta pro documento certo.
 */
function assertAlvo(raw: string): string {
  if (raw.startsWith("exig:") || raw.startsWith("gaveta:")) return raw;
  return assertTipo(raw);
}

function publicShape(doc: {
  id: string;
  tipo: TipoDocumentoMotorista;
  chave: string;
  exigenciaId: string | null;
  origem: string;
  nomeArquivo: string;
  mimetype: string;
  tamanho: number;
  validade: Date | null;
  criadoEm: Date;
  alteradoEm: Date;
  conferidoEm?: Date | null;
  recusadoEm?: Date | null;
  recusaMotivo?: string | null;
  exigencia?: { id: string; titulo: string; exigeAssinatura: boolean } | null;
}) {
  // storageKey nunca sai da API — só o controller precisa dele pra servir o arquivo.
  return {
    id: doc.id,
    tipo: doc.tipo,
    /** Como apontar pra ESTE documento nas outras rotas. */
    chave: doc.chave,
    exigenciaId: doc.exigenciaId,
    /** O nome que o contratante deu, quando o arquivo atende uma exigência. */
    titulo: doc.exigencia?.titulo ?? null,
    origem: doc.origem,
    nomeArquivo: doc.nomeArquivo,
    mimetype: doc.mimetype,
    tamanho: doc.tamanho,
    validade: doc.validade ? doc.validade.toISOString().slice(0, 10) : null,
    criadoEm: doc.criadoEm.toISOString(),
    alteradoEm: doc.alteradoEm.toISOString(),
    /** Ninguém olhou ainda = os dois nulos. É o estado normal de quem chegou. */
    conferidoEm: doc.conferidoEm?.toISOString() ?? null,
    recusadoEm: doc.recusadoEm?.toISOString() ?? null,
    recusaMotivo: doc.recusaMotivo ?? null,
  };
}

@ApiTags("admin/motoristas/documentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/motoristas/:motoristaId/documentos")
export class MotoristasDocumentosController {
  constructor(
    private readonly service: MotoristasDocumentosService,
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly admissao: AdmissaoService,
  ) {}

  @RequerPermissao("motoristas.documentos")
  @Get()
  async list(@Param("motoristaId") motoristaId: string) {
    const docs = await this.service.list(motoristaId);

    // A assinatura vem junto porque é aqui que o escritório audita. E vem com
    // `confere`: o hash foi tirado do arquivo NAQUELE momento, então um
    // reenvio posterior faz a assinatura deixar de bater — e a tela tem que
    // dizer isso em vez de mostrar um "assinado" que não vale mais.
    const assinaturas = await this.prisma.assinaturaDocumento.findMany({
      where: { motoristaId },
      select: {
        chave: true,
        modo: true,
        nomeDeclarado: true,
        cpfDeclarado: true,
        ip: true,
        hashArquivo: true,
        assinadoEm: true,
      },
    });
    const porChave = new Map(assinaturas.map((a) => [a.chave, a]));

    return docs.map((d) => {
      const a = porChave.get(d.chave);
      return {
        ...publicShape(d),
        assinatura: a
          ? {
              modo: a.modo,
              nome: a.nomeDeclarado,
              cpf: a.cpfDeclarado,
              ip: a.ip,
              hash: a.hashArquivo,
              assinadoEm: a.assinadoEm.toISOString(),
              /**
               * A assinatura ainda bate com o arquivo guardado?
               *
               * Este campo era PROMETIDO neste comentário e não existia — o
               * comentário dizia que a tela avisaria quando o hash deixasse de
               * bater, e não havia nada pra avisar. `null` = não dá pra dizer
               * (documento anterior a 21/09/2026, quando o hash passou a ser
               * gravado no upload), e nulo nunca deve ser lido como "confere".
               */
              confere:
                d.hashArquivo == null ? null : d.hashArquivo === a.hashArquivo,
              /** ICP não é validado aqui — ver `AVISO_ICP`. */
              aviso: a.modo === "ICP_BRASIL" ? AVISO_ICP : null,
            }
          : null,
      };
    });
  }

  @RequerPermissao("motoristas.documentos")
  @Get("zip")
  async downloadZip(@Param("motoristaId") motoristaId: string, @Res() res: Response) {
    const motorista = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, nome: true },
    });
    if (!motorista) throw new NotFoundException("Motorista não encontrado");

    const docs = await this.prisma.motoristaDocumento.findMany({
      where: { motoristaId },
      include: { exigencia: { select: { titulo: true } } },
      orderBy: [{ tipo: "asc" }, { criadoEm: "asc" }],
    });
    if (docs.length === 0) {
      throw new BadRequestException("Nenhum documento anexado pra esse motorista");
    }

    const nomeArquivo = `documentos-${slug(motorista.nome)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
      // Encerra a response com erro — o cliente vai ver um download corrompido,
      // mas é melhor do que travar a conexão.
      res.status(500).end(err.message);
    });
    archive.pipe(res);

    for (const doc of docs) {
      try {
        const stream = await this.uploads.getObjectStream(doc.storageKey);
        // O título do contratante entra no nome porque a gaveta deixou de
        // identificar o papel: dois arquivos em `REGISTRO_MOTORISTA` sairiam
        // com o mesmo prefixo, e quem abre o zip é quem vai conferir a lista.
        const rotulo = doc.exigencia?.titulo ? slug(doc.exigencia.titulo) : doc.tipo;
        const nomeNoZip = `${rotulo}-${doc.nomeArquivo}`;
        archive.append(stream, { name: nomeNoZip });
      } catch {
        // Arquivo faltando no MinIO — pula em vez de matar o zip todo.
      }
    }

    await archive.finalize();
  }

  @RequerPermissao("motoristas.documentos")
  @Get(":tipo/download")
  async download(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @Res() res: Response,
  ) {
    const doc = await this.service.findOne(motoristaId, assertAlvo(tipoRaw));
    const stream = await this.uploads.getObjectStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimetype);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doc.nomeArquivo.replace(/"/g, "")}"`,
    );
    stream.pipe(res);
  }

  @RequerPermissao("motoristas.documentos")
  @Post(":tipo")
  @UseInterceptors(FileInterceptor("arquivo"))
  async upload(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("validade") validade: string | undefined,
    // Quando o escritório sobe o contrato que ELE emitiu (OS, ficha de EPI,
    // contrato de experiência), o arquivo atende uma exigência do catálogo —
    // e é isso que faz o documento aparecer como "falta assinar" pro motorista
    // em vez de virar anexo solto numa gaveta.
    @Body("exigenciaId") exigenciaId: string | undefined,
  ) {
    const tipo = assertTipo(tipoRaw);
    if (!file) throw new BadRequestException("Arquivo não enviado");
    if (!MIMES_PERMITIDOS.has(file.mimetype)) {
      throw new BadRequestException(
        `Tipo não permitido: ${file.mimetype}. Use PDF, JPG, PNG ou WebP.`,
      );
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Arquivo maior que 25MB");
    }
    const doc = await this.service.upload(
      motoristaId,
      tipo,
      file,
      validade ?? null,
      exigenciaId ?? null,
    );
    return publicShape(doc);
  }

  @RequerPermissao("motoristas.documentos")
  @Patch(":tipo/validade")
  async patchValidade(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @Body(new ZodValidationPipe(AtualizarValidadeDocumentoInput))
    body: AtualizarValidadeDocumentoInput,
  ) {
    const doc = await this.service.atualizarValidade(
      motoristaId,
      assertAlvo(tipoRaw),
      body.validade,
    );
    return publicShape(doc);
  }

  /**
   * "Eu olhei e está certo."
   *
   * ⚠️ Não é burocracia: o sistema não vê o que está dentro da foto. Sem este
   * ato, "chegou" virava "conferido" por omissão — a ficha mostrava visto
   * verde, a contagem do app zerava, e o motorista ia pra obra achando que
   * estava resolvido. Fica escrito quem conferiu.
   */
  @RequerPermissao("motoristas.documentos")
  @Post(":tipo/conferir")
  async conferir(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    const doc = await this.admissao.conferirDocumento(motoristaId, assertAlvo(tipoRaw), user.id);
    return { ok: true, conferidoEm: doc.conferidoEm };
  }

  /** "Não serve, e por isto." O motivo aparece no app dele. */
  @RequerPermissao("motoristas.documentos")
  @Post(":tipo/recusar")
  async recusar(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @Body(new ZodValidationPipe(RecusarDocumentoInput)) body: RecusarDocumentoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    const doc = await this.admissao.recusarDocumento(
      motoristaId,
      assertAlvo(tipoRaw),
      body.motivo,
      user.id,
    );
    return { ok: true, recusadoEm: doc.recusadoEm };
  }

  @RequerPermissao("motoristas.documentos")
  @Delete(":tipo")
  async remove(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
  ) {
    await this.service.remove(motoristaId, assertAlvo(tipoRaw));
    return { ok: true };
  }
}

function slug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "motorista";
}
