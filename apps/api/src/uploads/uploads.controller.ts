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
}
