import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { EvolutionClientService } from "../whatsapp/evolution-client.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { inicioDoDiaData, ymdSaoPaulo } from "../common/timezone";
import { paraCadaConta } from "../common/conta/para-cada-conta";
import { comoSistema } from "../common/conta/conta-context";

/**
 * Resumo diário do dia PARA O MOTORISTA no WhatsApp (só os dados dele). Espelha
 * o resumo dos admins, mas curtinho e no tom de parceiro — o destinatário é
 * caçambeiro apressado. Cron 20h (Brasília); só envia pra quem teve movimento ou
 * tem pendência. Gateado por telefone + aceitaWhatsapp + receberResumoDiario.
 * Best-effort: um erro num motorista não derruba os outros.
 */

const DIA_MS = 86_400_000;
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** 1.234 — inteiro com separador de milhar pt-BR. */
function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 1.234,5 — 1 casa decimal, separadores pt-BR (toneladas). */
function fmtTon(n: number): string {
  const [int, dec] = (Math.round(n * 10) / 10).toFixed(1).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/** "1 viagem" vs "4 viagens" — evita o "1 viagens" errado. */
function plural(n: number, sing: string, plur: string): string {
  return `${fmt(n)} ${n === 1 ? sing : plur}`;
}

type ResumoDados = {
  viagensHoje: number;
  toneladas: number;
  km: number;
  aguardandoPeso: number;
  divergente: number;
  viagensMes: number;
};

@Injectable()
export class ResumoMotoristaService {
  private readonly log = new Logger("ResumoMotoristaService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClientService,
  ) {}

  /** Todo dia às 20:00 de Brasília. */
  @Cron("0 0 20 * * *", { name: "resumo-motorista", timeZone: "America/Sao_Paulo" })
  async enviarDiario(): Promise<void> {
    // Mensagem por motorista com os números dele — roda dentro da conta dele.
    await paraCadaConta(this.prisma, () => this.enviarDiarioDaVez());
  }

  private async enviarDiarioDaVez(): Promise<void> {
    if (!this.evolution.configurado) return;
    const motoristas = await this.prisma.motorista.findMany({
      where: {
        ativo: true,
        status: "APROVADO",
        aceitaWhatsapp: true,
        receberResumoDiario: true,
        telefone: { not: null },
      },
      select: { id: true, cpf: true, telefone: true, conta: { select: { nome: true } } },
    });

    for (const m of motoristas) {
      try {
        const dados = await this.coletar(m.id);
        // Não incomoda em dia parado: só envia se teve viagem ou tem pendência.
        if (dados.viagensHoje === 0 && dados.aguardandoPeso === 0 && dados.divergente === 0) {
          continue;
        }
        // Quem roda pra mais de uma empresa recebe um resumo de cada — mas só
        // das que ele TRABALHOU hoje (o gate acima), e com o nome na frente. É a
        // exceção consciente à regra de "só a empresa ativa": segurar o resumo
        // da outra sumiria com pendência de peso que é dele e ele precisa
        // resolver. Push, esse sim, só chega da empresa que está com o aparelho.
        const empresa = await this.nomeSeMultiEmpresa(m.cpf, m.conta.nome);
        await this.enviarWhatsapp(m.telefone, this.montar(dados, empresa));
      } catch (err) {
        this.log.warn(`resumo do motorista ${m.id} falhou: ${(err as Error).message}`);
      }
    }
  }

  /** O nome da empresa, só se o CPF tiver cadastro em mais de uma. */
  private async nomeSeMultiEmpresa(cpf: string, nome: string): Promise<string | null> {
    const quantos = await comoSistema(() =>
      this.prisma.motorista.count({ where: { cpf, ativo: true } }),
    );
    return quantos > 1 ? nome : null;
  }

  /**
   * Disparo manual (botão "Enviar resumo agora" no painel). Sempre monta e envia
   * (ignora o gate de "sem movimento"), mas exige telefone + opt-in + Evolution.
   * Deixa o erro de envio propagar pra o botão mostrar a falha.
   */
  async enviarAgora(motoristaId: string): Promise<{ enviado: boolean; motivo?: string }> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, telefone: true, aceitaWhatsapp: true, receberResumoDiario: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    if (!this.evolution.configurado) {
      return { enviado: false, motivo: "WhatsApp (Evolution) não está configurado." };
    }
    if (!m.telefone) return { enviado: false, motivo: "Motorista sem telefone cadastrado." };
    if (m.aceitaWhatsapp === false) {
      return { enviado: false, motivo: "Motorista desativou as mensagens no WhatsApp." };
    }
    if (m.receberResumoDiario === false) {
      return { enviado: false, motivo: "Motorista desativou o resumo diário." };
    }

    const dados = await this.coletar(m.id);
    await this.enviarWhatsapp(m.telefone, this.montar(dados));
    return { enviado: true };
  }

  private async coletar(motoristaId: string): Promise<ResumoDados> {
    const hoje00 = inicioDoDiaData();
    const amanha00 = new Date(hoje00.getTime() + DIA_MS);
    const [y, mes] = ymdSaoPaulo();
    const mesInicio = new Date(Date.UTC(y, mes - 1, 1));

    const doDia = { motoristaId, data: { gte: hoje00, lt: amanha00 } };
    const [viagensHoje, agg, aguardandoPeso, divergente, viagensMes] = await Promise.all([
      // data != null exclui EM_ANDAMENTO (rascunho aberto, sem data ainda).
      this.prisma.viagem.count({ where: doDia }),
      this.prisma.viagem.aggregate({ _sum: { toneladas: true, km: true }, where: doDia }),
      this.prisma.viagem.count({ where: { motoristaId, status: "AGUARDANDO_PESO" } }),
      this.prisma.viagem.count({ where: { motoristaId, status: "DIVERGENTE" } }),
      this.prisma.viagem.count({
        where: { motoristaId, data: { gte: mesInicio, lt: amanha00 } },
      }),
    ]);

    return {
      viagensHoje,
      toneladas: agg._sum.toneladas ? Number(agg._sum.toneladas) : 0,
      km: agg._sum.km ? Number(agg._sum.km) : 0,
      aguardandoPeso,
      divergente,
      viagensMes,
    };
  }

  private montar(d: ResumoDados, empresa?: string | null): string {
    const [y, m, dia] = ymdSaoPaulo();
    const ds = DIAS_SEMANA[new Date(Date.UTC(y, m - 1, dia)).getUTCDay()];
    const dataBr = `${String(dia).padStart(2, "0")}/${String(m).padStart(2, "0")}`;

    const linhas: string[] = [
      // O nome da empresa só entra pra quem roda pra mais de uma: sem ele, duas
      // mensagens iguais às 20h e o motorista sem saber qual é qual. Pra quem
      // tem uma empresa só, a mensagem fica idêntica à de sempre.
      empresa ? `🚛 *Seu dia na ${empresa}* — ${ds}, ${dataBr}` : `🚛 *Seu dia* — ${ds}, ${dataBr}`,
      "",
      "Hoje você fez:",
      `• ${plural(d.viagensHoje, "viagem", "viagens")}`,
      `• ${fmtTon(d.toneladas)} t carregadas`,
      `• ${fmt(Math.round(d.km))} km rodados`,
      "",
    ];

    if (d.aguardandoPeso > 0 || d.divergente > 0) {
      linhas.push("⚠️ *Falta resolver:*");
      if (d.aguardandoPeso > 0) {
        linhas.push(`• ${plural(d.aguardandoPeso, "viagem", "viagens")} sem o peso → manda o romaneio`);
      }
      if (d.divergente > 0) {
        linhas.push(`• ${plural(d.divergente, "viagem", "viagens")} com problema → confere no app`);
      }
    } else {
      linhas.push("✅ Tá tudo certo, nada pendente.");
    }

    linhas.push("", `No mês: ${plural(d.viagensMes, "viagem", "viagens")}`, "Bom descanso! 💪");
    return linhas.join("\n");
  }

  private async enviarWhatsapp(telefone: string | null | undefined, texto: string): Promise<void> {
    if (!telefone || !this.evolution.configurado) return;
    // Evolution exige DDI 55; o telefone do motorista vem só com DDD.
    const numero = SessaoService.normalizar(telefone);
    await this.evolution.enviarTexto(numero, texto);
  }
}
