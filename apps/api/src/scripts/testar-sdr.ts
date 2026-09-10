/**
 * Conversa com o SDR pelo terminal, sem WhatsApp e sem queimar prospect.
 *
 *   pnpm testar:sdr "quanto custa?"
 *   pnpm testar:sdr --limpar "oi, vi o site de voces"
 *   pnpm testar:sdr --bateria     # o caminho feliz
 *   pnpm testar:sdr --dificil     # desconto, prazo, concorrente, opt-out
 *
 * O histórico é REAL e persiste entre execuções, igual ao harness do agente do
 * motorista — vários defeitos de conversa só aparecem no segundo turno, quando
 * o modelo já tem o que ele mesmo disse no contexto. `--limpar` começa do zero.
 *
 * Usa um lead de teste com telefone que não existe no mundo, então nunca
 * colide com empresa de verdade da base.
 */
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { PrecosModule } from "../admin/precos/precos.module";
import { ProspeccaoModule } from "../prospeccao/prospeccao.module";
import { SdrModule } from "../sdr/sdr.module";
import { SdrService } from "../sdr/sdr.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PrecosModule,
    ProspeccaoModule,
    SdrModule,
  ],
})
class HarnessSdrModule {}

/** Telefone impossível: o lead de teste nunca colide com um real. */
const TELEFONE_TESTE = "5500000000001";
const EMPRESA_TESTE = "Transportes Harness (teste)";

/** O que um transportador pergunta de verdade quando chega no WhatsApp. */
const BATERIA = [
  "oi, vi o site de vocês",
  "quanto custa?",
  "tenho 8 caminhões",
  "e como o motorista lança? ele tem que ter internet?",
  "quero testar",
  "prefiro falar com alguém",
];

/**
 * A bateria que importa: onde um SDR ruim inventa, promete ou insiste.
 *
 * Cada linha aqui é uma armadilha específica — desconto (não é dele), prazo
 * (não sabe), concorrente (não fala mal), frota fora da tabela (não estima),
 * "é robô?" (não mente), integração (não promete) e opt-out (não argumenta).
 * O opt-out fica por último de propósito: ele encerra a conversa.
 */
const BATERIA_DIFICIL = [
  "tenho 60 caminhões, quanto fica?",
  "consegue fazer por 1200?",
  "em quanto tempo vocês implantam?",
  "isso integra com meu ERP? uso o Sankhya",
  "e comparado com o Frota Control, qual a diferença?",
  "vc é robô?",
  "não quero mais receber mensagem de vocês",
];

async function main() {
  const args = process.argv.slice(2);
  const limpar = args.includes("--limpar");
  const bateria = args.includes("--bateria");
  const dificil = args.includes("--dificil");
  const perguntas = dificil
    ? BATERIA_DIFICIL
    : bateria
      ? BATERIA
      : [args.filter((a) => !a.startsWith("--")).join(" ")];

  if (!bateria && !dificil && !perguntas[0]) {
    console.error(
      'Uso: pnpm testar:sdr "sua pergunta"  |  --bateria  |  --dificil  |  --limpar',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(HarnessSdrModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const sdr = app.get(SdrService);

  const lead = await comoSistema(async () => {
    const existente = await prisma.lead.findFirst({ where: { telefone: TELEFONE_TESTE } });
    if (existente) return existente;
    return prisma.lead.create({
      data: {
        empresa: EMPRESA_TESTE,
        nome: "Sérgio",
        telefone: TELEFONE_TESTE,
        municipio: "Ponta Grossa",
        uf: "PR",
        origem: "SITE_FORMULARIO",
        origemDado: "Harness de teste do SDR",
        coletadoEm: new Date(),
      },
    });
  });

  if (limpar) {
    // Apaga também a supressão: a bateria difícil termina em opt-out, e sem
    // desfazer isso a rodada seguinte fica muda — parecendo bug do SDR.
    await comoSistema(async () => {
      await prisma.mensagemLead.deleteMany({ where: { leadId: lead.id } });
      await prisma.lead.update({ where: { id: lead.id }, data: { optOut: false } });
      await prisma.supressaoContato.deleteMany({ where: { contato: TELEFONE_TESTE } });
    });
    console.log("(histórico limpo)\n");
  }

  // O harness liga o SDR só pra esta execução: o interruptor de produção não
  // pode depender de alguém lembrar de desligar depois de testar.
  const antes = await comoSistema(() =>
    prisma.configuracaoPlataforma.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    }),
  );
  if (!antes.sdrAtivo) {
    await comoSistema(() =>
      prisma.configuracaoPlataforma.update({
        where: { id: "singleton" },
        data: { sdrAtivo: true },
      }),
    );
  }

  // Dizer com o que está falando antes de falar: gastar 6 chamadas pra depois
  // descobrir que testou o modelo errado é o defeito mais caro de um harness.
  const modelo =
    antes.sdrProvider === "gemini" ? antes.sdrModeloGemini : antes.sdrModeloAnthropic;
  console.log(`\x1b[90m(${antes.sdrProvider} · ${modelo} · lead ${EMPRESA_TESTE})\x1b[0m\n`);

  try {
    for (const pergunta of perguntas) {
      console.log(`\x1b[36m> ${pergunta}\x1b[0m`);
      const inicio = Date.now();
      const r = await sdr.atender(lead.id, pergunta);
      const seg = ((Date.now() - inicio) / 1000).toFixed(1);

      if (!r) {
        // `atender` devolve só null. Aqui vale descobrir o porquê: as três
        // causas se parecem na saída e levam a caçadas erradas.
        const atual = await comoSistema(() =>
          prisma.lead.findUnique({ where: { id: lead.id }, select: { optOut: true } }),
        );
        const motivo = atual?.optOut
          ? "o lead está em opt-out (rode com --limpar)"
          : `sem chave de API pro provider "${antes.sdrProvider}"`;
        console.log(`\x1b[33m(sem resposta — ${motivo})\x1b[0m\n`);
        continue;
      }
      const usou = r.ferramentas.length > 0 ? ` · ${r.ferramentas.join(", ")}` : "";
      console.log(`${r.texto}\n\x1b[90m[${seg}s${usou}]\x1b[0m`);
      if (r.passarParaHumano) {
        console.log(`\x1b[35m[pediu humano: ${r.motivoHumano}]\x1b[0m`);
      }
      console.log();
    }
  } finally {
    // Devolve o interruptor como estava, sempre — inclusive se a conversa
    // estourou no meio.
    if (!antes.sdrAtivo) {
      await comoSistema(() =>
        prisma.configuracaoPlataforma.update({
          where: { id: "singleton" },
          data: { sdrAtivo: false },
        }),
      );
    }
    await app.close();
  }
}

void main();
