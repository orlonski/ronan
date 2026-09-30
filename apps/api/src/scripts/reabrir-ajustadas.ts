/**
 * Traz de volta pra mesa as viagens AJUSTADAS que ficaram com a marca de
 * "revisada" de antes, e manda pro agente as que o motorista corrigiu.
 *
 *   cd apps/api && pnpm reabrir:ajustadas -- --conta schaba              # só mostra
 *   cd apps/api && pnpm reabrir:ajustadas -- --conta schaba --aplicar
 *
 * No container: node dist/scripts/reabrir-ajustadas.js --conta schaba [--aplicar]
 *
 * Até 30/09/2026, divergência marcada pelo painel gravava `revisadoEm`, e a
 * resposta do motorista virava AJUSTADA sem limpar: a viagem sumia do card de
 * Pendentes e a conferência automática não pegava (robô não passa por cima de
 * gente). O código novo limpa na resposta; isto conserta as que ficaram antes.
 *
 * Duas levas, por design:
 * - TODAS perdem a marca e voltam a contar nos Pendentes (não gasta nada).
 * - Só as que o motorista CORRIGIU vão pra fila do agente (gasta uma leitura
 *   cada). A que ele só explicou, reler daria a mesma resposta — e o
 *   motorista que disse "o meu está certo" levaria o mesmo aviso de novo.
 *   Quem decide essas é gente.
 *
 * Como se sabe que corrigiu: pela última mensagem DELE no chat da viagem. As
 * respostas gravam "Corrigi …" quando mudam o valor, "Informei o pedágio" ou
 * foto nova; só a justificativa quando não mudam.
 *
 * `--conta` é obrigatório: isto mexe no que aparece na mesa de uma empresa.
 */
try {
  require("dotenv/config");
} catch {
  /* segue com as variáveis do ambiente */
}
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { StatusViagem } from "@prisma/client";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { ConferenciaConfig } from "../conferencia-ticket/conferencia.config";
import { ConferenciaFilaService } from "../conferencia-ticket/conferencia-fila.service";
import { comConta, comoSistema } from "../common/conta/conta-context";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [ConferenciaConfig, ConferenciaFilaService],
})
class ScriptModule {}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const tem = (flag: string) => process.argv.includes(flag);

/** A última resposta do motorista mudou algum valor? */
function corrigiu(msg: { acao: string | null; texto: string } | undefined): boolean {
  if (!msg) return false;
  if (msg.acao === "INFORMOU_PEDAGIO" || msg.acao === "ENVIOU_FOTO") return true;
  return msg.texto.trimStart().startsWith("Corrigi");
}

async function main() {
  const contaSlug = arg("--conta");
  const aplicar = tem("--aplicar");
  if (!contaSlug) {
    console.error("Informe a empresa: --conta <slug> (ex.: --conta schaba).");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: false });
  const prisma = app.get(PrismaService);
  const fila = app.get(ConferenciaFilaService);

  const conta = await comoSistema(() =>
    prisma.conta.findFirst({ where: { slug: contaSlug }, select: { id: true, nome: true } }),
  );
  if (!conta) {
    console.error(`Empresa "${contaSlug}" não encontrada.`);
    process.exit(1);
  }
  if (!aplicar) console.log("MODO SIMULAÇÃO — nada será escrito. Use --aplicar pra valer.\n");

  await comConta(conta.id, async () => {
    const viagens = await prisma.viagem.findMany({
      where: {
        status: StatusViagem.AJUSTADA,
        revisadoEm: { not: null },
        matchesFechamento: { none: {} },
      },
      select: {
        id: true,
        data: true,
        mensagens: {
          where: { autor: "MOTORISTA" },
          orderBy: { criadoEm: "desc" },
          take: 1,
          select: { acao: true, texto: true },
        },
      },
      orderBy: { data: "desc" },
    });

    const paraOAgente = viagens.filter((v) => corrigiu(v.mensagens[0]));
    const soExplicou = viagens.length - paraOAgente.length;

    console.log(`── ${conta.nome}: ${viagens.length} ajustada(s) ainda marcadas como revisadas`);
    console.log(`   ${paraOAgente.length} o motorista corrigiu → voltam pros Pendentes E pro agente`);
    console.log(`   ${soExplicou} só explicaram (ou sem resposta no chat) → voltam pros Pendentes, com gente`);
    if (viagens.length > 0) {
      const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "sem data");
      console.log(`   datas: de ${d(viagens[viagens.length - 1].data)} a ${d(viagens[0].data)}`);
    }
    if (!aplicar || viagens.length === 0) return;

    const r = await prisma.viagem.updateMany({
      where: { id: { in: viagens.map((v) => v.id) }, status: StatusViagem.AJUSTADA },
      data: { revisadoEm: null, revisadoPorId: null },
    });
    let enfileiradas = 0;
    for (const v of paraOAgente) {
      const antes = await prisma.conferenciaTicket.count({ where: { viagemId: v.id } });
      await fila.enfileirar(v.id, "correcao-motorista");
      const depois = await prisma.conferenciaTicket.count({ where: { viagemId: v.id } });
      if (depois > antes) enfileiradas++;
    }
    console.log(`\n   ✓ ${r.count} de volta aos Pendentes · ${enfileiradas} na fila do agente`);
  });

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
