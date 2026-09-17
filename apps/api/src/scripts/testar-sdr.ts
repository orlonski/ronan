/**
 * Conversa com o SDR pelo terminal, sem WhatsApp e sem queimar prospect.
 *
 *   pnpm testar:sdr "quanto custa?"
 *   pnpm testar:sdr --limpar "oi, vi o site de voces"
 *   pnpm testar:sdr --bateria     # o caminho feliz
 *   pnpm testar:sdr --dificil     # desconto, prazo, concorrente, opt-out
 *   pnpm testar:sdr --inbound --bateria   # quem chegou sozinho, sem empresa
 *   pnpm testar:sdr --inbound --prompt    # só imprime o prompt, sem chamar IA
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
import { promptSdr } from "../sdr/sdr.prompt";
import { SdrModule } from "../sdr/sdr.module";
import { SdrService } from "../sdr/sdr.service";
import { EMPRESA_A_DESCOBRIR, ORIGEM_INBOUND } from "../sdr/lead-inbound";

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

/** Telefones impossíveis: o lead de teste nunca colide com um real. */
const TELEFONE_TESTE = "5500000000001";
const TELEFONE_INBOUND = "5500000000002";
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
  // Quem chegou sozinho pelo WhatsApp: o SDR não sabe a empresa, nem a cidade,
  // nem o nome. É o caso em que ele mais erra — ou pergunta tudo de uma vez, ou
  // finge conhecer quem nunca viu.
  const inbound = args.includes("--inbound");
  const perguntas = dificil
    ? BATERIA_DIFICIL
    : bateria
      ? BATERIA
      : [args.filter((a) => !a.startsWith("--")).join(" ")];

  if (!bateria && !dificil && !args.includes("--prompt") && !perguntas[0]) {
    console.error(
      'Uso: pnpm testar:sdr "sua pergunta"  |  --bateria  |  --dificil  |  --inbound  |  --limpar',
    );
    process.exit(1);
  }

  // O prompt não depende de chave de API nem de banco: imprimir antes de
  // gastar chamada é o jeito barato de conferir o que o modelo vai ler — e o
  // único disponível quando a chave do provider está fora do ar.
  if (args.includes("--prompt")) {
    console.log(
      promptSdr(
        inbound
          ? { empresa: null, nome: null, municipio: null, uf: null, frotaQtd: null, origem: "WHATSAPP_INBOUND" }
          : {
              empresa: EMPRESA_TESTE,
              nome: "Sérgio",
              municipio: "Ponta Grossa",
              uf: "PR",
              frotaQtd: 12,
              origem: "SITE_FORMULARIO",
            },
      ),
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(HarnessSdrModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const sdr = app.get(SdrService);

  const telefone = inbound ? TELEFONE_INBOUND : TELEFONE_TESTE;
  const lead = await comoSistema(async () => {
    const existente = await prisma.lead.findFirst({ where: { telefone } });
    if (existente) return existente;
    return prisma.lead.create({
      data: inbound
        ? {
            // Igualzinho ao que nasce de uma mensagem no WhatsApp: só o número.
            empresa: EMPRESA_A_DESCOBRIR,
            telefone,
            origem: ORIGEM_INBOUND,
            origemDado: "escreveu no WhatsApp da Movatruck",
            coletadoEm: new Date(),
            status: "EM_CONTATO",
          }
        : {
            empresa: EMPRESA_TESTE,
            nome: "Sérgio",
            telefone,
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
      await prisma.supressaoContato.deleteMany({ where: { contato: telefone } });
      // O `--inbound` descobre a empresa conversando: sem devolver o carimbo,
      // a segunda rodada já começa sabendo o que devia perguntar.
      if (inbound) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { empresa: EMPRESA_A_DESCOBRIR, nome: null, frotaQtd: null },
        });
      }
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
    antes.sdrProvider === "gemini"
      ? antes.sdrModeloGemini
      : antes.sdrProvider === "minimax"
        ? antes.sdrModeloMinimax
        : antes.sdrModeloAnthropic;
  const quem = inbound ? "lead inbound, empresa a descobrir" : `lead ${EMPRESA_TESTE}`;
  console.log(`\x1b[90m(${antes.sdrProvider} · ${modelo} · ${quem})\x1b[0m\n`);

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
