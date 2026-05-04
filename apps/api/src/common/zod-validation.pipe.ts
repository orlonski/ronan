import {
  ArgumentMetadata,
  BadRequestException,
  Logger,
  PipeTransform,
} from "@nestjs/common";
import type { ZodSchema } from "zod";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  private readonly logger = new Logger("ZodValidation");

  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      }));
      // Loga em warn pra aparecer no Easypanel (default NestJS so loga 5xx)
      this.logger.warn(`Validacao falhou: ${JSON.stringify(issues)}`);
      throw new BadRequestException({ message: "Erro de validação", issues });
    }
    return parsed.data;
  }
}
