import { Injectable } from "@nestjs/common";
import {
  CHAVES_ROTA_WHATSAPP,
  provedorAtendeRota,
  ROTAS_WHATSAPP,
  type AtualizarRoteamentoWhatsappInput,
  type ProvedorWhatsapp,
} from "@ronan/shared-types";
import { contaIdAtual } from "../../common/conta/conta-context";
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
}
