import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { comoSistema } from "../common/conta/conta-context";
import { ClienteHttp } from "../common/http/cliente-http";
import { PrismaService } from "../prisma/prisma.service";
import {
  ehCnaeDeGranel,
  ehCnaeDeTransporteDeCarga,
  extrair,
  type RespostaCnpj,
} from "./receita";

/**
 * Preenche o contato que o RNTRC não tem.
 *
 * O registro da ANTT diz quem existe, mas não diz como falar com a pessoa. O
 * telefone, o e-mail, o CNAE e o nome do sócio estão nos dados públicos da
 * Receita, servidos pela BrasilAPI.
 *
 * É serviço público e gratuito mantido pela comunidade: a gente vai devagar de
 * propósito (uma consulta por segundo por padrão) e sempre pelos leads de maior
 * nota primeiro. Enriquecer 24 mil de uma vez seria abusivo e inútil — o
 * gargalo da operação é conversa, não tamanho de lista.
 */

const BRASILAPI_CNPJ = "https://brasilapi.com.br/api/cnpj/v1";

/** Depois de 3 falhas o CNPJ é deixado em paz — insistir não muda o resultado. */
const MAX_TENTATIVAS = 3;

export type ResultadoEnriquecimento = {
  processados: number;
  comTelefone: number;
  comEmail: number;
  naoEncontrados: number;
  falhas: number;
  suprimidosNoCaminho: number;
  duracaoMs: number;
};

