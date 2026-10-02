import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema, definirConta } from "../common/conta/conta-context";
import { estadoDaConta } from "../common/conta/estado-da-conta";
import { modulosDaConta } from "../common/conta/teto-da-conta";
import { hashSegredo, PREFIXO_TOKEN, sessaoValida } from "./encarregado-regras";

/**
 * Quem está do outro lado no portal da obra. NÃO é `AuthUser`, e não mora em
 * `req.user`, de propósito: nenhum guard do painel ou do app enxerga isto como
 * usuário — o `RolesGuard`, o `PermissaoGuard` e o `SomenteLeituraGuard` só
 * conhecem `req.user`. E o token opaco do portal não é JWT: mandado pra uma
 * rota `admin/*` ou `m/*`, o `JwtAuthGuard` recusa com 401.
 */
export type AuthEncarregado = {
  kind: "ENCARREGADO";
  sessaoId: string;
  encarregadoId: string;
  contaId: string;
  /** A OBRA. Toda consulta do portal filtra por aqui. */
  clienteId: string;
  nome: string;
  podeVerValores: boolean;
  podePedirCaminhao: boolean;
};

type RequestComEncarregado = Request & { encarregado?: AuthEncarregado };

const CODIGO_SESSAO_INVALIDA = "SESSAO_ENCARREGADO_INVALIDA";

/** De quanto em quanto tempo vale gravar o "último uso" (evita um UPDATE por request). */
const GRAVAR_USO_A_CADA_MS = 5 * 60_000;

/**
 * O guard do portal da obra. Fail-closed em tudo: sem token, token de outro
 * formato, sessão revogada/vencida, encarregado desativado, obra encerrada,
 * empresa suspensa ou sem o módulo — tudo é recusa.
 *
 * Achou a sessão, põe a conta dela no contexto da requisição (`definirConta`,
 * o mesmo que o `JwtStrategy` faz pro painel). Daí pra frente a trava filtra
 * tudo pela empresa dona da obra — e o service ainda filtra pela OBRA.
 */
@Injectable()
export class EncarregadoGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestComEncarregado>();
    const token = tokenDoCabecalho(req);
    if (!token) throw naoAutenticado();

    const sessao = await comoSistema(() =>
      this.prisma.sessaoEncarregado.findUnique({
        where: { tokenHash: hashSegredo(token) },
        select: {
          id: true,
          contaId: true,
          expiraEm: true,
          revogadaEm: true,
          ultimoUsoEm: true,
          encarregado: {
            select: {
              id: true,
              clienteId: true,
              nome: true,
              ativo: true,
              podeVerValores: true,
              podePedirCaminhao: true,
              cliente: { select: { ativa: true } },
            },
          },
          conta: {
            select: { ativa: true, somenteLeitura: true, trialExpiraEm: true, motivoBloqueio: true },
          },
        },
      }),
    );
    if (!sessao || !sessaoValida(sessao)) throw naoAutenticado();

    const estado = estadoDaConta(sessao.conta);
    if (!estado.podeEntrar) {
      throw new ForbiddenException({
        code: "PORTAL_INDISPONIVEL",
        message: "O acompanhamento desta obra está fora do ar. Fale com a transportadora.",
      });
    }
    const escrita = req.method !== "GET" && req.method !== "HEAD";
    if (escrita && !estado.podeEscrever) {
      throw new ForbiddenException({
        code: "PORTAL_SOMENTE_LEITURA",
        message: "Por enquanto dá só pra consultar. Fale com a transportadora.",
      });
    }
    // Módulo cancelado fecha o portal na hora — não depende de alguém lembrar
    // de desativar os encarregados.
    const modulos = await comoSistema(() => modulosDaConta(this.prisma, sessao.contaId));
    if (!modulos.has("torre")) throw naoAutenticado();

    definirConta(sessao.contaId);
    req.encarregado = {
      kind: "ENCARREGADO",
      sessaoId: sessao.id,
      encarregadoId: sessao.encarregado.id,
      contaId: sessao.contaId,
      clienteId: sessao.encarregado.clienteId,
      nome: sessao.encarregado.nome,
      podeVerValores: sessao.encarregado.podeVerValores,
      podePedirCaminhao: sessao.encarregado.podePedirCaminhao,
    };

    const agora = Date.now();
    if (!sessao.ultimoUsoEm || agora - sessao.ultimoUsoEm.getTime() > GRAVAR_USO_A_CADA_MS) {
      // Fire-and-forget: carimbar uso não pode atrasar nem derrubar a tela.
      void this.prisma.sessaoEncarregado
        .updateMany({ where: { id: sessao.id }, data: { ultimoUsoEm: new Date(agora) } })
        .catch(() => {});
    }
    return true;
  }
}

function naoAutenticado() {
  return new UnauthorizedException({
    code: CODIGO_SESSAO_INVALIDA,
    message: "Sua entrada venceu. Peça um código novo.",
  });
}

/** Só `Bearer obra_…`. Qualquer outra coisa (JWT do painel, lixo) nem consulta o banco. */
function tokenDoCabecalho(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  if (!t.startsWith(PREFIXO_TOKEN) || t.length < 40 || t.length > 100) return null;
  return t;
}

/** O encarregado autenticado pelo `EncarregadoGuard`. */
export const EncarregadoAtual = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RequestComEncarregado>();
  // Sem o guard na frente, isto é bug de código — recusa em vez de seguir sem
  // saber quem é.
  if (!req.encarregado) throw naoAutenticado();
  return req.encarregado;
});
