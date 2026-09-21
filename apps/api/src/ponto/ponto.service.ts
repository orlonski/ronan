import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  JANELA_ANTI_DUPLICIDADE_SEG,
  montarComprovantePonto,
  type MarcacaoPontoInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { LancamentosResgatadosService } from "../lancamentos-resgatados/lancamentos-resgatados.service";
import type { AuthFuncionario } from "../auth/types";
import { PontoAdminService } from "./ponto-admin.service";

/**
 * O REGISTRO DE PONTO do funcionário.
 *
 * ⚠️ Este serviço guarda o documento mais sensível do sistema inteiro: a prova
 * de jornada de gente registrada. Três regras que não podem cair numa
 * refatoração:
 *
 * 1. O registro grava INSTANTE e PESSOA. Nada mais. Tipo de marcação, atraso e
 *    saldo são tratamento, em outra tabela (art. 82, IV da Portaria 671).
 * 2. A tabela é APPEND-ONLY, com trigger no banco. Nada de `upsert`,
 *    `updateMany` ou `deleteMany` aqui — a idempotência é `create` → P2002 →
 *    `findUnique`. Um `upsert` vira UPDATE no conflito e explode em runtime.
 * 3. O POST de marcação NUNCA recusa por regra de negócio. Ver `registrar`.
 */
@Injectable()
export class PontoService {
  private readonly log = new Logger(PontoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vala: LancamentosResgatadosService,
  ) {}

