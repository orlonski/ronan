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
   * Segunda de manhã: pede a leva da semana.
   *
   * Cedo o bastante pra dar a semana inteira de folga entre produzir e
   * publicar — se o agente errar, sobra tempo de alguém ver antes do primeiro
   * post sair.
   */
  @Cron("0 0 8 * * 1", { name: "pauta-instagram", timeZone: "America/Sao_Paulo" })
  async pedirLevaSemanal(): Promise<void> {
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

      // UMA demanda por post, não uma demanda com N posts.
      //
      // A primeira versão pedia a leva inteira de uma vez e estourou o teto de
      // 15 minutos do runner sem entregar nada: escrever três peças e rodar o
      // QA — que lê meio repositório — não cabe numa execução. Além de caber no
      // tempo, assim uma peça que falha não leva as outras junto.
      const pedidos: string[] = [];
      for (let i = 0; i < faltam; i++) {
        const taskId = `ig-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
        const r = await this.fila.enfileirar({
          taskId,
          payload: {
            titulo: `Instagram: produzir 1 post (${i + 1} de ${faltam})`,
            descricao: this.briefing(i, faltam),
            origem: "painel",
            criadoPorNome: "Pauta automática",
          },
        });
        if (r.aceito) pedidos.push(taskId);
      }

      if (pedidos.length === 0) {
        return { pedido: false, motivo: "a fila do agente recusou as demandas" };
      }
      this.logger.log(`Pauta pedida: ${pedidos.length} execução(ões) — ${pedidos.join(", ")}`);
      return {
        pedido: true,
        motivo: `abri ${pedidos.length} execução(ões), uma por post — o agente faz uma de cada vez`,
      };
    });
  }

  /**
   * O briefing que o agente recebe.
   *
   * Autocontido de propósito: ele começa sem contexto nenhum da conversa que
   * criou isto. Aponta pra skill em vez de repetir as regras, porque a skill é
   * onde elas são mantidas — repetir aqui garante que as duas cópias divirjam.
   *
   * Curto de propósito, também: a execução tem teto de 15 minutos, e a primeira
   * versão pedia leitura de inventário, três peças e duas rodadas de QA. Não
   * entregou nada. Aqui o pedido é UMA peça, com o caminho mais curto até ela.
   */
  private briefing(indice: number, total: number): string {
    const base = (this.appConfig.get<string>("MARKETING_API_URL") ?? "http://ronan-api:3000").trim();
    // Um dia por post, a partir de amanhã, às 9h de Brasília. Espaçar é o que
    // separa um feed de uma enxurrada — e foi enxurrada que derrubou a conta
    // numa verificação anti-bot.
    const quando = new Date();
    quando.setDate(quando.getDate() + 1 + indice);
    const dia = quando.toISOString().slice(0, 10);

    return [
      `Produza UM post para o Instagram do @movatruck (este é o ${indice + 1} de ${total}) e entregue na fila.`,
      "",
      "Você tem 15 minutos de execução. Vá direto ao ponto: um post só, bem feito.",
      "",
      "Leia primeiro `.claude/skills/post-instagram/SKILL.md` — ela tem o fluxo, a voz e as",
      "armadilhas já pagas. A regra que manda em tudo: **nada vai pro ar sem existir no código**.",
      "Se não achar a evidência no repositório, troque a afirmação; não suavize a frase.",
      "",
      "1. Abra `marketing/instagram/legendas.md` e veja os assuntos já publicados. Escolha um",
      "   ângulo NOVO, e alterne o público em relação aos últimos (dono de transportadora x",
      "   motorista). Vale muito um post de princípio ou bastidor — engaja mais que lista de",
      "   recurso.",
      "2. Confirme no código que o que você vai afirmar existe mesmo. Cite o arquivo no commit.",
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
      "6. Commite a peça e a legenda. Não mexa em `apps/`.",
      "",
      "Se sobrar tempo depois de entregar, rode o agente `ig-qa` sobre o que você fez e conserte",
      "o que ele apontar. Se não sobrar, tudo bem: o post entra como agendado e uma pessoa revisa",
      "antes de sair — nada vai pro ar direto.",
      "",
      "`MARKETING_INGEST_TOKEN` já está no ambiente. Não imprima, não escreva em arquivo, não",
      "comite. E não tente publicar por conta própria nem mexer na configuração do publicador.",
    ].join("\n");
  }
}
