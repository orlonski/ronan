import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { UploadsService } from "./uploads.service";
import { checarArquivoEnviado, MIMES_DOCUMENTO, MIMES_IMAGEM } from "../common/arquivo-enviado";
import { ETAPA_ARQUIVO_MAX_BYTES } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { contaIdAtual } from "../common/conta/conta-context";
import { exigirModuloDespesas, exigirMotoristaAprovado } from "../common/despesa-acesso";

const MAX_BYTES = 10 * 1024 * 1024;

@ApiTags("uploads")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles("MOTORISTA")
  @Post("m/uploads/ticket")
  @UseInterceptors(FileInterceptor("foto"))
  async uploadTicket(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    checarArquivoEnviado(file, {
      mimes: MIMES_IMAGEM,
      maxBytes: MAX_BYTES,
      comoDizer: "Isso não é uma foto. Mande uma imagem.",
    });
    const key = await this.uploads.putTicketFoto(file.buffer, file.mimetype, user.id);
    return { storageKey: key };
  }

  @Roles("MOTORISTA")
  @Post("m/uploads/abastecimento")
  @UseInterceptors(FileInterceptor("foto"))
  async uploadAbastecimento(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    checarArquivoEnviado(file, {
      mimes: MIMES_IMAGEM,
      maxBytes: MAX_BYTES,
      comoDizer: "Isso não é uma foto. Mande uma imagem.",
    });
    const key = await this.uploads.putAbastecimentoFoto(
      file.buffer,
      file.mimetype,
      user.id,
    );
    return { storageKey: key };
  }

  /**
   * Foto do comprovante do GASTO DE VIAGEM. Devolve a chave e o sha256 (calculado
   * aqui). Mesmas portas do POST /m/despesas: cadastro aprovado e módulo.
   */
  @Roles("MOTORISTA")
  @Post("m/uploads/despesa")
  @UseInterceptors(FileInterceptor("foto"))
  async uploadDespesa(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    await exigirModuloDespesas(this.prisma, contaIdAtual());
    checarArquivoEnviado(file, {
      mimes: MIMES_IMAGEM,
      maxBytes: MAX_BYTES,
      comoDizer: "Isso não é uma foto. Mande uma imagem.",
    });
    return this.uploads.putDespesaFoto(file.buffer, file.mimetype, user.id);
  }

  /**
   * Documento de ETAPA DA VIAGEM: foto OU PDF (CT-e, MDF-e e o comprovante de
   * encerramento chegam em PDF pelo WhatsApp do escritório). Campo `arquivo`.
   * Só checa o cadastro aprovado: sem o módulo o POST /m/etapas aceita e
   * carimba, então o arquivo também precisa entrar (nunca 403 por contrato).
   */
  @Roles("MOTORISTA")
  @Post("m/uploads/etapa")
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: ETAPA_ARQUIVO_MAX_BYTES, files: 1 } }))
  async uploadEtapa(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    await exigirMotoristaAprovado(this.prisma, user.id);
    checarArquivoEnviado(file, {
      mimes: MIMES_DOCUMENTO,
      maxBytes: ETAPA_ARQUIVO_MAX_BYTES,
      comoDizer: "Mande uma foto ou um PDF.",
    });
    return this.uploads.putEtapaArquivo(file.buffer, file.mimetype, user.id);
  }

  @Roles("MOTORISTA")
  @Post("m/uploads/story")
  @UseInterceptors(FileInterceptor("foto"))
  async uploadStory(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    checarArquivoEnviado(file, {
      mimes: MIMES_IMAGEM,
      maxBytes: MAX_BYTES,
      comoDizer: "Isso não é uma foto. Mande uma imagem.",
    });
    const key = await this.uploads.putStoryFoto(file.buffer, file.mimetype, user.id);
    return { storageKey: key };
  }

  /**
   * ⚠️ Aqui existia `POST m/uploads/chat-audio`, e ele saiu em 22/09/2026.
   *
   * O áudio do chat foi removido do app em 12/08/2026, e o endpoint ficou:
   * porta aberta que nenhuma tela usava, com lista de mimes própria e teto
   * próprio pra manter. Ficou de pé mais um mês só porque build antigo
   * instalado poderia chamá-lo — e a conta disso é uma gravação que falha no
   * envio, não um app que quebra.
   *
   * O que NÃO saiu, e tem serviço a prestar: ler, transcrever e APAGAR o
   * áudio que já está no banco. Mensagem antiga continua tendo `audioKey` até
   * a retenção de 60 dias levar o arquivo.
   */
}
