import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { comoSistema, definirConta } from "../../common/conta/conta-context";
import { vinculoVivo } from "../../common/vinculo";
import { PrismaService } from "../../prisma/prisma.service";
import { resolverContaEfetiva } from "../conta-efetiva";
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
            // A empresa que ele está visitando, se estiver. Vem no mesmo
            // findUnique pra não custar uma query por requisição.
            contaAtiva: { select: { id: true, nome: true, ativa: true } },
            papel: { select: { permissoes: true } },
            // Escopo entra no mesmo findUnique: sem query extra por request, e a
            // revogação continua imediata (nada disso vive no token).
            transportadoras: { select: { transportadoraId: true } },
          },
        }),
      );
      if (!user || !user.ativo) throw new UnauthorizedException("Usuário inativo");
      if (!user.conta.ativa) throw new UnauthorizedException("Empresa desativada");

      // Quem manda nesta requisição: a empresa visitada, se houver uma válida.
      // A regra mora em `conta-efetiva.ts`, separada e testada — é ela que
      // decide o isolamento entre empresas.
      const { conta: efetiva, assumida } = resolverContaEfetiva(user);

      definirConta(efetiva.id);
      return {
        kind: "ADMIN_USER",
        id: user.id,
        nome: user.nome,
        email: user.email,
        // `contaId` é sempre a EFETIVA — a mesma que a trava do Prisma vai usar.
        // Se aqui dissesse a conta de origem, os pontos que decidem por ele
        // (MinhaEmpresa, contaAlvo do WhatsApp) agiriam numa empresa e a trava
        // filtraria por outra.
        contaId: efetiva.id,
        contaNome: efetiva.nome,
        contaOrigemId: user.contaId,
        contaOrigemNome: user.conta.nome,
        assumida,
        plataforma: user.plataforma,
        // O papel é o da conta de ORIGEM, de propósito: visitar uma empresa não
        // promove ninguém, e quem é restrito em casa continua restrito lá
        // dentro. As chaves são globais (`Permissao` está em MODELS_GLOBAIS),
        // então valem em qualquer conta.
        permissoes: user.papel?.permissoes ?? [],
        // Visitando, o escopo por transportadora não pode valer: os ids
        // vinculados são da conta de origem, e `filtroEscopo` com ids de outra
        // empresa devolve zero linhas — uma tela vazia que parece bug de dados.
        escopo:
          assumida || user.acessoGlobal
            ? null
            : { transportadoraIds: user.transportadoras.map((t) => t.transportadoraId) },
      };
    }

    if (payload.kind === "IDENTIDADE") {
      const identidade = await comoSistema(() =>
        this.prisma.motoristaIdentidade.findUnique({
          where: { id: payload.sub },
          select: { id: true, nome: true, cpf: true, ativo: true },
        }),
      );
      if (!identidade || !identidade.ativo) throw new UnauthorizedException("Cadastro inativo");
      // NÃO chama definirConta: a pessoa não pertence a empresa nenhuma. O
      // contexto fica vazio e a trava recusa qualquer leitura de dado de
      // negócio — que é o certo, e sai de graça. Só as rotas `m/eu/*`
      // (perfil, convites, registros pessoais) funcionam com este token.
      return { kind: "IDENTIDADE", id: identidade.id, nome: identidade.nome, cpf: identidade.cpf };
    }

    const motorista = await comoSistema(() =>
      this.prisma.motorista.findUnique({
        where: { id: payload.sub },
        include: { conta: { select: { ativa: true } } },
      }),
    );
    if (!motorista || !motorista.ativo) throw new UnauthorizedException("Motorista inativo");
    if (!motorista.conta.ativa) throw new UnauthorizedException("Empresa desativada");
    // Recusar o convite (ou ter o vínculo desfeito) tem que valer NA HORA, e não
    // quando o access token expirar: quem não aceitou não opera pela empresa.
    if (!vinculoVivo(motorista)) {
      throw new UnauthorizedException("Esse vínculo com a empresa não está ativo");
    }

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
