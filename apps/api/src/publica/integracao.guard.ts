import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { escopoCabeEm, type EscopoIntegracao } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { comConta, comoSistema, definirConta } from "../common/conta/conta-context";
import { estadoDaConta } from "../common/conta/estado-da-conta";
import { modulosDaConta, tetoDaConta } from "../common/conta/teto-da-conta";
import { CachePorConta } from "../common/conta/cache-por-conta";
import { ContadorJanela } from "../common/rate-limit/contador-janela";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { rotaSemIds } from "../common/chamadas-externas/registro";
import { formatoDeChaveValido, hashDaChave } from "./chave";
import { ErroPublico } from "./erros";

/**
 * Quem está do outro lado na `/v1`: o sistema de uma empresa, por uma chave.
 *
 * NÃO mora em `req.user`, de propósito (mesmo motivo do portal da obra): os
 * guards globais do painel e do app não enxergam isto como usuário, e um
 * service do painel não recebe um "admin de mentirinha" com todas as
 * permissões. Tudo o que a chave pode, este guard cobra sozinho.
 */
export type AuthIntegracao = {
  kind: "INTEGRACAO";
  integracaoId: string;
  chaveId: string;
  nome: string;
  /** Dono dos números externos que esta integração grava. */
  sistema: string;
  contaId: string;
  /** Já podados pelo teto da conta (módulo cancelado tira daqui na hora). */
  escopos: EscopoIntegracao[];
};

type RequestComIntegracao = Request & { integracao?: AuthIntegracao };

export const ESCOPO_KEY = "publica:escopo";
/** O escopo que a rota exige. `null` = só precisa ser uma chave válida (ex.: /v1/eu). */
export const RequerEscopo = (escopo: EscopoIntegracao | null) => SetMetadata(ESCOPO_KEY, escopo);

// ---- limites (docs/api-publica/03-seguranca.md §5.1) ----
const LIMITE_LEITURA_POR_CHAVE = 120;
const LIMITE_ESCRITA_POR_CHAVE = 60;
const LIMITE_POR_CONTA = 600;
/** Chave inválida por IP: com 256 bits isto não protege de adivinhação — protege o banco. */
const LIMITE_FALHAS_POR_IP = 20;
const GRAVAR_USO_A_CADA_MS = 60_000;

const leituras = new ContadorJanela();
const escritas = new ContadorJanela();
const porConta = new ContadorJanela();
const falhasPorIp = new ContadorJanela();

const ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Porteiro da `/v1`. Fechado por padrão, nesta ordem:
 *  formato da chave (sem banco) → chave existe e está viva → empresa pode
 *  entrar → pode escrever (se for escrita) → módulo Integrações contratado →
 *  escopo da rota cabe no que a chave tem E no teto da conta → limites.
 *
 * A empresa vem SÓ da chave: nada de cabeçalho de conta, parâmetro ou corpo.
 * A consulta da chave não tem cache: revogar vale no próximo pedido. Só o teto
 * e os módulos usam os 15 s de cache, a mesma régua do `ModuloGuard`.
 */
