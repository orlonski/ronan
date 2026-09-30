/**
 * Manda ler de novo as viagens que o robô parou em "Em conferência".
 *
 *   cd apps/api && pnpm reler:em-conferencia                  # só mostra (padrão)
 *   cd apps/api && pnpm reler:em-conferencia -- --aplicar     # enfileira de verdade
 *   cd apps/api && pnpm reler:em-conferencia -- --conta schaba --limite 200
 *
 * Dentro do container (Easypanel), sem pnpm nem ts-node, as flags vão direto:
 *
 *   cd /repo/apps/api && node dist/scripts/reler-em-conferencia.js
 *   cd /repo/apps/api && node dist/scripts/reler-em-conferencia.js --aplicar
 *
 * Existe porque a régua mudou em 29/09/2026: qualquer campo que a IA afirma não
 * conferir passa a divergir, e dúvida em nome de obra/material não esconde mais
 * peso ou ticket errado. As viagens paradas antes disso continuam paradas —
 * este script é o "Mandar reler" do painel em lote.
 *
 * **Gasta IA**, ao contrário do `aprovar:retroativo`: relê a foto do zero,
 * porque a leitura guardada é só a da primeira passada e a segunda (que
 * confirma antes de avisar o motorista) não fica gravada. O custo por viagem é
 * uma leitura, mais a segunda nas que divergirem. A simulação mostra quantas
 * são antes de gastar.
 *
 * Não precisa rodar devagar: o worker respeita o teto de segundas leituras por
 * hora e adia a divergência que ficaria sem confirmação, sem gastar tentativa.
 *
 * Só toca no que o próprio robô parou: status EM_CONFERENCIA (que só ele
 * escreve), sem decisão humana (`revisadoEm`), fora de fechamento e com foto.
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

/** Só o necessário: subir o AppModule ligaria o worker e os crons aqui dentro. */
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

async function main() {
  const aplicar = tem("--aplicar");
  const contaSlug = arg("--conta");
  const limite = Number(arg("--limite") ?? 1000);

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: false });
  const prisma = app.get(PrismaService);
  const fila = app.get(ConferenciaFilaService);

  const contas = await comoSistema(() =>
    prisma.conta.findMany({
      where: {
        ...(contaSlug ? { slug: contaSlug } : { ativa: true }),
        // A torneira da plataforma: conta sem conferência liberada não relê.
        iaConferenciaTicket: true,
      },
      select: { id: true, nome: true, slug: true },
      orderBy: { criadaEm: "asc" },
    }),
  );

  if (!aplicar) console.log("MODO SIMULAÇÃO — nada será enfileirado. Use --aplicar pra valer.\n");

  let total = 0;
  let enfileiradas = 0;

  for (const conta of contas) {
    await comConta(conta.id, async () => {
      const viagens = await prisma.viagem.findMany({
        where: {
          status: StatusViagem.EM_CONFERENCIA,
          revisadoEm: null,
          fotos: { some: {} },
          matchesFechamento: { none: {} },
          // Já tem leitura na fila ou rodando: não duplica.
          conferenciasTicket: { none: { viagemAtiva: { not: null } } },
        },
        orderBy: { sincronizadoEm: "desc" },
        take: limite,
        select: { id: true },
      });
      if (viagens.length === 0) return;

      total += viagens.length;
      console.log(`── ${conta.nome} (${conta.slug}): ${viagens.length} viagem(ns) em conferência`);
      if (!aplicar) return;

      let n = 0;
      for (const v of viagens) {
        const antes = await prisma.conferenciaTicket.count({ where: { viagemId: v.id } });
        await fila.enfileirar(v.id, "reconferencia");
        const depois = await prisma.conferenciaTicket.count({ where: { viagemId: v.id } });
        if (depois > antes) n++;
      }
      enfileiradas += n;
      console.log(`   ✓ ${n} enfileirada(s)`);
    });
  }

  console.log(
    total === 0
      ? "\nNenhuma viagem parada em conferência — nada a fazer."
      : aplicar
        ? `\nPronto: ${enfileiradas} de ${total} na fila. O worker lê no ritmo dele.`
        : `\n${total} viagem(ns) seriam relidas. Rode com --aplicar pra valer.`,
  );

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
