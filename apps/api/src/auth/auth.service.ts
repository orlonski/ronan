import { ForbiddenException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import type { MotoristaIdentidade, StatusMotorista } from "@prisma/client";
import type { CadastroEmpresa, SessaoEmpresa } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { VINCULO_VIVO, vinculoVivo } from "../common/vinculo";
import { IdentidadeService } from "./identidade.service";
import { PrismaService } from "../prisma/prisma.service";
import { AvisoGrupoService } from "../whatsapp/aviso-grupo.service";
import type { JwtPayload } from "./types";

const BCRYPT_ROUNDS = 10;
const MAX_TENTATIVAS_MOTORISTA = 5;
const BLOQUEIO_MINUTOS = 15;

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly avisoGrupo: AvisoGrupoService,
    private readonly identidades: IdentidadeService,
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

  /**
   * Login do motorista: autentica a PESSOA, não o cadastro.
   *
   * Quem confere a senha é a identidade (uma linha por CPF na plataforma), e
   * só depois vêm os vínculos: o mesmo CPF pode rodar pra mais de uma empresa
   * (de dia pra uma, de noite pra outra), e pode não rodar pra nenhuma — quem
   * se cadastrou pelo app e ainda não foi convidado entra assim mesmo, no
   * modo sem empresa.
   *
   * Antes disto a senha morava no cadastro e o login comparava o hash de cada
   * um deles em sequência; a mesma senha vivia copiada em N linhas
   * (`propagarSenha`) só pra manter a ilusão de que era uma só.
   */
  async loginMotorista(cpf: string, senha: string, suportaIdentidade = false) {
    const identidade = await this.identidades.garantirPorCpf(cpf);
    // Mesma resposta pra CPF inexistente e senha errada — quem tenta adivinhar
    // não descobre nem que a pessoa existe.
    if (!identidade || !identidade.ativo) throw new UnauthorizedException("Credenciais inválidas");

    if (identidade.bloqueadoAte && identidade.bloqueadoAte > new Date()) {
      const faltam = Math.ceil((identidade.bloqueadoAte.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`Conta bloqueada. Tente novamente em ${faltam} minutos.`);
    }

    if (!(await this.conferirSenha(identidade, senha))) {
      const tentativas = identidade.tentativasLogin + 1;
      await comoSistema(() =>
        this.prisma.motoristaIdentidade.update({
          where: { id: identidade.id },
          data: {
            tentativasLogin: tentativas,
            bloqueadoAte:
              tentativas >= MAX_TENTATIVAS_MOTORISTA
                ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000)
                : null,
          },
        }),
      );
      throw new UnauthorizedException("Credenciais inválidas");
    }

    await comoSistema(() =>
      this.prisma.motoristaIdentidade.update({
        where: { id: identidade.id },
        data: { tentativasLogin: 0, bloqueadoAte: null, ultimoLoginEm: new Date() },
      }),
    );

    // Cadastro recusado some da lista (PENDENTE_APROVACAO fica — o app mostra o
    // modo "em análise", que é de propósito). Convite não respondido também não
    // vira sessão: ele decide isso na tela de convites, não entrando.
    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { identidadeId: identidade.id, ...VINCULO_VIVO },
        orderBy: { criadoEm: "desc" },
      }),
    );

    if (vinculos.length === 0 && !suportaIdentidade) {
      // App antigo não sabe entrar sem empresa. Em vez de devolver uma resposta
      // sem `accessToken` (que ele guardaria como `undefined` e ficaria num
      // limbo mudo), diz o que está acontecendo.
      const recusado = await comoSistema(() =>
        this.prisma.motorista.findFirst({
          where: { identidadeId: identidade.id, status: "REJEITADO" },
          select: { id: true },
        }),
      );
      throw new ForbiddenException(
        recusado
          ? "Seu cadastro não foi aprovado. Fale com a empresa pra mais informações."
          : "Você ainda não está em nenhuma empresa. Atualize o app pra continuar.",
      );
    }

    // Uma sessão por empresa, todas de uma vez. Emitir o token das duas não
    // amplia risco nenhum: quem sabe a senha do CPF já podia entrar em qualquer
    // uma delas — e é isso que deixa o motorista trocar de empresa no meio do
    // dia sem digitar senha, inclusive offline.
    const sessoes: SessaoEmpresa[] = [];
    for (const cadastro of vinculos) {
      sessoes.push(await this.abrirSessao(cadastro));
    }

    const principal = sessoes[0];
    // Formato antigo no topo, de propósito: o app que ainda não recebeu o update
    // lê exatamente estes campos e ignora o resto. Ninguém é deslogado por causa
    // desta mudança.
    return {
      accessToken: principal?.accessToken,
      refreshToken: principal?.refreshToken,
      status: principal?.status,
      cadastros: sessoes,
      identidade: await this.issueTokens({ sub: identidade.id, kind: "IDENTIDADE" }),
    };
  }

  /**
   * Confere a senha na identidade e, se não bater, tenta nos hashes dos vínculos
   * daquele CPF — curando a identidade quando algum aceita.
   *
   * A rede existe por causa da migração: o hash da identidade foi eleito entre
   * os vínculos do CPF, e mesmo que a base tivesse hashes divergentes (bcrypt
   * gera salt novo a cada escrita, então a MESMA senha aparece com hashes
   * diferentes), ninguém pode ficar trancado do lado de fora porque a eleição
   * escolheu a linha "errada". Sem isso, o custo do erro seria um motorista
   * parado no acostamento sem conseguir lançar.
   */
  private async conferirSenha(identidade: MotoristaIdentidade, senha: string): Promise<boolean> {
    if (await bcrypt.compare(senha, identidade.senhaHash)) return true;

    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { identidadeId: identidade.id },
        select: { senhaHash: true },
      }),
    );
    for (const v of vinculos) {
      if (v.senhaHash === identidade.senhaHash) continue;
      if (!(await bcrypt.compare(senha, v.senhaHash))) continue;
      await comoSistema(() =>
        this.prisma.motoristaIdentidade.update({
          where: { id: identidade.id },
          data: { senhaHash: v.senhaHash },
        }),
      );
      this.log.warn(
        `Senha da identidade ${identidade.id} corrigida a partir de um vínculo (herança da migração).`,
      );
      return true;
    }
    return false;
  }

  /**
   * Marca o acesso e emite os tokens de UM cadastro. Roda dentro da conta dele —
   * o `update` é dado de negócio e passa pela trava.
   *
   * Público porque o cadastro pelo app também abre sessão (quando adota um
   * vínculo que a empresa já tinha criado). Quem chama é responsável por só
   * passar vínculo vivo — ver common/vinculo.ts.
   */
  async abrirSessao(cadastro: {
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
        select: { identidadeId: true },
      }),
    );
    // Vínculo sem identidade é cadastro anterior à separação pessoa/vínculo que
    // ainda não passou por um login (é lá que a identidade nasce sob demanda).
    // Enquanto isso ele enxerga só a empresa em que está.
    if (!eu.identidadeId) return this.cadastrosDaIdentidade(null, motoristaId);
    return this.cadastrosDaIdentidade(eu.identidadeId);
  }

  /** Idem, a partir da pessoa — é o que a tela de perfil e o seletor usam. */
  async cadastrosDaIdentidade(
    identidadeId: string | null,
    motoristaId?: string,
  ): Promise<CadastroEmpresa[]> {
    const cadastros = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: identidadeId ? { identidadeId, ...VINCULO_VIVO } : { id: motoristaId },
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
   * Emite tokens pra outro cadastro da MESMA PESSOA, sem senha. É o caminho de
   * quando o app não tem a sessão guardada (cadastro aprovado depois do login,
   * ou app reinstalado).
   *
   * A trava não protege isto — a checagem "é a mesma pessoa" é o guard aqui, e
   * precisa ser feita à mão.
   */
  async trocarEmpresa(motoristaAtualId: string, destinoId: string) {
    const [atual, destino] = await comoSistema(() =>
      Promise.all([
        this.prisma.motorista.findUniqueOrThrow({
          where: { id: motoristaAtualId },
          select: { identidadeId: true },
        }),
        this.prisma.motorista.findUnique({
          where: { id: destinoId },
          select: {
            id: true,
            identidadeId: true,
            contaId: true,
            status: true,
            aceite: true,
            ativo: true,
            ultimoLoginEm: true,
          },
        }),
      ]),
    );
    // Mesma resposta pra "não existe" e "é de outra pessoa": quem tentar adivinhar
    // id de motorista não descobre nem que ele existe. `identidadeId` nulo dos
    // dois lados não pode virar "iguais" — cadastro sem identidade não troca de
    // empresa por aqui.
    if (
      !destino ||
      !atual.identidadeId ||
      destino.identidadeId !== atual.identidadeId ||
      !vinculoVivo(destino)
    ) {
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

    if (payload.kind === "IDENTIDADE") {
      const identidade = await comoSistema(() =>
        this.prisma.motoristaIdentidade.findUnique({
          where: { id: payload.sub },
          select: { ativo: true },
        }),
      );
      if (!identidade || !identidade.ativo) throw new UnauthorizedException("Cadastro inativo");
      return tokens;
    }

    // App do motorista usa o status pra decidir entre app normal e modo "em
    // análise". Devolve no refresh pra refletir aprovação sem precisar relogar.
    if (payload.kind === "MOTORISTA") {
      // Sem contexto ainda (o refresh vem antes de qualquer guard resolver a
      // conta), e o id é global — é seguro buscar sem filtro.
      const motorista = await comoSistema(() =>
        this.prisma.motorista.findUnique({
          where: { id: payload.sub },
          select: { status: true, ativo: true, aceite: true },
        }),
      );
      if (!motorista || !motorista.ativo) throw new UnauthorizedException("Motorista inativo");
      if (motorista.status === "REJEITADO") {
        throw new ForbiddenException("Seu cadastro não foi aprovado.");
      }
      if (motorista.aceite !== "ACEITO") {
        throw new ForbiddenException("Esse vínculo com a empresa não está ativo.");
      }
      return { ...tokens, status: motorista.status };
    }
    return tokens;
  }

  async trocarSenhaMotorista(motoristaId: string, senhaAtual: string, novaSenha: string) {
    const motorista = await this.prisma.motorista.findUniqueOrThrow({ where: { id: motoristaId } });
    const identidade = await this.identidades.garantirPorCpf(motorista.cpf);
    if (!identidade) throw new UnauthorizedException("Cadastro não encontrado");
    // Passa pelo `conferirSenha` (e não por um bcrypt.compare direto) pra que a
    // senha herdada de um vínculo também sirva aqui — o motorista não devia
    // descobrir a migração justamente na hora de trocar a senha.
    if (!(await this.conferirSenha(identidade, senhaAtual))) {
      throw new UnauthorizedException("Senha atual incorreta");
    }
    await AuthService.propagarSenha(
      this.prisma,
      motorista.cpf,
      await AuthService.hashPassword(novaSenha),
    );
  }

  /**
   * Grava a nova senha da PESSOA.
   *
   * O motorista tem um CPF e uma senha, e não faz sentido pedir que ele decore
   * uma por empresa. Desde a separação pessoa/vínculo isso é uma linha só (a
   * identidade) — o `updateMany` nos cadastros existe só pra manter a coluna
   * legada em sincronia enquanto ela não é dropada. Nada mais LÊ o `senhaHash`
   * do vínculo, fora a rede de segurança do `conferirSenha`.
   */
  static async propagarSenha(prisma: PrismaService, cpf: string, senhaHash: string) {
    await comoSistema(async () => {
      await prisma.motoristaIdentidade.updateMany({
        where: { cpf },
        data: { senhaHash, tentativasLogin: 0, bloqueadoAte: null },
      });
      await prisma.motorista.updateMany({
        where: { cpf, ativo: true },
        data: { senhaHash, tentativasLogin: 0, bloqueadoAte: null },
      });
    });
  }

  /** Emite tokens da PESSOA — é o que o cadastro sem empresa devolve. */
  async issueIdentidadeTokens(identidadeId: string) {
    return this.issueTokens({ sub: identidadeId, kind: "IDENTIDADE" });
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