@Injectable()
export class IntegracaoGuard implements CanActivate {
  private readonly log = new Logger(IntegracaoGuard.name);
  private readonly cacheModulos = new CachePorConta<Set<string>>("modulos-integracao", 15_000);
  private readonly cacheTeto = new CachePorConta<Set<string>>("teto-integracao", 15_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestComIntegracao>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = ipDaRequisicao(req);

    const chave = chaveDoCabecalho(req);
    if (!chave || !formatoDeChaveValido(chave)) throw this.falhaDeAutenticacao(ip, "NAO_AUTENTICADO");

    const achada = await comoSistema(() =>
      this.prisma.chaveIntegracao.findUnique({
        where: { hash: hashDaChave(chave) },
        select: {
          id: true,
          revogadaEm: true,
          ultimoUsoEm: true,
          integracao: {
            select: { id: true, nome: true, sistema: true, escopos: true, revogadaEm: true, contaId: true },
          },
          conta: { select: { ativa: true, somenteLeitura: true, trialExpiraEm: true, motivoBloqueio: true } },
        },
      }),
    );
    if (!achada) throw this.falhaDeAutenticacao(ip, "NAO_AUTENTICADO");
    if (achada.revogadaEm || achada.integracao.revogadaEm) throw new ErroPublico("CHAVE_REVOGADA");

    const { integracao } = achada;
    const contaId = integracao.contaId;
    // Daqui pra frente a trava filtra tudo pela empresa da chave.
    definirConta(contaId);
    this.registrarUsoAoTerminar(req, res, integracao.id, contaId, ip);

    const estado = estadoDaConta(achada.conta);
    if (!estado.podeEntrar) throw new ErroPublico("EMPRESA_INDISPONIVEL");
    const escrita = ESCRITA.has(req.method);
    if (escrita && !estado.podeEscrever) throw new ErroPublico("CONTA_SOMENTE_LEITURA");

    // Cache vazio quando a leitura falha: NADA contratado, nada permitido.
    const modulos = await this.cacheModulos.obter(
      (id) => modulosDaConta(this.prisma, id) as Promise<Set<string>>,
      new Set(),
    );
    if (!modulos.has("integracoes")) throw new ErroPublico("MODULO_NAO_CONTRATADO");

    const teto = await this.cacheTeto.obter((id) => tetoDaConta(this.prisma, id), new Set());
    const escopos = (integracao.escopos as EscopoIntegracao[]).filter((e) => escopoCabeEm(e, teto));

    const exigido = this.reflector.getAllAndOverride<EscopoIntegracao | null | undefined>(ESCOPO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Rota sem declaração é bug (o boot-check já não deixa subir); recusa.
    if (exigido === undefined) throw new ErroPublico("ESCOPO_INSUFICIENTE");
    if (exigido !== null && !escopos.includes(exigido)) {
      throw new ErroPublico(
        "ESCOPO_INSUFICIENTE",
        `Esta chave não tem o escopo "${exigido}". Quem administra a empresa no Movatruck pode criar uma integração que tenha.`,
      );
    }

    this.cobrarLimites(res, achada.id, contaId, escrita);

    req.integracao = {
      kind: "INTEGRACAO",
      integracaoId: integracao.id,
      chaveId: achada.id,
      nome: integracao.nome,
      sistema: integracao.sistema,
      contaId,
      escopos,
    };

    const agora = Date.now();
    if (!achada.ultimoUsoEm || agora - achada.ultimoUsoEm.getTime() > GRAVAR_USO_A_CADA_MS) {
      // Fire-and-forget: carimbar uso não pode atrasar nem derrubar a chamada.
      void comoSistema(() =>
        this.prisma.chaveIntegracao.updateMany({
          where: { id: achada.id },
          data: { ultimoUsoEm: new Date(agora), ultimoUsoIp: ip },
        }),
      ).catch(() => {});
    }
    return true;
  }

  private falhaDeAutenticacao(ip: string, codigo: "NAO_AUTENTICADO"): ErroPublico {
    if (falhasPorIp.registrar(ip) > LIMITE_FALHAS_POR_IP) {
      return new ErroPublico("LIMITE_EXCEDIDO", undefined, undefined, { "Retry-After": "60" });
    }
    return new ErroPublico(codigo);
  }

  private cobrarLimites(res: Response, chaveId: string, contaId: string, escrita: boolean): void {
    const limite = escrita ? LIMITE_ESCRITA_POR_CHAVE : LIMITE_LEITURA_POR_CHAVE;
    const usados = (escrita ? escritas : leituras).registrar(chaveId);
    const daConta = porConta.registrar(contaId);
    res.setHeader("RateLimit-Limit", String(limite));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limite - usados)));
    res.setHeader("RateLimit-Reset", "60");
    if (usados > limite || daConta > LIMITE_POR_CONTA) {
      throw new ErroPublico("LIMITE_EXCEDIDO", undefined, undefined, { "Retry-After": "60" });
    }
  }

  /**
   * Uso agregado por hora, gravado quando a resposta sai (com o status real).
   * Inclui as recusas depois de achar a chave: "a chave tentou ler o que não
   * podia" também é pergunta de incidente.
   */
  private registrarUsoAoTerminar(req: Request, res: Response, integracaoId: string, contaId: string, ip: string) {
    const metodo = req.method;
    // O número do outro sistema também vira marcador: senão cada viagem viraria uma linha.
    const caminho = ((req.originalUrl ?? req.url).split("?")[0] ?? "").replace(/\/externo\/[^/]+/g, "/externo/:externo");
    const rota = rotaSemIds(metodo, caminho).replace(/^\S+ /, "");
    res.once("finish", () => {
      const hora = new Date();
      hora.setUTCMinutes(0, 0, 0);
      const codigo = (res.locals as { codigoErroPublico?: string }).codigoErroPublico ?? null;
      void comConta(contaId, () =>
        this.prisma.usoIntegracao.upsert({
          where: {
            integracaoId_hora_metodo_rota_status: { integracaoId, hora, metodo, rota, status: res.statusCode },
          },
          create: { integracaoId, hora, metodo, rota, status: res.statusCode, total: 1, ultimoIp: ip, ultimoCodigo: codigo },
          update: { total: { increment: 1 }, ultimoIp: ip, ultimoCodigo: codigo, ultimoEm: new Date() },
        }),
      ).catch((err: Error) => this.log.warn(`uso da integração ${integracaoId} não gravado: ${err.message}`));
    });
  }
}

/** Só `Authorization: Bearer mvt_…`. Nunca query string nem cookie. */
function chaveDoCabecalho(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t.length > 0 && t.length < 100 ? t : null;
}

/** A integração autenticada pelo `IntegracaoGuard`. */
export const IntegracaoAtual = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthIntegracao => {
  const req = ctx.switchToHttp().getRequest<RequestComIntegracao>();
  // Sem o guard na frente é bug de código: recusa em vez de seguir sem saber quem é.
  if (!req.integracao) throw new ErroPublico("NAO_AUTENTICADO");
  return req.integracao;
});
