import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StatusPostInstagram } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { FilaExecucoesService } from "../clickup-runner/fila.service";
import { comoSistema } from "../common/conta/conta-context";
import { InstagramConfig } from "./instagram.config";

/**
 * A pauta: manda o `ronan_agente` produzir a próxima leva de posts.
 *
 * É o elo que faltava entre a squad e o publicador. Uma vez por semana este
 * cron abre uma demanda na mesma fila que o agente já consome, com o briefing
 * inteiro dentro — e o agente, que roda Claude Code com o repositório, executa
 * a skill `post-instagram` e entrega o resultado pela ingestão.
 *
 * Não gera post nenhum sozinho: só pede. Quem escreve é o agente, quem publica
 * é o publicador, e entre os dois continua havendo uma fila que dá pra olhar e
 * cancelar.
 */
@Injectable()
export class PautaService {
  private readonly logger = new Logger(PautaService.name);

  constructor(
    private readonly config: InstagramConfig,
    private readonly prisma: PrismaService,
    private readonly fila: FilaExecucoesService,
    private readonly appConfig: ConfigService,
  ) {}

  /**
   * Todo dia de manhã: repõe a fila.
   *
   * Às 7h de propósito, antes do horário em que os posts saem (9h): o que o
   * agente produzir hoje só é publicado amanhã, o que dá um dia inteiro de
   * folga pra alguém olhar e cancelar.
   *
   * Não pede um por dia cegamente — pede o que falta pra fila chegar em
   * `postsPorLeva`. Dia em que ninguém consumiu a fila, não gasta execução.
   */
  @Cron("0 0 7 * * *", { name: "pauta-instagram", timeZone: "America/Sao_Paulo" })
  async pedirLevaDoDia(): Promise<void> {
    if (!this.config.pautaAutomatica) return;
    await this.pedirLeva(this.config.postsPorLeva);
  }

