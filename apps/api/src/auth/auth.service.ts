import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { AvisoGrupoService } from "../whatsapp/aviso-grupo.service";
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
    private readonly avisoGrupo: AvisoGrupoService,
  ) {}

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  async loginAdmin(email: string, senha: string) {
    // O e-mail continua único no sistema inteiro (não por conta) justamente pra
    // que o login não precise perguntar "de qual empresa você é?". Achar o
    // usuário é o que revela a conta, então a busca roda sem filtro.
    const user = await comoSistema(() => this.prisma.user.findUnique({ where: { email } }));
    if (!user || !user.ativo) throw new UnauthorizedException("Credenciais inválidas");
    const ok = await bcrypt.compare(senha, user.senhaHash);
    if (!ok) throw new UnauthorizedException("Credenciais inválidas");
    await comConta(user.contaId, () =>
      this.prisma.user.update({
        where: { id: user.id },
        data: { ultimoLoginEm: new Date() },
      }),
    );
    return this.issueTokens({ sub: user.id, kind: "ADMIN_USER" });
  }

  async loginMotorista(cpf: string, senha: string) {
    // O CPF deixou de ser único no sistema: agora é único DENTRO da conta, então
    // o mesmo motorista pode ter cadastro em duas empresas — são cadastros
    // independentes, com senhas próprias. Na prática quase sempre há um só, e o
    // login é idêntico ao de antes; havendo mais de um, é a senha que diz qual.
    const candidatos = await comoSistema(() =>
      this.prisma.motorista.findMany({ where: { cpf, ativo: true } }),
    );
    if (candidatos.length === 0) throw new UnauthorizedException("Credenciais inválidas");

    const agora = new Date();
    const liberados = candidatos.filter((m) => !m.bloqueadoAte || m.bloqueadoAte <= agora);
    if (liberados.length === 0) {
      const menor = Math.min(...candidatos.map((m) => m.bloqueadoAte!.getTime()));
      throw new UnauthorizedException(
        `Conta bloqueada. Tente novamente em ${Math.ceil((menor - Date.now()) / 60_000)} minutos.`,
      );
    }

    let motorista: (typeof liberados)[number] | undefined;
    for (const candidato of liberados) {
      if (await bcrypt.compare(senha, candidato.senhaHash)) {
        motorista = candidato;
        break;
      }
    }

    if (!motorista) {
      // Senha errada conta tentativa em TODOS os cadastros do CPF: contar só num
      // deles deixaria alternar entre empresas pra fugir do bloqueio.
      await comoSistema(async () => {
        for (const candidato of liberados) {
          const tentativas = candidato.tentativasLogin + 1;
          await this.prisma.motorista.update({
            where: { id: candidato.id },
            data: {
              tentativasLogin: tentativas,
              bloqueadoAte:
                tentativas >= MAX_TENTATIVAS_MOTORISTA
                  ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000)
                  : null,
            },
          });
        }
      });
      throw new UnauthorizedException("Credenciais inválidas");
    }

    // Cadastro recusado não loga (PENDENTE_APROVACAO loga normal — o app mostra
    // o modo "em análise"). Só REJEITADO é barrado aqui.
    if (motorista.status === "REJEITADO") {
      throw new ForbiddenException(
        "Seu cadastro não foi aprovado. Fale com a empresa pra mais informações.",
      );
    }

    const escolhido = motorista;
    return comConta(escolhido.contaId, async () => {
      // Captura ANTES do update: ultimoLoginEm null = nunca acessou (ex:
      // motorista criado pelo admin que agora entra pela 1ª vez).
      const primeiroAcesso = escolhido.ultimoLoginEm === null;
      await this.prisma.motorista.update({
        where: { id: escolhido.id },
        data: { tentativasLogin: 0, bloqueadoAte: null, ultimoLoginEm: new Date() },
      });
      // No primeiro acesso, anuncia no grupo se ele já estiver lá (prova social).
      // Best-effort e idempotente (trava avisoGrupoEnviadoEm) — não duplica com o
      // disparo do auto-cadastro nem quebra o login.
      if (primeiroAcesso) void this.avisoGrupo.anunciarCadastro(escolhido.id);
      const tokens = await this.issueTokens({ sub: escolhido.id, kind: "MOTORISTA" });
      return { ...tokens, status: escolhido.status };
    });
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
    const tokens = await this.issueTokens({ sub: payload.sub, kind: payload.kind });
    // App do motorista usa o status pra decidir entre app normal e modo "em
    // análise". Devolve no refresh pra refletir aprovação sem precisar relogar.
    if (payload.kind === "MOTORISTA") {
      // Sem contexto ainda (o refresh vem antes de qualquer guard resolver a
      // conta), e o id é global — é seguro buscar sem filtro.
      const motorista = await comoSistema(() =>
        this.prisma.motorista.findUnique({
          where: { id: payload.sub },
          select: { status: true, ativo: true },
        }),
      );
      if (!motorista || !motorista.ativo) throw new UnauthorizedException("Motorista inativo");
      if (motorista.status === "REJEITADO") {
        throw new ForbiddenException("Seu cadastro não foi aprovado.");
      }
      return { ...tokens, status: motorista.status };
    }
    return tokens;
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

  /** Emite tokens pra um motorista já criado (usado no auto-cadastro). */
  async issueMotoristaTokens(motoristaId: string) {
    return this.issueTokens({ sub: motoristaId, kind: "MOTORISTA" });
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
