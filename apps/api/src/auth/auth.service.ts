import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import type { StatusMotorista } from "@prisma/client";
import type { CadastroEmpresa, SessaoEmpresa } from "@ronan/shared-types";
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
    // O CPF é único DENTRO da conta, não no sistema: o mesmo motorista pode ter
    // cadastro em várias empresas (carrega de dia pra uma, de noite pra outra).
    // São cadastros INDEPENDENTES — um nunca enxerga o dado do outro —, mas a
    // SENHA é da pessoa, não do cadastro (ver `propagarSenha`). Por isso a senha
    // não serve pra dizer em qual empresa ele quer entrar: o login devolve
    // todas em que ela bate e QUEM ESCOLHE É ELE, no app.
    const candidatos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { cpf, ativo: true },
        orderBy: { criadoEm: "desc" },
      }),
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

    const conferem: (typeof liberados)[number][] = [];
    for (const candidato of liberados) {
      if (await bcrypt.compare(senha, candidato.senhaHash)) conferem.push(candidato);
    }
    const motorista = conferem[0];

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

    // Cadastro recusado não entra (PENDENTE_APROVACAO entra normal — o app mostra
    // o modo "em análise"). Recusado em UMA empresa não impede as outras: some da
    // lista e pronto. Só barra se todas recusaram.
    const validos = conferem.filter((m) => m.status !== "REJEITADO");
    if (validos.length === 0) {
      throw new ForbiddenException(
        "Seu cadastro não foi aprovado. Fale com a empresa pra mais informações.",
      );
    }

    // Uma sessão por empresa, todas de uma vez. Emitir o token das duas não
    // amplia risco nenhum: quem sabe a senha do CPF já podia entrar em qualquer
    // uma delas — e é isso que deixa o motorista trocar de empresa no meio do
    // dia sem digitar senha, inclusive offline.
    const sessoes: SessaoEmpresa[] = [];
    for (const cadastro of validos) {
      sessoes.push(await this.abrirSessao(cadastro));
    }

    const principal = sessoes[0]!;
    // Formato antigo no topo, de propósito: o app que ainda não recebeu o update
    // lê exatamente estes campos e ignora `cadastros`. Ninguém é deslogado por
    // causa desta mudança.
    return {
      accessToken: principal.accessToken,
      refreshToken: principal.refreshToken,
      status: principal.status,
      cadastros: sessoes,
    };
  }

  /**
   * Marca o acesso e emite os tokens de UM cadastro. Roda dentro da conta dele —
   * o `update` é dado de negócio e passa pela trava.
   */
  private async abrirSessao(cadastro: {
    id: string;
    contaId: string;
    status: StatusMotorista;
    ultimoLoginEm: Date | null;
  }): Promise<SessaoEmpresa> {
    return comConta(cadastro.contaId, async () => {
      // Captura ANTES do update: ultimoLoginEm null = nunca acessou (ex:
      // motorista criado pelo admin que agora entra pela 1ª vez).
      const primeiroAcesso = cadastro.ultimoLoginEm === null;
      const atualizado = await this.prisma.motorista.update({
        where: { id: cadastro.id },
        data: { tentativasLogin: 0, bloqueadoAte: null, ultimoLoginEm: new Date() },
        select: { contaId: true, status: true, conta: { select: { nome: true } } },
      });
      // No primeiro acesso, anuncia no grupo se ele já estiver lá (prova social).
      // Best-effort e idempotente (trava avisoGrupoEnviadoEm) — não duplica com o
      // disparo do auto-cadastro nem quebra o login.
      if (primeiroAcesso) void this.avisoGrupo.anunciarCadastro(cadastro.id);
      const tokens = await this.issueTokens({ sub: cadastro.id, kind: "MOTORISTA" });
      return {
        motoristaId: cadastro.id,
        contaId: atualizado.contaId,
        contaNome: atualizado.conta.nome,
        status: atualizado.status,
        ...tokens,
      };
    });
  }

  /**
   * As empresas em que este CPF tem cadastro. O app usa pra manter o seletor em
   * dia (cadastro novo aprovado depois do login não aparece sozinho).
   *
   * Atravessa contas de propósito, mas devolve só o que o próprio motorista já
   * sabe: o nome da empresa pra qual ele roda. Nada mais da outra empresa sai
   * daqui — o campo a campo é a fronteira.
   */
  async cadastrosDoMotorista(motoristaId: string): Promise<CadastroEmpresa[]> {
    const eu = await comoSistema(() =>
      this.prisma.motorista.findUniqueOrThrow({
        where: { id: motoristaId },
        select: { cpf: true },
      }),
    );
    const cadastros = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { cpf: eu.cpf, ativo: true, status: { not: "REJEITADO" } },
        select: { id: true, contaId: true, status: true, conta: { select: { nome: true } } },
        orderBy: { criadoEm: "desc" },
      }),
    );
    return cadastros.map((c) => ({
      motoristaId: c.id,
      contaId: c.contaId,
      contaNome: c.conta.nome,
      status: c.status,
    }));
  }

  /**
   * Emite tokens pra outro cadastro do MESMO CPF, sem senha. É o caminho de
   * quando o app não tem a sessão guardada (cadastro aprovado depois do login,
   * ou app reinstalado).
   *
   * A trava não protege isto — a checagem "é o mesmo CPF" é o guard aqui, e
   * precisa ser feita à mão.
   */
  async trocarEmpresa(motoristaAtualId: string, destinoId: string) {
    const [atual, destino] = await comoSistema(() =>
      Promise.all([
        this.prisma.motorista.findUniqueOrThrow({
          where: { id: motoristaAtualId },
          select: { cpf: true },
        }),
        this.prisma.motorista.findUnique({
          where: { id: destinoId },
          select: { id: true, cpf: true, contaId: true, status: true, ativo: true, ultimoLoginEm: true },
        }),
      ]),
    );
    // Mesma resposta pra "não existe" e "é de outra pessoa": quem tentar adivinhar
    // id de motorista não descobre nem que ele existe.
    if (!destino || destino.cpf !== atual.cpf || !destino.ativo || destino.status === "REJEITADO") {
      throw new ForbiddenException("Esse cadastro não é seu.");
    }
    return this.abrirSessao(destino);
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
    await AuthService.propagarSenha(
      this.prisma,
      motorista.cpf,
      await AuthService.hashPassword(novaSenha),
    );
  }

  /**
   * Grava a senha em TODOS os cadastros do CPF.
   *
   * A senha é da PESSOA, não do cadastro: o motorista tem um CPF e uma senha, e
   * não faz sentido pedir que ele decore uma por empresa. É a única coisa que
   * atravessa a fronteira entre empresas de propósito — e nem chega a ser dado
   * de negócio: é credencial dele, ninguém do outro lado a enxerga (o painel só
   * vê o hash, e nem isso: `senhaHash` nunca sai da API).
   *
   * Sem isto o motorista trocaria a senha numa empresa e ficaria trancado do
   * lado de fora da outra, sem entender por quê.
   */
  static async propagarSenha(prisma: PrismaService, cpf: string, senhaHash: string) {
    await comoSistema(() =>
      prisma.motorista.updateMany({
        where: { cpf, ativo: true },
        data: { senhaHash, tentativasLogin: 0, bloqueadoAte: null },
      }),
    );
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