  /**
   * Bate o ponto.
   *
   * ⚠️ O ENDPOINT MAIS PROTEGIDO DO SISTEMA — CONTRA NÓS MESMOS. Ele aceita
   * com o cadastro pendente, com a empresa em somente-leitura, com a
   * mensalidade em atraso, fora da escala, em feriado, de madrugada, com o
   * funcionário já desligado. Não tem feature flag, não tem guard de módulo,
   * não tem régua de cobrança.
   *
   * O motivo não é generosidade: recusar produz o pior documento possível
   * numa reclamatória — a prova de que a empresa impediu o registro de
   * sobrejornada. Qualquer restrição que a gente invente aqui vira argumento
   * contra o nosso cliente.
   *
   * O único caso que não dá pra gravar (não existe `Funcionario` pra este
   * CPF: cache velho, cadastro apagado) responde 422 E sobe o payload pra
   * vala de segurança do painel. Nunca 500 — 500 trava o outbox em loop, e o
   * item ficaria batendo pra sempre sem ninguém ver.
   */
  async registrar(
    user: AuthFuncionario,
    input: MarcacaoPontoInput,
    appInfo: { appVersao?: string | null },
  ) {
    const funcionario = await this.prisma.funcionario.findFirst({
      where: { id: user.funcionarioId },
      select: { id: true, nome: true, cpf: true },
    });

    if (!funcionario) {
      await this.vala
        .guardar(
          { id: user.id, nome: user.nome },
          {
            clientId: input.clientId,
            tipo: "ponto",
            payload: input as unknown as Record<string, unknown>,
            erroMensagem: "Sem cadastro de funcionário para este CPF.",
            erroStatus: 422,
          },
          appInfo.appVersao ?? null,
        )
        .catch((e) => this.log.error(`vala falhou: ${(e as Error).message}`));
      throw new UnprocessableEntityException(
        "Seu cadastro de funcionário não está mais ativo nesta empresa. O registro foi guardado e o escritório já está vendo.",
      );
    }

    const marcadoEm = new Date(input.marcadoEm);
    if (Number.isNaN(marcadoEm.getTime())) {
      throw new BadRequestException("Horário inválido.");
    }

    // Idempotência do outbox: o MESMO clientId devolve o MESMO registro.
    const jaTem = await this.prisma.marcacao.findFirst({
      where: { clientId: input.clientId },
    });
    if (jaTem) return this.comComprovante(jaTem, funcionario);

    // Dedupe de toque duplo: comparação de INSTANTES, não de id derivado do
    // horário. Derivar o id do horário tem defeito em três frentes (ver
    // `JANELA_ANTI_DUPLICIDADE_SEG` nos shared-types); comparar instante é o
    // que entrega a janela de 60s que a tela promete.
    const janela = JANELA_ANTI_DUPLICIDADE_SEG * 1000;
    const vizinha = await this.prisma.marcacao.findFirst({
      where: {
        funcionarioId: funcionario.id,
        marcadoEm: {
          gte: new Date(marcadoEm.getTime() - janela),
          lte: new Date(marcadoEm.getTime() + janela),
        },
      },
      orderBy: { marcadoEm: "desc" },
    });
    if (vizinha) return this.comComprovante(vizinha, funcionario);

    const agora = new Date();
    // Desvio REAL de relógio: o aparelho diz que horas são NELE no momento do
    // envio. `recebidoEm - marcadoEm` seria tempo de fila do outbox, que num
    // app offline-first é de horas — e um alerta que dispara sempre é o mesmo
    // que nenhum.
    const desvioRelogioSeg = input.agoraNoAparelho
      ? Math.round((Date.parse(input.agoraNoAparelho) - agora.getTime()) / 1000)
      : null;
    const atrasoEnvioSeg = Math.round((agora.getTime() - marcadoEm.getTime()) / 1000);

    const criada = await this.prisma
      .$transaction(async (tx) => {
        // O número de registro sai de um UPDATE ... RETURNING dentro da mesma
        // transação. `INSERT ... ON CONFLICT` porque depender de seed faria a
        // primeira marcação de uma conta sem semente virar 500 — e 500 trava o
        // outbox em loop. Sequence do Postgres está fora: deixa buraco em
        // rollback, e número com buraco em documento legal é pergunta ruim.
        const linha = await tx.$queryRaw<{ proximo: number }[]>`
          INSERT INTO "ponto_sequencia" ("contaId", "proximo")
          VALUES (${user.contaId}, 2)
          ON CONFLICT ("contaId")
          DO UPDATE SET "proximo" = "ponto_sequencia"."proximo" + 1
          RETURNING "proximo" - 1 AS "proximo"
        `;
        const numeroRegistro = Number(linha[0]?.proximo ?? 1);

        const m = await tx.marcacao.create({
          data: {
            funcionarioId: funcionario.id,
            numeroRegistro,
            marcadoEm,
            dia: input.dia,
            origem: "APP",
            clientId: input.clientId,
            desvioRelogioSeg,
            atrasoEnvioSeg,
            appVersao: input.appVersao ?? appInfo.appVersao ?? null,
            dispositivo: input.dispositivo ?? null,
            repVersao: REP_VERSAO,
          },
        });

        // A coordenada vai pra tabela própria, fora da imutável: é evidência,
        // não dado de jornada, e precisa poder ser expurgada sem tocar no
        // registro. `0` na retenção = a empresa não quer guardar nenhuma.
        if (input.latitude != null && input.longitude != null) {
          const cfg = await tx.configPonto.findFirst({
            select: { diasRetencaoLocalizacao: true },
          });
          if ((cfg?.diasRetencaoLocalizacao ?? 90) > 0) {
            await tx.marcacaoLocalizacao.create({
              data: {
                marcacaoId: m.id,
                latitude: new Prisma.Decimal(input.latitude),
                longitude: new Prisma.Decimal(input.longitude),
                // A coluna é Int e o GPS manda float: arredondar aqui, e não
                // recusar lá, é o que mantém o registro entrando.
                precisao: input.precisao == null ? null : Math.round(input.precisao),
              },
            });
          }
        }
        return m;
      })
      .catch(async (err) => {
        // Corrida do outbox: dois envios do mesmo clientId ao mesmo tempo.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const existente = await this.prisma.marcacao.findFirst({
            where: { clientId: input.clientId },
          });
          if (existente) return existente;
        }
        throw err;
      });

    // Fecha o caso na vala se este clientId já tinha caído lá antes.
    void this.vala.marcarQueSubiu(input.clientId).catch(() => {});
    return this.comComprovante(criada, funcionario);
  }

  /** O que o app mostra depois de bater: o comprovante. */
  private async comComprovante(
    m: { id: string; numeroRegistro: number; marcadoEm: Date; clientId: string; repVersao: string },
    funcionario: { nome: string; cpf: string },
  ) {
    const cfg = await this.prisma.configPonto.findFirst();
    return {
      id: m.id,
      clientId: m.clientId,
      numeroRegistro: m.numeroRegistro,
      marcadoEm: m.marcadoEm.toISOString(),
      comprovante: montarComprovantePonto({
        razaoSocial: cfg?.razaoSocial ?? "",
        cnpj: cfg?.cnpj ?? "",
        identificacaoRep: cfg?.identificacaoRep ?? "Movatruck Ponto",
        repVersao: m.repVersao,
        nome: funcionario.nome,
        cpf: funcionario.cpf,
        marcadoEmISO: m.marcadoEm.toISOString(),
        numeroRegistro: m.numeroRegistro,
      }),
    };
  }

  /**
   * O dia de hoje do funcionário: o que ele já registrou.
   *
   * NÃO diz "você está trabalhando" nem "falta bater a saída": a tela mostra
   * a lista do que foi batido, em ordem, e quem interpreta é ele. Dizer
   * "próxima: saída" seria o app decidindo o tipo da marcação — que é
   * exatamente o que o registro não faz.
   */
  async hoje(user: AuthFuncionario, dia: string) {
    const [funcionario, marcacoes, cfg] = await Promise.all([
      this.prisma.funcionario.findFirst({
        where: { id: user.funcionarioId },
        select: { id: true, nome: true, cpf: true, cargo: true, desligadoEm: true },
      }),
      this.prisma.marcacao.findMany({
        where: { funcionarioId: user.funcionarioId, dia },
        orderBy: { marcadoEm: "asc" },
        select: { id: true, numeroRegistro: true, marcadoEm: true, clientId: true },
      }),
      this.prisma.configPonto.findFirst({ select: { razaoSocial: true } }),
    ]);
    if (!funcionario) return { funcionario: null, dia, marcacoes: [] };

    return {
      funcionario: {
        id: funcionario.id,
        nome: funcionario.nome,
        cargo: funcionario.cargo,
        empresa: cfg?.razaoSocial ?? null,
        desligado: funcionario.desligadoEm != null,
      },
      dia,
      marcacoes: marcacoes.map((m) => ({
        id: m.id,
        clientId: m.clientId,
        numeroRegistro: m.numeroRegistro,
        marcadoEm: m.marcadoEm.toISOString(),
      })),
    };
  }

  /** O que o app pré-baixa pra funcionar offline: motivos de correção e config. */
  async catalogo() {
    const [cfg, motivos] = await Promise.all([
      this.prisma.configPonto.findFirst({
        select: {
          razaoSocial: true,
          cnpj: true,
          identificacaoRep: true,
          avisoLgpdTexto: true,
          diasRetencaoLocalizacao: true,
        },
      }),
      this.prisma.motivoCorrecaoPonto.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: "asc" }, { descricao: "asc" }],
        select: { codigo: true, descricao: true, exigeAnexo: true },
      }),
    ]);
    /**
     * ⚠️ `capturaLocalizacao` é o INTERRUPTOR, e ele vive aqui porque quem
     * tem que parar de coletar é o aparelho.
     *
     * Antes, o app sempre pedia o GPS e sempre mandava lat/lon; a API é que
     * decidia não gravar quando a retenção era 0. Resultado: a empresa que
     * escolheu não guardar nenhuma localização tinha a coordenada do
     * empregado na fila do celular dele e trafegando na rede assim mesmo.
     * "Não guardamos" não é a mesma promessa que "não coletamos", e o painel
     * dizia a segunda.
     */
    return {
      empresa: cfg
        ? {
            razaoSocial: cfg.razaoSocial,
            cnpj: cfg.cnpj,
            identificacaoRep: cfg.identificacaoRep,
            avisoLgpdTexto: cfg.avisoLgpdTexto,
          }
        : null,
      capturaLocalizacao: (cfg?.diasRetencaoLocalizacao ?? 0) > 0,
      motivos,
    };
  }

  /**
   * O espelho do mês, pra ELE conferir.
   *
   * ⚠️ Continua acessível depois do desligamento, por N meses (configurável).
   * Negar a leitura do próprio dado a quem saiu não protege ninguém e cria
   * uma conversa desnecessária exatamente na semana da rescisão — que é
   * quando ele mais precisa do documento.
   */
  async meuEspelho(user: AuthFuncionario, competencia: string, admin: PontoAdminService) {
    await this.exigirAcessoDeLeitura(user);
    return admin.espelho(user.funcionarioId, competencia);
  }

  /**
   * Ele pede a correção. Pede, não decide: a decisão é do gestor, com autor e
   * data — e o motivo escrito é obrigatório dos dois lados.
   */
  async pedirCorrecao(
    user: AuthFuncionario,
    dados: {
      clientId?: string;
      dia: string;
      tipo: "INCLUSAO" | "DESCONSIDERACAO" | "ANOTACAO";
      marcacaoId?: string;
      instantePretendido?: string;
      motivoCodigo: string;
      motivo: string;
    },
  ) {
    await this.exigirVinculoAtivo(user);

    if (dados.clientId) {
      const ja = await this.prisma.correcaoPonto.findFirst({ where: { clientId: dados.clientId } });
      if (ja) return ja;
    }

    return this.prisma.correcaoPonto.create({
      data: {
        funcionarioId: user.funcionarioId,
        dia: dados.dia,
        tipo: dados.tipo,
        marcacaoId: dados.marcacaoId ?? null,
        instantePretendido: dados.instantePretendido ? new Date(dados.instantePretendido) : null,
        motivoCodigo: dados.motivoCodigo,
        motivo: dados.motivo,
        pedidoPor: "FUNCIONARIO",
        pedidoPorFuncionarioId: user.funcionarioId,
        status: "PENDENTE",
        clientId: dados.clientId ?? null,
      },
    });
  }

  /**
   * Cancela um pedido DELE que ainda não foi decidido.
   *
   * ⚠️ Pedido pendente NÃO é registro: ninguém decidiu nada, e o registro
   * original segue intocado. Digitar 07:30 quando queria 17:30 e não ter como
   * desfazer obrigaria a mandar um segundo pedido — e aí os DOIS aparecem,
   * pro escritório e pra ele, o que é pior do que o erro.
   *
   * O que ele NÃO pode cancelar, e o guard cobra:
   * - pedido já decidido (aprovado ou recusado) — aí virou parte do documento;
   * - pedido lançado pelo ESCRITÓRIO em nome dele — aquilo não é dele pra
   *   desfazer; o caminho é dar ciência e, se discordar, pedir correção;
   * - pedido de outra pessoa.
   */
  async cancelarCorrecao(user: AuthFuncionario, correcaoId: string) {
    const c = await this.prisma.correcaoPonto.findFirst({
      where: { id: correcaoId, funcionarioId: user.funcionarioId },
    });
    if (!c) throw new BadRequestException("Pedido não encontrado.");
    if (c.status !== "PENDENTE") {
      throw new BadRequestException(
        "Esse pedido já foi decidido pelo escritório e não dá mais pra cancelar.",
      );
    }
    if (c.pedidoPor !== "FUNCIONARIO") {
      throw new BadRequestException(
        "Esse lançamento foi feito pelo escritório. Se não concorda, peça uma correção.",
      );
    }
    await this.prisma.correcaoPonto.delete({ where: { id: correcaoId } });
    return { cancelado: true };
  }

  /** Ele viu a correção que o escritório lançou em nome dele. */
  async darCiencia(user: AuthFuncionario, correcaoId: string) {
    const c = await this.prisma.correcaoPonto.findFirst({
      where: { id: correcaoId, funcionarioId: user.funcionarioId },
    });
    if (!c) throw new BadRequestException("Correção não encontrada.");
    if (c.cienciaEm) return c;
    return this.prisma.correcaoPonto.update({
      where: { id: correcaoId },
      data: { cienciaEm: new Date() },
    });
  }

  /**
   * A conferência do espelho do mês — o ato de maior valor probatório do
   * módulo inteiro, e o mais barato de construir.
   *
   * ⚠️ DISCORDAR TEM QUE SER POSSÍVEL. Um botão só, escrito "concordo",
   * transforma a ciência em formalidade sem valor: o que sustenta o documento
   * é a pessoa ter tido a opção de dizer que não confere.
   *
   * O `hashEspelho` amarra a ciência AO documento que ela viu. Sem ele,
   * reapurar depois faria a assinatura apontar pra um espelho diferente —
   * mesma doutrina do hash da assinatura de documento.
   */
  async conferirEspelho(
    user: AuthFuncionario,
    dados: { competencia: string; concorda: boolean; observacao?: string; hash: string },
    contexto: { ip?: string; userAgent?: string },
  ) {
    await this.exigirAcessoDeLeitura(user);

    return this.prisma.cienciaEspelho.upsert({
      where: {
        contaId_funcionarioId_competencia: {
          contaId: user.contaId,
          funcionarioId: user.funcionarioId,
          competencia: dados.competencia,
        },
      },
      create: {
        funcionarioId: user.funcionarioId,
        competencia: dados.competencia,
        concorda: dados.concorda,
        observacao: dados.observacao ?? null,
        hashEspelho: dados.hash,
        ip: contexto.ip ?? null,
        userAgent: contexto.userAgent?.slice(0, 500) ?? null,
      },
      // Mudar de ideia é legítimo: conferiu, depois achou o erro. A data nova
      // substitui, e o hash diz sobre qual documento foi.
      update: {
        concorda: dados.concorda,
        observacao: dados.observacao ?? null,
        hashEspelho: dados.hash,
        cienteEm: new Date(),
        ip: contexto.ip ?? null,
        userAgent: contexto.userAgent?.slice(0, 500) ?? null,
      },
    });
  }

  /** Escrever exige vínculo vivo. Ler, não — ver `exigirAcessoDeLeitura`. */
  private async exigirVinculoAtivo(user: AuthFuncionario) {
    const f = await this.prisma.funcionario.findFirst({
      where: { id: user.funcionarioId },
      select: { ativo: true },
    });
    if (!f?.ativo) {
      throw new BadRequestException("Seu cadastro de funcionário não está mais ativo nesta empresa.");
    }
  }

  private async exigirAcessoDeLeitura(user: AuthFuncionario) {
    const [f, cfg] = await Promise.all([
      this.prisma.funcionario.findFirst({
        where: { id: user.funcionarioId },
        select: { desligadoEm: true },
      }),
      this.prisma.configPonto.findFirst({ select: { mesesAcessoAposDesligamento: true } }),
    ]);
    if (!f) throw new BadRequestException("Cadastro não encontrado.");
    if (!f.desligadoEm) return;

    const meses = cfg?.mesesAcessoAposDesligamento ?? 12;
    const limite = new Date(f.desligadoEm);
    limite.setUTCMonth(limite.getUTCMonth() + meses);
    if (new Date() > limite) {
      throw new BadRequestException(
        "O prazo de acesso aos seus registros nesta empresa terminou. Peça os documentos ao escritório.",
      );
    }
  }
}

/**
 * A versão do programa que vai congelada em cada registro.
 *
 * Congelada na linha, e não lida da config na hora de imprimir: o comprovante
 * de março tem que continuar dizendo qual programa gerou ele, mesmo depois de
 * cinco deploys.
 */
export const REP_VERSAO = "1.0";
