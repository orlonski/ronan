import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../auth/types";

/**
 * De qual empresa é a configuração que está sendo lida/salva.
 *
 * O WhatsApp é uma instância ÚNICA, dividida por todas as empresas, mas o grupo
 * de aviso é de cada uma. Quem opera a plataforma precisa configurar o grupo de
 * qualquer empresa sem virar usuário dela — daí o `contaId` opcional na
 * requisição.
 *
 * Só operador da plataforma pode apontar pra outra empresa. Sem isso, um admin
 * qualquer trocaria o `contaId` na URL e mexeria no grupo de outra empresa: o
 * painel chama a API direto do navegador, então a regra mora aqui e não na tela.
 *
 * Sem `contaId`, é sempre a própria conta — o comportamento de antes.
 */
export function contaAlvo(user: AuthUser, contaId?: string): string {
  if (user.kind !== "ADMIN_USER") {
    throw new ForbiddenException("Só usuário do painel acessa esta configuração.");
  }
  if (!contaId || contaId === user.contaId) return user.contaId;
  if (!user.plataforma) {
    throw new ForbiddenException("Você só configura a sua própria empresa.");
  }
  return contaId;
}
