import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { comoSistema, definirConta } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser, JwtPayload } from "../types";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = config.get<string>("JWT_SECRET");
    if (!secret) throw new Error("JWT_SECRET não configurado");
    super({
      // Aceita Authorization: Bearer (padrão) OU ?access_token=... na query.
      // O query param e' necessario porque EventSource (SSE) nativo do
      // browser nao suporta headers customizados. Usado em /admin/inbox/stream.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter("access_token"),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Além de autenticar, é aqui que a CONTA da requisição é descoberta e
   * carimbada no contexto — daí pra frente toda consulta sai filtrada por ela.
   *
   * A busca em si roda em `comoSistema`: é a consulta que descobre a conta, não
   * dá pra ela já depender de saber a conta. O id vem do token assinado, então
   * não há o que filtrar mesmo.
   *
   * A conta continua fora do JWT, igual ao papel e ao escopo: tudo é recarregado
   * do banco a cada requisição, então mover um usuário de conta ou desativar uma
   * empresa vale na hora, sem esperar token expirar.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== "access") throw new UnauthorizedException("Token inválido");

    if (payload.kind === "ADMIN_USER") {
      const user = await comoSistema(() =>
        this.prisma.user.findUnique({
          where: { id: payload.sub },
          include: {
            conta: { select: { id: true, nome: true, ativa: true } },
            papel: { select: { permissoes: true } },
            // Escopo entra no mesmo findUnique: sem query extra por request, e a
            // revogação continua imediata (nada disso vive no token).
            transportadoras: { select: { transportadoraId: true } },
          },
        }),
      );
      if (!user || !user.ativo) throw new UnauthorizedException("Usuário inativo");
      if (!user.conta.ativa) throw new UnauthorizedException("Empresa desativada");

      definirConta(user.contaId);
      return {
        kind: "ADMIN_USER",
        id: user.id,
        nome: user.nome,
        email: user.email,
        contaId: user.contaId,
        contaNome: user.conta.nome,
        plataforma: user.plataforma,
        permissoes: user.papel?.permissoes ?? [],
        escopo: user.acessoGlobal
          ? null
          : { transportadoraIds: user.transportadoras.map((t) => t.transportadoraId) },
      };
    }

    const motorista = await comoSistema(() =>
      this.prisma.motorista.findUnique({
        where: { id: payload.sub },
        include: { conta: { select: { ativa: true } } },
      }),
    );
    if (!motorista || !motorista.ativo) throw new UnauthorizedException("Motorista inativo");
    if (!motorista.conta.ativa) throw new UnauthorizedException("Empresa desativada");

    definirConta(motorista.contaId);
    return {
      kind: "MOTORISTA",
      id: motorista.id,
      nome: motorista.nome,
      cpf: motorista.cpf,
      status: motorista.status,
      contaId: motorista.contaId,
    };
  }
}
