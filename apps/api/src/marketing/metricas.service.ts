import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StatusPostInstagram } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema } from "../common/conta/conta-context";
import { InstagramConfig } from "./instagram.config";
import { MetaClient } from "./meta-client";

/**
 * O que cada publicação rendeu, e quantos seguidores o perfil ganhou por dia.
 *
 * Existe pra escolher formato por número em vez de por opinião. O sinal que mais
 * alcança quem ainda não segue é o COMPARTILHAMENTO (estimado em 3 a 5 vezes o
 * peso de uma curtida) — então é ele que decide o que repetir, não a curtida.
 * Depois vêm tempo assistido e saves; curtida é o mais fraco dos três.
 *
 * (Isso vinha de uma pesquisa em `marketing/reels/PLAYBOOK.md`, removida junto
 * com a esteira de vídeo em 18/09/2026. A conclusão ficou aqui porque é ela que
 * justifica a ordem das métricas abaixo.)
 *
 * Duas limitações da API que moldaram este serviço:
 *
 * 1. **Não existe "seguidores ganhos" por Reel.** Só post de feed tem esse
 *    número. Por isso a atribuição aqui é por DIA: com um post por dia, a
 *    diferença de seguidores entre ontem e hoje é o que aquele post rendeu.
 * 2. **A série diária de `follower_count` só libera com 100+ seguidores.** O
 *    perfil tem 11. Guardamos o total cru uma vez por dia e montamos a série.
 */
@Injectable()
export class MetricasInstagramService {
  private readonly logger = new Logger(MetricasInstagramService.name);

  // Instanciado à mão, não injetado — é o padrão do publicador: o MetaClient
  // não é provider de módulo nenhum, e registrá-lo como tal só pra este serviço
  // criaria duas formas de obter a mesma coisa.
  private readonly meta: MetaClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: InstagramConfig,
  ) {
    this.meta = new MetaClient(config);
  }

  /**
   * Uma leitura por dia, de manhã cedo.
   *
   * Às 6h: depois da virada do dia em São Paulo e antes dos posts das 9h, então
   * o número do dia anterior fecha limpo, sem contar o que ainda vai sair.
   */
  @Cron("0 0 6 * * *", { name: "metricas-instagram", timeZone: "America/Sao_Paulo" })
  async rodar(): Promise<{ seguidores: number | null; postsAtualizados: number }> {
    if (!this.config.habilitado) return { seguidores: null, postsAtualizados: 0 };
    return comoSistema(async () => {
      const seguidores = await this.registrarSeguidores();
      const postsAtualizados = await this.atualizarPostsRecentes();
      return { seguidores, postsAtualizados };
    });
  }

  private async registrarSeguidores(): Promise<number | null> {
    const total = await this.meta.seguidores();
    if (total === null) return null;

    // Meia-noite de São Paulo. O container roda em UTC: ancorar com setHours(0)
    // gravaria o dia errado por três horas (ver common/timezone.ts).
    const agora = new Date();
    const emSp = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    const dia = new Date(Date.UTC(emSp.getUTCFullYear(), emSp.getUTCMonth(), emSp.getUTCDate()));

    await this.prisma.seguidoresInstagram.upsert({
      where: { dia },
      update: { total },
      create: { dia, total },
    });
    this.logger.log(`Seguidores em ${dia.toISOString().slice(0, 10)}: ${total}`);
    return total;
  }

  /**
   * Relê o que os posts recentes renderam.
   *
   * Só os últimos 14 dias: métrica de post velho não muda mais o suficiente pra
   * pagar a chamada, e a janela de 24h da Meta é pra publicação, não pra leitura.
   */
  private async atualizarPostsRecentes(): Promise<number> {
    const desde = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const posts = await this.prisma.postInstagram.findMany({
      where: {
        status: StatusPostInstagram.PUBLICADO,
        mediaId: { not: null },
        publicadoEm: { gte: desde },
      },
      select: { id: true, peca: true, mediaId: true },
    });

    let atualizados = 0;
    for (const post of posts) {
      const m = await this.meta.metricas(post.mediaId as string);
      if (Object.keys(m).length === 0) continue;
      await this.prisma.postInstagram.update({
        where: { id: post.id },
        data: {
          alcance: m.reach ?? null,
          visualizacoes: m.views ?? null,
          salvos: m.saved ?? null,
          compartilhamentos: m.shares ?? null,
          curtidas: m.likes ?? null,
          comentarios: m.comments ?? null,
          metricasEm: new Date(),
        },
      });
      atualizados++;
    }
    if (atualizados) this.logger.log(`Métricas relidas de ${atualizados} post(s)`);
    return atualizados;
  }

  /**
   * A série pro painel: cada dia, quantos seguidores e quanto variou.
   *
   * A variação é a diferença pro dia anterior MEDIDO, não pro dia de calendário
   * anterior — se um dia faltar (deploy, API fora), o pulo aparece no dia
   * seguinte em vez de virar um zero mentiroso.
   */
  async serie(dias = 30): Promise<{ dia: Date; total: number; variacao: number | null }[]> {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const linhas = await comoSistema(() =>
      this.prisma.seguidoresInstagram.findMany({
        where: { dia: { gte: desde } },
        orderBy: { dia: "asc" },
        select: { dia: true, total: true },
      }),
    );
    return linhas.map((l, i) => ({
      ...l,
      variacao: i === 0 ? null : l.total - linhas[i - 1].total,
    }));
  }
}