  /**
   * Abre a demanda. Devolve o que foi pedido, pra quem chamou poder contar.
   *
   * Antes de pedir, olha quantos posts já estão esperando: se a fila não
   * esvaziou, pedir mais é empilhar trabalho que ninguém consumiu — e o custo
   * de cada leva é uma execução do agente, que gasta tokens de verdade.
   */
  async pedirLeva(quantos: number): Promise<{ pedido: boolean; motivo: string }> {
    return comoSistema(async () => {
      const naFila = await this.prisma.postInstagram.count({
        where: { status: { in: [StatusPostInstagram.AGENDADO, StatusPostInstagram.RASCUNHO] } },
      });
      if (naFila >= quantos) {
        const motivo = `já há ${naFila} post(s) esperando; não vou pedir mais`;
        this.logger.log(motivo);
        return { pedido: false, motivo };
      }

      const faltam = quantos - naFila;

      // UMA demanda por vez, não `faltam` demandas de uma vez.
      //
      // Duas versões erradas antes desta. A primeira pedia a leva inteira numa
      // execução e estourou o teto de 15 minutos sem entregar nada. A segunda
      // abria N execuções em paralelo — e elas não se enxergam: cada agente
      // escolheu o mesmo ângulo, e a mesma peça entrou duas vezes na fila, no
      // mesmo horário.
      //
      // Agora é uma de cada vez. Quando essa entregar, a próxima chamada da
      // pauta vê o post novo na fila e o agente seguinte escolhe outro assunto.
      // Mais lento, e é o preço de não repetir post no feed.
      const taskId = `ig-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
      const r = await this.fila.enfileirar({
        taskId,
        payload: {
          titulo: "Instagram: produzir 1 post",
          descricao: await this.briefing(),
          origem: "painel",
          criadoPorNome: "Pauta automática",
        },
      });
      if (!r.aceito) {
        return { pedido: false, motivo: "a fila do agente recusou a demanda" };
      }
      this.logger.log(`Pauta pedida: 1 execução (${taskId}); faltam ${faltam} pra encher a fila`);
      return {
        pedido: true,
        motivo:
          faltam > 1
            ? `pedi 1 post ao agente (faltam ${faltam} pra fila encher — peço os outros depois deste entregar)`
            : "pedi 1 post ao agente",
      };
    });
  }

  /**
   * O briefing que o agente recebe.
   *
   * Autocontido: ele começa sem contexto nenhum. Aponta pra skill em vez de
   * repetir as regras, e leva junto a lista do que JÁ existe — sem isso o
   * agente reescreve um assunto que já está na fila, que foi o que aconteceu.
   */
  private async briefing(): Promise<string> {
    const base = (this.appConfig.get<string>("MARKETING_API_URL") ?? "http://ronan-api:3000").trim();

    // O que já foi feito ou está esperando. É a única forma do agente não
    // repetir: ele não enxerga as outras execuções, só o estado da fila.
    const existentes = await this.prisma.postInstagram.findMany({
      where: {
        status: {
          in: [
            StatusPostInstagram.RASCUNHO,
            StatusPostInstagram.AGENDADO,
            StatusPostInstagram.PUBLICANDO,
            StatusPostInstagram.PUBLICADO,
          ],
        },
      },
      select: { peca: true, publicarEm: true },
      orderBy: { criadoEm: "desc" },
      take: 30,
    });
    const ocupadas = existentes.map((p) => p.peca);

    // Primeiro dia livre depois do último agendado — um post por dia, às 9h.
    const ultimo = existentes
      .map((p) => p.publicarEm)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const alvo = new Date(Math.max(Date.now(), ultimo?.getTime() ?? 0));
    alvo.setDate(alvo.getDate() + 1);
    const dia = alvo.toISOString().slice(0, 10);

    return [
      "Produza UM post para o Instagram do @movatruck e entregue na fila.",
      "",
      "Você tem 15 minutos de execução. Vá direto ao ponto: um post só, bem feito.",
      "",
      "Leia primeiro `.claude/skills/post-instagram/SKILL.md` — ela tem o fluxo, a voz e as",
      "armadilhas já pagas. A regra que manda em tudo: **nada vai pro ar sem existir no código**.",
      "Se não achar a evidência no repositório, troque a afirmação; não suavize a frase.",
      "",
      ocupadas.length > 0
        ? `JÁ EXISTEM na fila ou publicados (NÃO repita o assunto nem o nome): ${ocupadas.join(", ")}.`
        : "A fila está vazia.",
      "Leia também `marketing/instagram/legendas.md` pros assuntos das primeiras levas.",
      "",
      "1. Escolha um ângulo NOVO, alternando o público em relação aos últimos (dono de",
      "   transportadora x motorista). Vale muito um post de princípio ou bastidor.",
      "2. Confirme no código que o que você vai afirmar existe mesmo.",
      "3. Escreva a peça em `marketing/instagram/posts/NN-slug.html`, copiando a estrutura de uma",
      "   peça existente e usando as variáveis do `base.css`. Nunca hardcode cor.",
      "4. Escreva a legenda num arquivo `.txt` (gancho na primeira linha, 8 a 12 hashtags).",
      "5. Entregue:",
      "",
      "```bash",
      "cd marketing/instagram",
      `MARKETING_API_URL=${base} node enfileirar.mjs <peca> <arquivo-da-legenda> ${dia}T09:00:00-03:00`,
      "```",
      "",
      "Se a API recusar dizendo que a peça já está na fila, escolha OUTRO assunto e refaça —",
      "não insista no mesmo.",
      "",
      "6. Commite a peça e a legenda. Não mexa em `apps/`.",
      "",
      "Se sobrar tempo depois de entregar, rode o agente `ig-qa` sobre o que você fez e conserte",
      "o que ele apontar.",
      "",
      "`MARKETING_INGEST_TOKEN` já está no ambiente. Não imprima, não escreva em arquivo, não",
      "comite. E não tente publicar por conta própria nem mexer na configuração do publicador.",
    ].join("\n");
  }
}
