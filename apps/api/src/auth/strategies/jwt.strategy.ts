import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
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

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== "access") throw new UnauthorizedException("Token inválido");

    if (payload.kind === "ADMIN_USER") {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { papel: { select: { permissoes: true } } },
      });
      if (!user || !user.ativo) throw new UnauthorizedException("Usuário inativo");
      return {
        kind: "ADMIN_USER",
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil,
        permissoes: user.papel?.permissoes ?? [],
      };
    }

    const motorista = await this.prisma.motorista.findUnique({ where: { id: payload.sub } });
    if (!motorista || !motorista.ativo) throw new UnauthorizedException("Motorista inativo");
    return {
      kind: "MOTORISTA",
      id: motorista.id,
      nome: motorista.nome,
      cpf: motorista.cpf,
      status: motorista.status,
    };
  }
}
