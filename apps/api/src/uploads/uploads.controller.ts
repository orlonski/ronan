import {
  BadRequestException,
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

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

// m4a/aac é o que expo-audio grava nas duas plataformas; o resto cobre
// aparelho que devolve container diferente.
const AUDIO_PERMITIDO = [
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
  "video/mp4", // Android às vezes rotula .m4a assim
];
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

@ApiTags("uploads")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Roles("MOTORISTA")
  @Post("m/uploads/ticket")
  @UseInterceptors(FileInterceptor("foto"))
  async uploadTicket(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("Foto não enviada");
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo não permitido: ${file.mimetype}`);
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Foto maior que 10MB");
    }
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
    if (!file) throw new BadRequestException("Foto não enviada");
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo não permitido: ${file.mimetype}`);
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Foto maior que 10MB");
    }
    const key = await this.uploads.putAbastecimentoFoto(
      file.buffer,
      file.mimetype,
      user.id,
    );
    return { storageKey: key };
  }

  @Roles("MOTORISTA")
  @Post("m/uploads/story")
  @UseInterceptors(FileInterceptor("foto"))
  async uploadStory(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("Foto não enviada");
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo não permitido: ${file.mimetype}`);
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Foto maior que 10MB");
    }
    const key = await this.uploads.putStoryFoto(file.buffer, file.mimetype, user.id);
    return { storageKey: key };
  }

  /**
   * Áudio de mensagem do chat. Teto próprio (5MB) — a gravação é limitada a
   * poucos minutos no app, e um arquivo muito maior que isso é sinal de coisa
   * errada, não de motorista falante.
   */
  @Roles("MOTORISTA")
  @Post("m/uploads/chat-audio")
  @UseInterceptors(FileInterceptor("audio"))
  async uploadChatAudio(
    @CurrentUser() user: AuthMotorista,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("Áudio não enviado");
    // Sem `startsWith("audio/")` puro: o Android manda video/mp4 pra .m4a em
    // alguns aparelhos, e recusar isso derrubaria a gravação neles.
    const ok =
      AUDIO_PERMITIDO.includes(file.mimetype) || file.mimetype.startsWith("audio/");
    if (!ok) throw new BadRequestException(`Tipo não permitido: ${file.mimetype}`);
    if (file.size > MAX_AUDIO_BYTES) {
      throw new BadRequestException("Áudio maior que 5MB");
    }
    const key = await this.uploads.putMensagemAudio(file.buffer, file.mimetype, user.id);
    return { storageKey: key };
  }
}
