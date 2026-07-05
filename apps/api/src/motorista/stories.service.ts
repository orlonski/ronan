import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CriarStoryInput,
  ReagirStoryInput,
  StoryEmoji,
  StoryFeedGrupo,
  StoryFeedResponse,
  StoryItem,
  StoryVisualizador,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";

const DURACAO_MS = 24 * 60 * 60 * 1000; // 24h

@Injectable()
export class StoriesMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /** Feed de stories ativos (expiraEm > agora) agrupados por autor. */
  async feed(motoristaId: string): Promise<StoryFeedResponse> {
    const agora = new Date();
    const stories = await this.prisma.story.findMany({
      where: { expiraEm: { gt: agora } },
      orderBy: { criadoEm: "asc" }, // dentro do grupo, mais antigo primeiro (IG)
      include: {
        motorista: { select: { id: true, nome: true } },
        visualizacoes: { where: { motoristaId }, select: { id: true } },
        reacoes: { where: { motoristaId }, select: { emoji: true } },
        _count: { select: { visualizacoes: true } },
      },
    });

    const porAutor = new Map<string, StoryFeedGrupo>();
    for (const s of stories) {
      const ehMeu = s.motoristaId === motoristaId;
      const visto = s.visualizacoes.length > 0;
      const item: StoryItem = {
        id: s.id,
        motoristaId: s.motoristaId,
        legenda: s.legenda,
        criadoEm: s.criadoEm.toISOString(),
        expiraEm: s.expiraEm.toISOString(),
        visto,
        minhaReacao: (s.reacoes[0]?.emoji as StoryEmoji) ?? null,
        ...(ehMeu ? { totalVistos: s._count.visualizacoes } : {}),
      };
      let grupo = porAutor.get(s.motoristaId);
      if (!grupo) {
        grupo = {
          autor: { id: s.motorista.id, nome: s.motorista.nome },
          ehMeu,
          temNaoVisto: false,
          ultimoEm: item.criadoEm,
          stories: [],
        };
        porAutor.set(s.motoristaId, grupo);
      }
      grupo.stories.push(item);
      grupo.ultimoEm = item.criadoEm; // stories vêm asc, último sobrescreve
      // Anel colorido só pra story de outro que ainda não vi.
      if (!ehMeu && !visto) grupo.temNaoVisto = true;
    }

    const grupos = [...porAutor.values()].sort((a, b) => {
      if (a.ehMeu !== b.ehMeu) return a.ehMeu ? -1 : 1;
      if (a.temNaoVisto !== b.temNaoVisto) return a.temNaoVisto ? -1 : 1;
      return b.ultimoEm.localeCompare(a.ultimoEm);
    });

    return { grupos };
  }

  async criar(motoristaId: string, input: CriarStoryInput & { fotoKey: string }) {
    const existente = await this.prisma.story.findUnique({
      where: { clientId: input.clientId },
    });
    if (existente) return existente; // idempotência (sync duplicado)

    const agora = new Date();
    return this.prisma.story.create({
      data: {
        clientId: input.clientId,
        motoristaId,
        storageKey: input.fotoKey,
        legenda: input.legenda ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        criadoEm: agora,
        expiraEm: new Date(agora.getTime() + DURACAO_MS),
      },
    });
  }

  /** Foto de um story. Qualquer motorista aprovado vê qualquer story ativo. */
  async fotoBuffer(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { storageKey: true, expiraEm: true },
    });
    if (!story || story.expiraEm <= new Date()) {
      throw new NotFoundException("Story não disponível.");
    }
    const buffer = await this.uploads.getObjectBuffer(story.storageKey);
    const ext = story.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    return { buffer, contentType };
  }

  /** Marca visto (tira o anel). Não registra o autor vendo o próprio story. */
  async marcarVisto(motoristaId: string, storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { motoristaId: true },
    });
    if (!story) throw new NotFoundException("Story não encontrado.");
    if (story.motoristaId === motoristaId) return; // não conta a própria visão
    await this.prisma.storyVisualizacao.upsert({
      where: { storyId_motoristaId: { storyId, motoristaId } },
      create: { storyId, motoristaId },
      update: {},
    });
  }

  async reagir(
    motoristaId: string,
    storyId: string,
    input: ReagirStoryInput,
  ): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true },
    });
    if (!story) throw new NotFoundException("Story não encontrado.");
    await this.prisma.storyReacao.upsert({
      where: { storyId_motoristaId: { storyId, motoristaId } },
      create: { storyId, motoristaId, emoji: input.emoji },
      update: { emoji: input.emoji },
    });
  }

  async removerReacao(motoristaId: string, storyId: string): Promise<void> {
    await this.prisma.storyReacao.deleteMany({ where: { storyId, motoristaId } });
  }

  /** "Visto por N": só o autor do story vê a lista de espectadores + reações. */
  async visualizacoes(
    motoristaId: string,
    storyId: string,
  ): Promise<{ total: number; visualizadores: StoryVisualizador[] }> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { motoristaId: true },
    });
    if (!story) throw new NotFoundException("Story não encontrado.");
    if (story.motoristaId !== motoristaId) {
      throw new ForbiddenException("Só o autor vê quem assistiu.");
    }
    const [vis, reacoes] = await Promise.all([
      this.prisma.storyVisualizacao.findMany({
        where: { storyId },
        orderBy: { vistoEm: "desc" },
        include: { motorista: { select: { id: true, nome: true } } },
      }),
      this.prisma.storyReacao.findMany({
        where: { storyId },
        select: { motoristaId: true, emoji: true },
      }),
    ]);
    const reacaoPor = new Map(reacoes.map((r) => [r.motoristaId, r.emoji]));
    const visualizadores: StoryVisualizador[] = vis.map((v) => ({
      motoristaId: v.motorista.id,
      nome: v.motorista.nome,
      vistoEm: v.vistoEm.toISOString(),
      reacao: (reacaoPor.get(v.motoristaId) as StoryEmoji) ?? null,
    }));
    return { total: visualizadores.length, visualizadores };
  }

  async deletar(motoristaId: string, storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { motoristaId: true, storageKey: true },
    });
    if (!story) throw new NotFoundException("Story não encontrado.");
    if (story.motoristaId !== motoristaId) {
      throw new ForbiddenException("Você só pode apagar seus próprios stories.");
    }
    await this.uploads.removeObject(story.storageKey);
    await this.prisma.story.delete({ where: { id: storyId } });
  }
}
