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
      const taskId = `ig-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
      const r = await this.fila.enfileirar({
        taskId,
        payload: {
          titulo: `Instagram: produzir ${faltam} post(s) da semana`,
          descricao: this.briefing(faltam),
          origem: "painel",
          criadoPorNome: "Pauta automática",
        },
      });
      if (!r.aceito) {
        return { pedido: false, motivo: "a fila do agente recusou a demanda" };
      }
      this.logger.log(`Pauta pedida: ${faltam} post(s) (${taskId})`);
      return { pedido: true, motivo: `pedidos ${faltam} post(s) ao agente` };
    });
  }

  /**
   * O briefing que o agente recebe.
   *
   * Autocontido de propósito: o agente começa sem contexto nenhum da conversa
   * que criou isto. Aponta pra skill em vez de repetir as regras, porque a
   * skill é onde elas são mantidas — repetir aqui é garantir que as duas cópias
   * divirjam.
   */
  private briefing(quantos: number): string {
    const base = (this.appConfig.get<string>("MARKETING_API_URL") ?? "http://ronan-api:3000").trim();
    return [
      `Produza ${quantos} post(s) novo(s) para o Instagram do @movatruck e entregue na fila de publicação.`,
      "",
      "Siga a skill `post-instagram` (.claude/skills/post-instagram/SKILL.md) do começo ao fim.",
      "Ela tem o fluxo, a voz, as armadilhas já pagas e a regra que manda em tudo:",
      "**nada vai pro ar sem existir no código**. Se não achar a evidência, troque a afirmação —",
      "não suavize a frase.",
      "",
      "Passos, em ordem:",
      "1. Leia `marketing/instagram/legendas.md` para não repetir assunto já publicado.",
      "2. Escolha ângulos novos, alternando os dois públicos (dono de transportadora e motorista).",
      "   Misture funcionalidade com bastidor e princípio — post de princípio engaja mais que",
      "   lista de recurso.",
      "3. Escreva a peça em `marketing/instagram/posts/NN-slug.html`, usando as variáveis do",
      "   `base.css`. Nunca hardcode cor.",
      "4. Rode o QA (`ig-qa`) e corrija o que ele apontar. Rode DUAS vezes: na primeira leva ele",
      "   ainda achou bloqueios na segunda passada.",
      "5. Escreva a legenda num arquivo `.txt`.",
      "6. Entregue cada post:",
      "",
      "```bash",
      "cd marketing/instagram",
      `MARKETING_API_URL=${base} \\`,
      "  node enfileirar.mjs <peca> <arquivo-da-legenda> <quando-iso>",
      "```",
      "",
      "O `MARKETING_INGEST_TOKEN` já está no ambiente — não o imprima, não o escreva em arquivo",
      "nenhum e não o inclua em commit.",
      "",
      "Espace os horários: no máximo um post por dia, entre 8h e 18h de Brasília, começando",
      "amanhã. O teto do publicador é baixo de propósito — dez posts no mesmo dia derrubaram a",
      "conta numa verificação anti-bot.",
      "",
      "O que você entrega NÃO vai pro ar direto: entra numa fila que uma pessoa revisa e pode",
      "cancelar. Não tente publicar por conta própria nem mexer na configuração do publicador.",
      "",
      "Commite as peças e as legendas novas. Não mexa em `apps/`.",
    ].join("\n");
  }
}
