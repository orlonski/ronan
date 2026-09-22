import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { comoSistema, definirConta } from "../../common/conta/conta-context";
import { vinculoVivo } from "../../common/vinculo";
import { PrismaService } from "../../prisma/prisma.service";
import { resolverContaEfetiva } from "../conta-efetiva";
import { estadoDaConta } from "../../common/conta/estado-da-conta";
import type { AuthUser, JwtPayload } from "../types";
import type { Request } from "express";

/** O que a regra de estado precisa saber da empresa, num lugar só. */
const SELECT_ESTADO = {
  id: true,
  nome: true,
  ativa: true,
  somenteLeitura: true,
  trialExpiraEm: true,
  motivoBloqueio: true,
} as const;

/** O `x-conta-id` da requisição, se veio e tem cara de id. */
function cabecalhoContaId(req: Request): string | null {
  const v = req.headers["x-conta-id"];
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly log = new Logger(JwtStrategy.name);

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
      // Pra ler o `x-conta-id` (qual empregador) no token da pessoa.
      passReqToCallback: true,
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
  async validate(req: Request, payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== "access") throw new UnauthorizedException("Token inválido");

    if (payload.kind === "ADMIN_USER") {
      const user = await comoSistema(() =>
        this.prisma.user.findUnique({
          where: { id: payload.sub },
          include: {
            conta: { select: SELECT_ESTADO },
            // A empresa que ele está visitando, se estiver. Vem no mesmo
            // findUnique pra não custar uma query por requisição.
            contaAtiva: { select: SELECT_ESTADO },
            papel: { select: { permissoes: true } },
            // Escopo entra no mesmo findUnique: sem query extra por request, e a
            // revogação continua imediata (nada disso vive no token).
            transportadoras: { select: { transportadoraId: true } },
          },
        }),
      );
      if (!user || !user.ativo) throw new UnauthorizedException("Usuário inativo");

      // Quem manda nesta requisição: a empresa visitada, se houver uma válida.
      // A regra mora em `conta-efetiva.ts`, separada e testada — é ela que
      // decide o isolamento entre empresas.
      const { conta: efetiva, assumida } = resolverContaEfetiva(user);

      // O estado é o da conta EFETIVA: visitando um cliente suspenso, o operador
      // da plataforma também não escreve nada lá dentro.
      const estado = estadoDaConta(efetiva);
      if (!estado.podeEntrar) {
        throw new UnauthorizedException({ code: estado.codigo, message: estado.motivo });
      }

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
        // Somente leitura viaja no usuário pra o guard não precisar de query
        // própria: o estado já veio no mesmo findUnique da autenticação.
        contaSomenteLeitura: !estado.podeEscrever,
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

      // É FUNCIONÁRIO REGISTRADO de alguma empresa?
      //
      // A promoção acontece na leitura do token, não na emissão: contratar
      // alguém liga o acesso no próximo request, e desligar corta na hora,
      // sem esperar o access token (15min) expirar.
      //
      // ⚠️ Isto é o que permite MECÂNICO e GENTE DE ESCRITÓRIO baterem ponto
      // sem virarem cadastro de `Motorista` — que é o vínculo de parceiro
      // autônomo. Sem este ramo, a empresa teria que cadastrar o funcionário
      // CLT como parceiro pra ele conseguir entrar no app, e a separação
      // entre os módulos viraria decoração.
      //
      // ⚠️ A busca é por CPF em TODAS as contas (não há tenant no contexto de
      // um token de identidade), então ela pode achar mais de um vínculo: a
      // mesma pessoa registrada em duas empresas que usam a plataforma. Sem
      // ordem explícita, quem ganhava era a ordem que o Postgres devolvesse —
      // que muda depois de um UPDATE na linha. Isso carimbaria a batida de
      // ponto no EMPREGADOR ERRADO, de forma intermitente e invisível.
      //
      // Desempate: o vínculo mais recente. Empregador não se descobre por
      // sorteio, e admissão mais nova é o palpite certo quando a pessoa trocou
      // de emprego e a empresa antiga esqueceu de desligar.
      //
      // E NÃO se recusa o acesso quando há dois: o registro de jornada nunca é
      // bloqueado por dúvida nossa (ver `ponto.controller.ts`). Escolhe-se o
      // mais recente e registra-se o aviso pra alguém desfazer o empate.
      //
      // ⚠️ `x-conta-id`: o app diz DE QUAL empregador é a batida (o que ele
      // guardou do perfil). Não precisa validar contra "as contas dele": a
      // busca já é pelo CPF da pessoa, então só acha vínculo DELA. E pedida uma
      // conta onde ela não é funcionária, NÃO se cai pra outra: carimbar a
      // batida no empregador errado é o defeito que o desempate acima evita.
      const contaPedida = cabecalhoContaId(req);
      const funcionarios = await comoSistema(() =>
        this.prisma.funcionario.findMany({
          where: {
            cpf: identidade.cpf.replace(/\D/g, ""),
            ativo: true,
            ...(contaPedida ? { contaId: contaPedida } : {}),
          },
          select: { id: true, contaId: true, conta: { select: SELECT_ESTADO } },
          orderBy: [{ admitidoEm: "desc" }, { criadoEm: "desc" }, { id: "asc" }],
          take: 2,
        }),
      );
      if (funcionarios.length > 1) {
        this.log.warn(
          `CPF com vínculo de emprego ativo em mais de uma conta ` +
            `(identidade ${identidade.id}). Usando o mais recente: conta ${funcionarios[0].contaId}.`,
        );
      }
      const funcionario = funcionarios[0] ?? null;
      if (funcionario) {
        const estadoFunc = estadoDaConta(funcionario.conta);
        if (estadoFunc.podeEntrar) {
          definirConta(funcionario.contaId);
          return {
            kind: "FUNCIONARIO",
            id: identidade.id,
            nome: identidade.nome,
            cpf: identidade.cpf,
            funcionarioId: funcionario.id,
            contaId: funcionario.contaId,
            contaSomenteLeitura: !estadoFunc.podeEscrever,
          };
        }
        // Conta suspensa não derruba a pessoa pra fora do app: ela continua
        // como identidade e segue com o que é dela. O ponto é que some — e
        // isso é conversa da empresa com a gente, não dela com o app.
      }

      // NÃO chama definirConta: a pessoa não pertence a empresa nenhuma. O
      // contexto fica vazio e a trava recusa qualquer leitura de dado de
      // negócio — que é o certo, e sai de graça. Só as rotas `m/eu/*`
      // (perfil, convites, registros pessoais) funcionam com este token.
      return { kind: "IDENTIDADE", id: identidade.id, nome: identidade.nome, cpf: identidade.cpf };
    }

    const motorista = await comoSistema(() =>
      this.prisma.motorista.findUnique({
        where: { id: payload.sub },
        include: { conta: { select: SELECT_ESTADO } },
      }),
    );
    if (!motorista || !motorista.ativo) throw new UnauthorizedException("Motorista inativo");
    const estadoMotorista = estadoDaConta(motorista.conta);
    if (!estadoMotorista.podeEntrar) {
      throw new UnauthorizedException({ code: estadoMotorista.codigo, message: estadoMotorista.motivo });
    }
    // Recusar o convite (ou ter o vínculo desfeito) tem que valer NA HORA, e não
    // quando o access token expirar: quem não aceitou não opera pela empresa.
    if (!vinculoVivo(motorista)) {
      throw new UnauthorizedException("Esse vínculo com a empresa não está ativo");
    }

    definirConta(motorista.contaId);

    // Ele também é funcionário registrado desta empresa?
    //
    // ⚠️ Motorista CLT da própria transportadora lança viagem E bate ponto: a
    // exclusividade que `RegimeVigente` garante é entre OBRA E DIÁRIA e
    // PONTO, não entre os dois cadastros. Sem esta busca, quem tem cadastro de
    // motorista nunca alcançaria `/m/ponto/*` — e é justamente ele o caso mais
    // comum de quem compra o módulo.
    const comoFuncionario = await comoSistema(() =>
      this.prisma.funcionario.findFirst({
        where: { contaId: motorista.contaId, cpf: motorista.cpf.replace(/\D/g, ""), ativo: true },
        select: { id: true },
      }),
    );

    return {
      kind: "MOTORISTA",
      id: motorista.id,
      nome: motorista.nome,
      cpf: motorista.cpf,
      status: motorista.status,
      contaId: motorista.contaId,
      contaSomenteLeitura: !estadoMotorista.podeEscrever,
      funcionarioId: comoFuncionario?.id ?? null,
    };
  }
}
