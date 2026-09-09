import { createHmac, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

/**
 * Autenticação do webhook do Chatwoot.
 *
 * O Chatwoot não assina o corpo como a Meta faz — ele só faz POST na URL que a
 * gente cadastrar. Então o segredo mora na própria URL (`?token=`), e é isso
 * que separa o Chatwoot de qualquer um que descubra o endpoint.
 *
 * **Fail-closed de propósito**: sem `CHATWOOT_WEBHOOK_TOKEN` no ambiente o
 * guard recusa tudo, em vez de deixar passar. Guard que libera quando não está
 * configurado é o pior dos dois mundos — parece protegido e não está.
 */
@Injectable()
export class ChatwootTokenGuard implements CanActivate {
  private readonly log = new Logger("ChatwootWebhook");

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esperado = this.config.get<string>("CHATWOOT_WEBHOOK_TOKEN");
    if (!esperado) {
      this.log.error("CHATWOOT_WEBHOOK_TOKEN não configurado — recusando o evento");
      throw new UnauthorizedException();
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const recebido = (req.query?.token ?? "") as string;
    if (typeof recebido !== "string" || !confere(recebido, esperado)) {
      // Sem o valor no log: é segredo, mesmo quando está errado.
      this.log.warn("evento recusado: token não confere");
      throw new UnauthorizedException();
    }
    return true;
  }
}

/**
 * Compara em tempo constante. Passa pelo HMAC antes pra igualar o tamanho —
 * `timingSafeEqual` exige buffers do mesmo tamanho, e comparar o tamanho antes
 * já vazaria informação.
 */
function confere(recebido: string, esperado: string): boolean {
  const chave = "chatwoot-token";
  const a = createHmac("sha256", chave).update(recebido).digest();
  const b = createHmac("sha256", chave).update(esperado).digest();
  return timingSafeEqual(a, b);
}
