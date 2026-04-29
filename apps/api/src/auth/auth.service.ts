import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import type { JwtPayload } from "./types";

const BCRYPT_ROUNDS = 10;
const MAX_TENTATIVAS_MOTORISTA = 5;
const BLOQUEIO_MINUTOS = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  async loginAdmin(email: string, senha: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.ativo) throw new UnauthorizedException("Credenciais inválidas");
    const ok = await bcrypt.compare(senha, user.senhaHash);
    if (!ok) throw new UnauthorizedException("Credenciais inválidas");
    return this.issueTokens({ sub: user.id, kind: "ADMIN_USER" });
  }

  async loginMotorista(usuario: string, senha: string) {
    const motorista = await this.prisma.motorista.findUnique({ where: { usuario } });
    if (!motorista || !motorista.ativo) throw new UnauthorizedException("Credenciais inválidas");

    if (motorista.bloqueadoAte && motorista.bloqueadoAte > new Date()) {
      throw new UnauthorizedException(
        `Conta bloqueada. Tente novamente em ${Math.ceil(
          (motorista.bloqueadoAte.getTime() - Date.now()) / 60_000,
        )} minutos.`,
      );
    }

    const ok = await bcrypt.compare(senha, motorista.senhaHash);
    if (!ok) {
      const tentativas = motorista.tentativasLogin + 1;
      const bloquear = tentativas >= MAX_TENTATIVAS_MOTORISTA;
      await this.prisma.motorista.update({
        where: { id: motorista.id },
        data: {
          tentativasLogin: tentativas,
          bloqueadoAte: bloquear ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000) : null,
        },
      });
      throw new UnauthorizedException("Credenciais inválidas");
    }

    await this.prisma.motorista.update({
      where: { id: motorista.id },
      data: { tentativasLogin: 0, bloqueadoAte: null, ultimoLoginEm: new Date() },
    });
    return this.issueTokens({ sub: motorista.id, kind: "MOTORISTA" });
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Refresh token inválido");
    }
    if (payload.type !== "refresh") throw new UnauthorizedException("Token inválido");
    return this.issueTokens({ sub: payload.sub, kind: payload.kind });
  }

  async trocarSenhaMotorista(motoristaId: string, senhaAtual: string, novaSenha: string) {
    const motorista = await this.prisma.motorista.findUniqueOrThrow({ where: { id: motoristaId } });
    const ok = await bcrypt.compare(senhaAtual, motorista.senhaHash);
    if (!ok) throw new UnauthorizedException("Senha atual incorreta");
    await this.prisma.motorista.update({
      where: { id: motoristaId },
      data: { senhaHash: await AuthService.hashPassword(novaSenha) },
    });
  }

  private async issueTokens(base: Pick<JwtPayload, "sub" | "kind">) {
    const accessToken = await this.jwt.signAsync(
      { ...base, type: "access" } satisfies JwtPayload,
      {
        secret: this.config.getOrThrow("JWT_SECRET"),
        expiresIn: this.config.get("JWT_EXPIRES_IN") ?? "15m",
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, type: "refresh" } satisfies JwtPayload,
      {
        secret: this.config.getOrThrow("JWT_REFRESH_SECRET"),
        expiresIn: this.config.get("JWT_REFRESH_EXPIRES_IN") ?? "90d",
      },
    );
    return { accessToken, refreshToken };
  }
}