@Injectable()
export class EnriquecimentoService {
  private readonly log = new Logger("Enriquecimento");
  private readonly http: ClienteHttp;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.http = new ClienteHttp({
      intervaloMs: Number(this.config.get("ENRIQUECIMENTO_INTERVALO_MS") ?? 1000),
      tentativas: 3,
      timeoutMs: 20_000,
    });
  }

  /**
   * Enriquece os leads sem contato, do melhor pro pior.
   *
   * `limite` existe pra caber numa janela de manutenção: 500 leads a 1/s são
   * ~8 minutos. Chamar de novo continua de onde parou, porque o filtro é
   * "ainda não tem contato".
   */
  async enriquecerPendentes(
    opcoes: { limite?: number; scoreMinimo?: number } = {},
  ): Promise<ResultadoEnriquecimento> {
    const inicio = Date.now();
    const limite = Math.min(Math.max(opcoes.limite ?? 200, 1), 2000);
    const scoreMinimo = opcoes.scoreMinimo ?? 0;

    const pendentes = await comoSistema(async () =>
      this.prisma.lead.findMany({
        where: {
          origem: "PROSPECCAO_ATIVA",
          optOut: false,
          cnpj: { not: null },
          enriquecidoEm: null,
          enriquecimentoTentativas: { lt: MAX_TENTATIVAS },
          score: { gte: scoreMinimo },
        },
        select: { id: true, cnpj: true, empresa: true, score: true, scoreMotivo: true },
        orderBy: [{ score: "desc" }, { registradoEm: "desc" }],
        take: limite,
      }),
    );

    this.log.log(`Enriquecendo ${pendentes.length} lead(s) (score >= ${scoreMinimo})`);

    let comTelefone = 0;
    let comEmail = 0;
    let naoEncontrados = 0;
    let falhas = 0;
    let suprimidosNoCaminho = 0;

    for (const lead of pendentes) {
      const cnpj = (lead.cnpj ?? "").replace(/\D/g, "");
      if (cnpj.length !== 14) {
        await this.marcarFalha(lead.id, "CNPJ fora do formato");
        falhas++;
        continue;
      }

      try {
        const resposta = await this.http.obterJson<RespostaCnpj>(`${BRASILAPI_CNPJ}/${cnpj}`);

        if (!resposta) {
          naoEncontrados++;
          await this.marcarFalha(lead.id, "CNPJ não encontrado na Receita");
          continue;
        }

        const dados = extrair(resposta);

        // Quem já pediu pra sair não vira contato ativo, mesmo que o telefone
        // chegue agora pela Receita. A supressão é consultada AQUI, no momento
        // em que o contato entra na base — não na hora de enviar, que é tarde.
        const suprimido = await this.contatoSuprimido(dados.telefone, dados.email);
        if (suprimido) suprimidosNoCaminho++;

        const ajuste = this.ajustePorCnae(dados.cnae, lead.score ?? 50, lead.scoreMotivo ?? "");

        await comoSistema(async () =>
          this.prisma.lead.update({
            where: { id: lead.id },
            data: {
              nomeFantasia: dados.nomeFantasia,
              telefone: dados.telefone,
              email: dados.email,
              cnae: dados.cnae,
              cnaeDescricao: dados.cnaeDescricao,
              porte: dados.porte,
              capitalSocial: dados.capitalSocial,
              situacaoCadastral: dados.situacaoCadastral,
              socio: dados.socio,
              enriquecidoEm: new Date(),
              enriquecimentoErro: null,
              score: ajuste.score,
              scoreMotivo: ajuste.motivo,
              ...(suprimido ? { optOut: true, optOutEm: new Date() } : {}),
            },
          }),
        );

        if (dados.telefone) comTelefone++;
        if (dados.email) comEmail++;
      } catch (erro) {
        falhas++;
        await this.marcarFalha(lead.id, (erro as Error).message.slice(0, 200));
      }
    }

    const resultado: ResultadoEnriquecimento = {
      processados: pendentes.length,
      comTelefone,
      comEmail,
      naoEncontrados,
      falhas,
      suprimidosNoCaminho,
      duracaoMs: Date.now() - inicio,
    };

    this.log.log(
      `Enriquecimento: ${comTelefone} com telefone, ${comEmail} com e-mail, ` +
        `${naoEncontrados} não encontrados, ${falhas} falhas em ` +
        `${Math.round(resultado.duracaoMs / 1000)}s`,
    );

    return resultado;
  }

  /**
   * O CNAE corrige o palpite feito pela razão social.
   *
   * A heurística de nome acerta muito, mas erra nos dois sentidos:
   * "COMERCIO DE ALIMENTOS LTDA" com RNTRC pode ser frota própria, e
   * "SEIDEL LTDA" pode ser transportadora sem dizer no nome. O CNAE é a
   * resposta da Receita, e vale mais que o palpite.
   */
  private ajustePorCnae(
    cnae: string | null,
    scoreAtual: number,
    motivoAtual: string,
  ): { score: number; motivo: string } {
    if (!cnae) return { score: scoreAtual, motivo: motivoAtual };

    if (ehCnaeDeTransporteDeCarga(cnae)) {
      return {
        score: Math.min(100, scoreAtual + 15),
        motivo: `${motivoAtual}; CNAE confirma transporte rodoviário de carga`,
      };
    }

    if (ehCnaeDeGranel(cnae)) {
      return {
        score: Math.min(100, scoreAtual + 10),
        motivo: `${motivoAtual}; CNAE de extração/obra — move granel próprio`,
      };
    }

    return {
      score: Math.max(0, scoreAtual - 20),
      motivo: `${motivoAtual}; CNAE não é de transporte nem de granel — frota própria de outro ramo`,
    };
  }

  private async contatoSuprimido(
    telefone: string | null,
    email: string | null,
  ): Promise<boolean> {
    const chaves = [telefone, email].filter((c): c is string => !!c);
    if (chaves.length === 0) return false;

    const achado = await comoSistema(async () =>
      this.prisma.supressaoContato.findFirst({ where: { contato: { in: chaves } } }),
    );
    return achado !== null;
  }

  /**
   * Falha NÃO grava `enriquecidoEm` — assim o lead continua na fila. O contador
   * é o que evita o loop infinito no CNPJ que a Receita nunca vai conhecer.
   */
  private async marcarFalha(id: string, erro: string): Promise<void> {
    await comoSistema(async () =>
      this.prisma.lead.update({
        where: { id },
        data: {
          enriquecimentoTentativas: { increment: 1 },
          enriquecimentoErro: erro,
        },
      }),
    );
  }
}
