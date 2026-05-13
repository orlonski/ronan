import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as MinioClient } from "minio";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly log = new Logger(UploadsService.name);
  private client!: MinioClient;
  private bucket!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.client = new MinioClient({
      endPoint: this.config.getOrThrow("MINIO_ENDPOINT"),
      port: Number(this.config.get("MINIO_PORT") ?? 9000),
      useSSL: this.config.get("MINIO_USE_SSL") === "true",
      accessKey: this.config.getOrThrow("MINIO_ACCESS_KEY"),
      secretKey: this.config.getOrThrow("MINIO_SECRET_KEY"),
    });
    this.bucket = this.config.getOrThrow("MINIO_BUCKET");
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.log.log(`Bucket ${this.bucket} criado`);
      }
    } catch (err) {
      this.log.warn(`Não consegui validar bucket: ${(err as Error).message}`);
    }
  }

  async putTicketFoto(buffer: Buffer, mimetype: string, motoristaId: string): Promise<string> {
    const ext = mimetype.includes("png") ? "png" : "jpg";
    const key = `tickets/${new Date().toISOString().slice(0, 10)}/${motoristaId}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  async putAbastecimentoFoto(
    buffer: Buffer,
    mimetype: string,
    motoristaId: string,
  ): Promise<string> {
    const ext = mimetype.includes("png") ? "png" : "jpg";
    const key = `abastecimentos/${new Date().toISOString().slice(0, 10)}/${motoristaId}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  async putFechamentoOriginal(
    buffer: Buffer,
    nomeArquivo: string,
    mimetype: string,
  ): Promise<string> {
    const ext = nomeArquivo.split(".").pop()?.toLowerCase() ?? "bin";
    const key = `fechamentos/originais/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  async putFechamentoExportado(
    buffer: Buffer,
    nomeArquivo: string,
    fechamentoId: string,
  ): Promise<string> {
    const key = `fechamentos/exportados/${fechamentoId}/${Date.now()}-${nomeArquivo}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return key;
  }

  async putMotoristaDocumento(
    buffer: Buffer,
    mimetype: string,
    motoristaId: string,
    tipo: string,
    nomeOriginal: string,
  ): Promise<string> {
    const ext = (nomeOriginal.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `documentos/${motoristaId}/${tipo}.${ext || "bin"}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  async getObjectStream(key: string): Promise<Readable> {
    try {
      return (await this.client.getObject(this.bucket, key)) as Readable;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("does not exist") || msg.includes("NoSuchKey")) {
        throw new NotFoundException("Arquivo não disponível no storage");
      }
      throw err;
    }
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      return await new Promise((resolve, reject) => {
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    } catch (err) {
      // Foto perdida no storage (volume não persistente, key inválida, etc).
      // Sobe 404 — controllers propagam, dashboard mostra placeholder. Evita
      // poluir o ErrorLog com 5xx pra um caso conhecido (foto faltando).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("does not exist") || msg.includes("NoSuchKey")) {
        throw new NotFoundException("Foto não disponível no storage");
      }
      throw err;
    }
  }

  async presignedUrl(key: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async removeObject(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (err) {
      this.log.warn(`Falha ao apagar ${key}: ${(err as Error).message}`);
    }
  }
}
