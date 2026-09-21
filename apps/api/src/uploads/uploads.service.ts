import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client as MinioClient } from "minio";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { contaIdAtual } from "../common/conta/conta-context";
import { chaveParaStorage } from "../common/chave-documento";
import { inicioDoDiaData } from "../common/timezone";

/**
 * A pasta do dia dentro do bucket, no calendário de Brasília.
 *
 * `new Date().toISOString()` jogaria tudo que entra depois das 21h na pasta
 * do dia seguinte — e quem for procurar o ticket de terça no MinIO não acha.
 */
function diaBR(): string {
  return inicioDoDiaData().toISOString().slice(0, 10);
}

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
    const key = `${contaIdAtual()}/tickets/${diaBR()}/${motoristaId}/${randomUUID()}.${ext}`;
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
    const key = `${contaIdAtual()}/abastecimentos/${diaBR()}/${motoristaId}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  /**
   * Logo da empresa (marca no painel).
   *
   * Nome com uuid a cada envio em vez de um `logo.png` fixo: o navegador cacheia
   * imagem por URL, e reaproveitar a chave faria a logo antiga continuar
   * aparecendo depois da troca.
   */
  async putLogoConta(buffer: Buffer, mimetype: string, contaId: string): Promise<string> {
    const ext = mimetype.includes("png") ? "png" : mimetype.includes("webp") ? "webp" : "jpg";
    const key = `${contaId}/marca/logo-${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  /** Remove um objeto; usado pra não acumular logo antiga no bucket. */
  async removerObjeto(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch {
      // Logo antiga que não apaga não é motivo pra falhar a troca da nova.
    }
  }

  async putStoryFoto(buffer: Buffer, mimetype: string, motoristaId: string): Promise<string> {
    const ext = mimetype.includes("png") ? "png" : "jpg";
    const key = `${contaIdAtual()}/stories/${diaBR()}/${motoristaId}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  /**
   * Foto do aviso publicado pelo painel. Mesmo arquivo serve o canal de Avisos
   * e o story oficial — por isso a chave não fica embaixo de "stories": a foto
   * do aviso sobrevive ao story, que expira em 24h.
   */
  async putAvisoFoto(buffer: Buffer, mimetype: string, usuarioId: string): Promise<string> {
    const ext = mimetype.includes("png") ? "png" : "jpg";
    const key = `${contaIdAtual()}/avisos/${diaBR()}/${usuarioId}/${randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  /**
   * Áudio de mensagem do chat. Guarda a extensão real (o app grava m4a; o
   * Whisper e o <audio> do player precisam do content-type certo pra decodificar).
   */
  async putMensagemAudio(
    buffer: Buffer,
    mimetype: string,
    motoristaId: string,
  ): Promise<string> {
    const ext = mimetype.includes("mpeg")
      ? "mp3"
      : mimetype.includes("ogg") || mimetype.includes("opus")
        ? "ogg"
        : mimetype.includes("webm")
          ? "webm"
          : "m4a";
    const key = `${contaIdAtual()}/chat-audio/${diaBR()}/${motoristaId}/${randomUUID()}.${ext}`;
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
    const key = `fechamentos/originais/${diaBR()}/${randomUUID()}.${ext}`;
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

  /**
   * A MINIATURA de um documento, gerada uma vez e guardada no bucket.
   *
   * ⚠️ Isto existe por causa do 4G do motorista. Sem ela, a lista de
   * documentos baixava o arquivo INTEIRO de cada item só pra desenhar 64
   * pixels na tela — com doze documentos, 15 a 25 MB do pacote de dados dele
   * pra ver uma tela. Gastar a internet de quem ganha por viagem não é
   * detalhe de performance.
   *
   * 200px de largura e qualidade 60 dão ~15 KB: não dá pra LER o documento,
   * dá pra RECONHECER qual é — que é o trabalho da miniatura. Quem precisa
   * conferir toca e aí sim baixa o original.
   *
   * ⚠️ `sharp` é binário nativo e o runtime é alpine. O import é DINÂMICO e
   * protegido: se o módulo não existir no build, a chamada devolve null e o
   * controller serve o original. Uma miniatura que falta gasta dados; uma API
   * que não sobe derruba o app inteiro.
   */
  async miniatura(
    storageKey: string,
    mimetype: string,
    versao: string | null,
  ): Promise<Buffer | null> {
    if (!mimetype.startsWith("image/")) return null;

    /**
     * ⚠️ A VERSÃO ENTRA NA CHAVE DA MINIATURA.
     *
     * A chave do arquivo é determinística — trocar a foto reusa o MESMO nome
     * no bucket. Sem o hash aqui, a miniatura guardada da foto antiga era
     * encontrada e devolvida pra sempre: o motorista trocava a foto, a URL
     * mudava, o app pedia de novo, e recebia a velha. Ele trocava outra vez,
     * achando que não tinha ido.
     */
    const keyThumb = versao
      ? `${storageKey}.${versao}.thumb.jpg`
      : `${storageKey}.thumb.jpg`;
    try {
      // Já gerada antes? Serve a guardada — a geração é o caro, não o stream.
      return await this.getObjectBuffer(keyThumb);
    } catch {
      /* primeira vez: gera abaixo */
    }

    try {
      const sharp = (await import("sharp")).default;
      const original = await this.getObjectBuffer(storageKey);
      const thumb = await sharp(original)
        .rotate() // respeita o EXIF: foto de celular deitada viraria de lado
        .resize({ width: 200, withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();

      await this.client.putObject(this.bucket, keyThumb, thumb, thumb.length, {
        "Content-Type": "image/jpeg",
      });
      return thumb;
    } catch (e) {
      this.log.warn(`Miniatura indisponível para ${storageKey}: ${String(e)}`);
      return null;
    }
  }

  /**
   * Arquivo de documento do motorista.
   *
   * ⚠️ A key é determinística pela CHAVE do documento (`exig:<id>` ou
   * `gaveta:<TIPO>`), não pela gaveta. Enquanto foi pela gaveta, duas
   * exigências que caem na mesma (RG e CTPS em `REGISTRO_MOTORISTA`)
   * sobrescreviam o mesmo objeto — o banco passou a distingui-las e o storage
   * continuaria juntando as duas. Determinística de propósito: reenviar o
   * arquivo é "refazer a foto", e tem que substituir em vez de acumular.
   */
  async putMotoristaDocumento(
    buffer: Buffer,
    mimetype: string,
    motoristaId: string,
    chave: string,
    nomeOriginal: string,
  ): Promise<string> {
    const ext = (nomeOriginal.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `${contaIdAtual()}/documentos/${motoristaId}/${chaveParaStorage(chave)}.${ext || "bin"}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  /**
   * Foto/PDF de um documento da CARTEIRA do motorista.
   *
   * Chave sob `pessoal/<identidadeId>/` — fora do prefixo de conta, porque o
   * documento é da PESSOA e a acompanha de transportadora em transportadora
   * (`locais/img/` já abria esse precedente de chave sem conta). Determinística
   * por tipo+placa: documento renovado substitui o anterior em vez de acumular
   * cópias antigas do mesmo papel.
   */
  async putDocumentoPessoal(
    buffer: Buffer,
    mimetype: string,
    identidadeId: string,
    tipo: string,
    nomeOriginal: string,
  ): Promise<string> {
    const ext = (nomeOriginal.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `pessoal/${identidadeId}/documentos/${tipo}-${randomUUID()}.${ext || "bin"}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": mimetype,
    });
    return key;
  }

  /**
   * Imagem do local (Street View / satélite) cacheada por COORDENADA. Chave
   * determinística (sobrescreve, sem uuid) — o custo na API do Google vira
   * único por ponto. `chaveCoord` já vem normalizada (ex: "-25.42840_-49.27330").
   */
  async putLocalImagem(buffer: Buffer, chaveCoord: string): Promise<string> {
    const key = `locais/img/${chaveCoord}.jpg`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": "image/jpeg",
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

  /**
   * Arte de post do Instagram da própria Movatruck.
   *
   * Fora do prefixo de conta de propósito (como `fechamentos/originais/` e
   * `pessoal/`): não é dado de empresa nenhuma, é material de marca da
   * plataforma. JPEG porque a API de publicação da Meta não aceita PNG.
   */
  async putArteInstagram(buffer: Buffer): Promise<string> {
    const key = `plataforma/instagram/${diaBR()}/${randomUUID()}.jpg`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      "Content-Type": "image/jpeg",
    });
    return key;
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
