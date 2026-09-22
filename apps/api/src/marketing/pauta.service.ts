import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StatusPostInstagram } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { FilaExecucoesService } from "../clickup-runner/fila.service";
import { RunnerConfig } from "../clickup-runner/runner.config";
import { comoSistema } from "../common/conta/conta-context";
import { InstagramConfig } from "./instagram.config";

/** Peça única ou carrossel. O cron só pede a primeira; carrossel vem de clique. */
export type FormatoPedido = "UNICO" | "CARROSSEL";

/**
 * Quanto tempo um carrossel pede pra si.
 *
 * Post único cabe no padrão do runner (15 min). Carrossel são 5 a 7 telas, cada
 * uma com copy, arte e QA próprio, e a primeira tentativa morreu em
 * EXCEDEU_LIMITE aos 15 — com o briefing prometendo 40, porque o número estava
 * escrito no texto do prompt e não no relógio.
 *
 * O worker limita isto ao `CLICKUP_RUNNER_TIMEOUT_MAX_MS`, então pedir não é
 * mandar: se o teto do servidor for menor, vale o dele — e é por isso que o
 * briefing imprime o número que o worker devolve, nunca este.
 */
const TEMPO_CARROSSEL_MS = 40 * 60_000;

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
    private readonly runner: RunnerConfig,
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
  async pedirLeva(
    quantos: number,
    opcoes: { formato?: FormatoPedido; forcar?: boolean } = {},
  ): Promise<{ pedido: boolean; motivo: string }> {
    const formato = opcoes.formato ?? "UNICO";
    return comoSistema(async () => {
      const naFila = await this.prisma.postInstagram.count({
        where: { status: { in: [StatusPostInstagram.AGENDADO, StatusPostInstagram.RASCUNHO] } },
      });
      // A fila cheia segura o cron, não quem clica: o botão é alguém olhando a
      // fila e pedindo assim mesmo.
      if (naFila >= quantos && !opcoes.forcar) {
        const motivo = `já há ${naFila} post(s) esperando; não vou pedir mais`;
        this.logger.log(motivo);
        return { pedido: false, motivo };
      }

      const faltam = Math.max(1, quantos - naFila);

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
      const carrossel = formato === "CARROSSEL";
      // Pede o tempo e pergunta quanto foi concedido: o briefing tem que dizer
      // ao agente o minuto que o relógio realmente vai contar. Prometer 40 e
      // cortar aos 15 é pior que dar 15 — ele planeja pro número errado e morre
      // no meio, com tudo pronto e nada entregue.
      const timeoutMs = carrossel
        ? this.runner.tempoConcedido(TEMPO_CARROSSEL_MS)
        : this.runner.tempoConcedido();
      const taskId = `ig-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
      const r = await this.fila.enfileirar({
        taskId,
        payload: {
          titulo: carrossel ? "Instagram: produzir 1 carrossel" : "Instagram: produzir 1 post",
          descricao: await this.briefing(formato, Math.round(timeoutMs / 60_000)),
          origem: "painel",
          criadoPorNome: opcoes.forcar ? "Pedido pelo painel" : "Pauta automática",
          timeoutMs,
        },
      });
      if (!r.aceito) {
        return { pedido: false, motivo: "a fila do agente recusou a demanda" };
      }
      this.logger.log(
        `Pauta pedida: 1 execução (${taskId}), formato ${formato}; faltam ${faltam} pra encher a fila`,
      );
      const oQue = carrossel ? "1 carrossel" : "1 post";
      return {
        pedido: true,
        motivo:
          faltam > 1 && !carrossel
            ? `pedi ${oQue} ao agente (faltam ${faltam} pra fila encher — peço os outros depois deste entregar)`
            : `pedi ${oQue} ao agente`,
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
  private async briefing(formato: FormatoPedido = "UNICO", minutos = 15): Promise<string> {
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

    const carrossel = formato === "CARROSSEL";

    return [
      carrossel
        ? "Produza UM CARROSSEL para o Instagram do @movatruck e entregue na fila."
        : "Produza UM post para o Instagram do @movatruck e entregue na fila.",
      "",
      carrossel
        ? [
            `Você tem ${minutos} minutos de execução — é o teto real do worker, não uma estimativa.`,
            "Passou disso, a execução é interrompida e NADA do que você fez é entregue.",
            "É mais que o post único porque são 5 a 7 telas, e porque o QA aqui NÃO é opcional:",
            "carrossel erra em sete lugares em vez de um.",
            "",
            "Entregue ANTES de refinar. Um carrossel na fila vale mais que um perfeito que",
            "morreu no relógio — dá pra melhorar depois, com a peça já salva.",
          ].join("\n")
        : `Você tem ${minutos} minutos de execução. Vá direto ao ponto: um post só, bem feito.`,
      "",
      "Leia primeiro `.claude/skills/post-instagram/SKILL.md` — ela tem o fluxo, a voz e as",
      "armadilhas já pagas. A regra que manda em tudo: **nada vai pro ar sem existir no código**.",
      "Se não achar a evidência no repositório, troque a afirmação; não suavize a frase.",
      "",
      "**Depois leia `marketing/instagram/dores.md`, e comece por lá.** O post nasce de uma",
      "DOR do seguidor, nunca de uma funcionalidade nossa. Quem rola o feed não quer saber o",
      "que o nosso app faz — está com um problema. Abra com o problema dele; a funcionalidade",
      "entra depois, como resposta.",
      "",
      "Post que abre com \"No Movatruck você pode X\" é catálogo, e o `ig-qa` bloqueia.",
      "",
      ocupadas.length > 0
        ? `JÁ EXISTEM na fila ou publicados (NÃO repita o assunto nem o nome): ${ocupadas.join(", ")}.`
        : "A fila está vazia.",
      "Leia também `marketing/instagram/legendas.md` pros assuntos das primeiras levas.",
      "",
      "1. Escolha UMA dor nova do `dores.md`, alternando o público em relação aos últimos",
      "   (dono de transportadora x motorista). O `ig-estrategista` tem WebSearch: se nenhuma",
      "   dor do arquivo servir, pesquise uma de verdade no setor e acrescente lá com a fonte.",
      "2. Confirme no código que a RESPOSTA que você vai dar pra essa dor existe mesmo.",
      carrossel
        ? [
            "3. Escreva a peça em `marketing/instagram/posts/NN-slug.html` com 5 a 7 elementos",
            "   `<div class=\"peca\">` no MESMO arquivo — um por tela, na ordem em que se desliza.",
            "   Cada `.peca` vira um slide; o render cuida do resto. Use as variáveis do `base.css`",
            "   e nunca hardcode cor.",
            "",
            "   Carrossel não é post único fatiado. A forma que funciona:",
            "     • slide 1 — A DOR, na boca dele. É a capa, é o que decide se alguém desliza.",
            "       Não é a promessa do produto nem um índice do que vem: é o problema.",
            "     • slides do meio — UM passo do mecanismo por tela, na ordem em que acontece.",
            "       Se dois passos cabem numa tela, eram um passo só.",
            "     • último slide — o que fazer agora. Um CTA, não três.",
            "   Cada slide tem que fazer sentido sozinho: muita gente entra pelo slide 4.",
            "",
            "   **Encha a tela.** O render reprova buraco vertical acima de 380px, e o primeiro",
            "   carrossel produzido aqui reprovou nos seis slides: título no topo e metade de",
            "   baixo no vácuo. Traga o exemplo concreto, o número, o antes-e-depois. Se um",
            "   slide não tem o que mostrar, o assunto cabia em menos slides.",
          ].join("\n")
        : [
            "3. Escreva a peça em `marketing/instagram/posts/NN-slug.html`, copiando a estrutura de uma",
            "   peça existente e usando as variáveis do `base.css`. Nunca hardcode cor.",
          ].join("\n"),
      "4. Escreva a legenda num arquivo `.txt` (gancho na primeira linha, 8 a 12 hashtags).",
      carrossel
        ? "5. Rode o agente `ig-qa` ANTES de entregar e conserte o que ele apontar. Não pule."
        : "5. Entregue:",
      carrossel ? "6. Entregue:" : "",
      "",
      "```bash",
      // UM comando, começando com `node`, da raiz do repositório.
      //
      // Não é estilo: a allowlist do agente é `Bash(node *)`, e comando com `cd`
      // antes ou `VAR=x` na frente para pedindo aprovação que ninguém está lá
      // pra dar. Foi assim que um carrossel ficou pronto, revisado e commitado
      // sem nunca chegar na fila.
      `node marketing/instagram/enfileirar.mjs <peca> marketing/instagram/posts/<peca>.txt ${dia}T09:00:00-03:00 --api=${base}`,
      "```",
      carrossel
        ? [
            "",
            "O `enfileirar.mjs` manda todos os slides sozinho — ele lê quantas `.peca` a peça tem.",
            "Confira na resposta da API que `slides` bate com o número de telas que você escreveu:",
            "se vier 1, você escreveu um post único achando que era carrossel.",
          ].join("\n")
        : "",
      "",
      "Se a API recusar dizendo que a peça já está na fila, escolha OUTRO assunto e refaça —",
      "não insista no mesmo.",
      "",
      carrossel ? "7. Commite a peça e a legenda. Não mexa em `apps/`." : "6. Commite a peça e a legenda. Não mexa em `apps/`.",
      "",
      carrossel
        ? ""
        : "Se sobrar tempo depois de entregar, rode o agente `ig-qa` sobre o que você fez e conserte\no que ele apontar.",
      "",
      "`MARKETING_INGEST_TOKEN` já está no ambiente. Não imprima, não escreva em arquivo, não",
      "comite. E não tente publicar por conta própria nem mexer na configuração do publicador.",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
}
