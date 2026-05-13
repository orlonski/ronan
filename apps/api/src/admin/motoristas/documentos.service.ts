import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { TipoDocumentoMotorista, MotoristaDocumento } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";

@Injectable()
export class MotoristasDocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(motoristaId: string): Promise<MotoristaDocumento[]> {
    await this.garantirMotorista(motoristaId);
    return this.prisma.motoristaDocumento.findMany({
      where: { motoristaId },
      orderBy: { tipo: "asc" },
    });
  }

  async findOne(motoristaId: string, tipo: TipoDocumentoMotorista) {
    const doc = await this.prisma.motoristaDocumento.findUnique({
      where: { motoristaId_tipo: { motoristaId, tipo } },
    });
    if (!doc) throw new NotFoundException("Documento não encontrado");
    return doc;
  }

  async upload(
    motoristaId: string,
    tipo: TipoDocumentoMotorista,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    validade: string | null | undefined,
  ): Promise<MotoristaDocumento> {
    await this.garantirMotorista(motoristaId);

    const existente = await this.prisma.motoristaDocumento.findUnique({
      where: { motoristaId_tipo: { motoristaId, tipo } },
    });
    // Apaga o objeto anterior antes de subir o novo. Se a extensão mudar,
    // a key também muda — sem remover, ficava lixo no MinIO.
    if (existente) {
      await this.uploads.removeObject(existente.storageKey);
    }

    const storageKey = await this.uploads.putMotoristaDocumento(
      file.buffer,
      file.mimetype,
      motoristaId,
      tipo,
      file.originalname,
    );

    const validadeDate = parseValidade(validade);

    return this.prisma.motoristaDocumento.upsert({
      where: { motoristaId_tipo: { motoristaId, tipo } },
      create: {
        motoristaId,
        tipo,
        nomeArquivo: file.originalname,
        storageKey,
        mimetype: file.mimetype,
        tamanho: file.size,
        validade: validadeDate,
      },
      update: {
        nomeArquivo: file.originalname,
        storageKey,
        mimetype: file.mimetype,
        tamanho: file.size,
        validade: validadeDate,
      },
    });
  }

  async atualizarValidade(
    motoristaId: string,
    tipo: TipoDocumentoMotorista,
    validade: string | null,
  ): Promise<MotoristaDocumento> {
    await this.findOne(motoristaId, tipo);
    return this.prisma.motoristaDocumento.update({
      where: { motoristaId_tipo: { motoristaId, tipo } },
      data: { validade: parseValidade(validade) },
    });
  }

  async remove(motoristaId: string, tipo: TipoDocumentoMotorista): Promise<void> {
    const doc = await this.findOne(motoristaId, tipo);
    await this.uploads.removeObject(doc.storageKey);
    await this.prisma.motoristaDocumento.delete({
      where: { motoristaId_tipo: { motoristaId, tipo } },
    });
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
