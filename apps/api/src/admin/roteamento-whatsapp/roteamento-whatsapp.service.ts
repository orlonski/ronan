import { Injectable } from "@nestjs/common";
import {
  CHAVES_ROTA_WHATSAPP,
  provedorAtendeRota,
  ROTAS_WHATSAPP,
  type AtualizarRoteamentoWhatsappInput,
  type ProvedorWhatsapp,
} from "@ronan/shared-types";
import { contaIdAtual } from "../../common/conta/conta-context";
import { inicioDoDiaData } from "../../common/timezone";
import { PrismaService } from "../../prisma/prisma.service";
import { RoteamentoWhatsappService as Roteador } from "../../whatsapp/envio/roteamento.service";

@Injectable()
export class AdminRoteamentoWhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roteador: Roteador,
  ) {}

  /**
   * O que a tela mostra: o catálogo inteiro com o provedor de cada rota, pra o
   * painel não precisar saber qual é o padrão do código.
   */
  async pegar() {
    const cfg = await this.prisma.configuracaoRoteamentoWhatsapp.upsert({
      where: { contaId: contaIdAtual() },
      create: {},
      update: {},
    });
    const escolhas = (cfg.rotas as Record<string, ProvedorWhatsapp> | null) ?? {};

    return {
      telefonesTeste: cfg.telefonesTeste,
      alteradoEm: cfg.alteradoEm,
      rotas: ROTAS_WHATSAPP.map((r) => ({
        chave: r.chave,
        rotulo: r.rotulo,
        descricao: r.descricao,
        categoria: r.categoria,
        critica: r.critica,
        /** Provedores que esta rota aceita — o painel desabilita o resto. */
        provedores: r.provedores,
        /** O que está valendo. */
        provedor: escolhas[r.chave] ?? "evolution",
        /** Se veio de escolha explícita ou do padrão do código. */
        explicito: !!escolhas[r.chave],
      })),
    };
  }

  async salvar(input: AtualizarRoteamentoWhatsappInput, userId: string) {
    const atual = await this.prisma.configuracaoRoteamentoWhatsapp.upsert({
      where: { contaId: contaIdAtual() },
      create: {},
      update: {},
    });

    const data: { rotas?: Record<string, ProvedorWhatsapp>; telefonesTeste?: string[] } = {};

    if (input.rotas) {
      const anterior = (atual.rotas as Record<string, ProvedorWhatsapp> | null) ?? {};
      const merged = { ...anterior, ...input.rotas };
      // Só entra chave que existe no catálogo e provedor que a rota aceita —
      // senão dava pra gravar "aviso de grupo pela Meta" por API, que a Cloud
      // API não consegue entregar.
      data.rotas = Object.fromEntries(
        Object.entries(merged).filter(
          ([chave, prov]) =>
            (CHAVES_ROTA_WHATSAPP as string[]).includes(chave) && provedorAtendeRota(chave, prov),
        ),
      ) as Record<string, ProvedorWhatsapp>;
    }
    if (input.telefonesTeste) data.telefonesTeste = input.telefonesTeste;

    const salvo = await this.prisma.configuracaoRoteamentoWhatsapp.update({
      where: { contaId: contaIdAtual() },
      data: { ...data, alteradoPorId: userId },
    });
    // Sem isto a mudança só valeria depois do cache de 30s — e quem acabou de
    // virar uma rota vai testar na hora.
    this.roteador.invalidar(contaIdAtual());
    return { ...(await this.pegar()), alteradoEm: salvo.alteradoEm };
  }

  /**
   * Quanto esta empresa mandou (e custou) por tipo de mensagem, nos últimos N
   * dias.
   *
   * Só olha SAIDA: o inbound é do motorista e não custa. O custo é a ESTIMATIVA
   * congelada no envio — a conta que vale é a da Meta, e enquanto tudo sai pelo
   * Evolution ela é zero de propósito.
   */
  async consumo(dias = 30) {
    const desde = new Date(inicioDoDiaData().getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
    const linhas = await this.prisma.whatsappMensagem.groupBy({
      by: ["rota", "provedor"],
      where: { direcao: "SAIDA", criadoEm: { gte: desde } },
      _count: { _all: true },
      _sum: { custoEstimado: true },
    });

    const porRota = linhas.map((l) => ({
      rota: l.rota,
      provedor: l.provedor,
      mensagens: l._count._all,
      custoEstimado: Number(l._sum.custoEstimado ?? 0),
    }));

    return {
      dias,
      desde,
      total: porRota.reduce((a, l) => a + l.mensagens, 0),
      custoEstimado: porRota.reduce((a, l) => a + l.custoEstimado, 0),
      porRota: porRota.sort((a, b) => b.mensagens - a.mensagens),
    };
  }
}

