import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as MinioClient } from "minio";
import { randomUUID } from "node:crypto";

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

  async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
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
