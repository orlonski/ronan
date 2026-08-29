/**
 * Aprova retroativamente as viagens cuja conferência JÁ rodou e deu "confere".
 *
 *   cd apps/api && pnpm aprovar:retroativo                  # só mostra (padrão)
 *   cd apps/api && pnpm aprovar:retroativo -- --aplicar     # escreve de verdade
 *   cd apps/api && pnpm aprovar:retroativo -- --conta schaba --dias 90
 *
 * Dentro do container (Easypanel), onde não existe pnpm nem ts-node, é o mesmo
 * script já compilado — e as flags vão direto, sem o `--`:
 *
 *   cd /repo/apps/api && node dist/scripts/aprovar-conferencias-retroativo.js
 *   cd /repo/apps/api && node dist/scripts/aprovar-conferencias-retroativo.js --aplicar
 *
 * Enquanto a conferência roda em MODO SOMBRA (ou com a aprovação automática
 * desligada), o veredito é gravado e ninguém age: a viagem segue parada no
 * contador "a conferir" mesmo com o documento batendo. Este script pega esse
 * acúmulo — e liga a aprovação automática pra trás, com a régua de hoje.
 *
 * **Não gasta IA nenhuma.** O job guarda o que o motorista declarou, o que foi
 * lido e o julgamento do modelo; a comparação é recalculada aqui do zero, com o
 * código atual. Se a régua mudou desde a leitura, é a régua de agora que vale.
 *
 * E passa pelas MESMAS travas do worker, inclusive a da viagem (km no padrão do
 * trajeto, pedágio da rota lançado e na média) — ver `pre-aprovacao.ts`. O que
 * não seria aprovado hoje não é aprovado aqui.
 *
 * **`--dry-run` é o padrão de propósito.** Isto preenche `revisadoEm`, que faz
 * o FechamentoProcessor parar de sobrescrever o status. Rodar sem olhar antes é
 * a receita de um estrago que só aparece no fechamento do mês.
 *
 * Nunca toca em viagem que já tem decisão humana, que não está mais em
 * ENVIADA/AJUSTADA, ou que já entrou num fechamento.
 */
// O `.env` é coisa de dev; na imagem de produção as variáveis já vêm do
// ambiente e o `dotenv` nem está instalado. Por isso o carregamento é
// tolerante: sem isto o script morre com MODULE_NOT_FOUND justamente onde ele
// mais serve — dentro do container, contra o banco de verdade.
try {
  require("dotenv/config");
} catch {
  /* segue com as variáveis do ambiente */
}
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { StatusViagem, StatusConferenciaTicket } from "@prisma/client";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { KmAtipicoModule } from "../km-atipico/km-atipico.module";
import { PedagiosRodoviaModule } from "../admin/pedagios-rodovia/pedagios-rodovia.module";
import { ConferenciaConfig } from "../conferencia-ticket/conferencia.config";
import { PreAprovacaoService } from "../conferencia-ticket/pre-aprovacao.service";
import {
  conferirComJulgamento,
  type Declarado,
  type JulgamentoIa,
  type Lido,
} from "../common/conferencia-ticket";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { inicioDiasAtras } from "../common/timezone";

/**
 * Só o necessário pra decidir. De propósito NÃO é o AppModule: subir a
 * aplicação inteira ligaria o worker da conferência, os crons e o resto —
 * efeito colateral que um script rodado à mão contra produção não pode ter.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    KmAtipicoModule,
    PedagiosRodoviaModule,
  ],
  providers: [ConferenciaConfig, PreAprovacaoService],
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
  const dias = Number(arg("--dias") ?? 180);

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: false });
  const prisma = app.get(PrismaService);
  const config = app.get(ConferenciaConfig);
  const preAprovacao = app.get(PreAprovacaoService);

  const contas = await comoSistema(() =>
    prisma.conta.findMany({
      where: contaSlug ? { slug: contaSlug } : { ativa: true },
      select: { id: true, nome: true, slug: true },
      orderBy: { criadaEm: "asc" },
    }),
  );

  if (!aplicar) {
    console.log("MODO SIMULAÇÃO — nada será escrito. Use --aplicar pra valer.\n");
  }
  console.log(
    `Régua atual: leitura ≥ ${config.confiancaParaAprovar}, ≥ ${config.minCamposParaAprovar} campos, ` +
      `km no padrão=${config.exigirKmNoPadrao}, pedágio=${config.exigirPedagioCoerente}\n`,
  );

  let totalAprovadas = 0;
  const recusas = new Map<string, number>();

  for (const conta of contas) {
    await comConta(conta.id, async () => {
      const jobs = await prisma.conferenciaTicket.findMany({
        where: {
          status: StatusConferenciaTicket.CONCLUIDA,
          veredito: "BATE",
          // Já agiu (aprovou, avisou, pediu foto) = assunto encerrado.
          aplicadoEm: null,
          criadoEm: { gte: inicioDiasAtras(dias) },
          viagem: {
            status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA] },
            // Decisão humana manda. Sempre.
            revisadoEm: null,
            // Nada que já virou dinheiro é tocado.
            matchesFechamento: { none: {} },
          },
        },
        select: {
          id: true,
          viagemId: true,
          criadoEm: true,
          declarado: true,
          leitura: true,
          confianca: true,
          viagem: {
            select: { data: true, motorista: { select: { nome: true } } },
          },
        },
        // Mais recente primeiro: se a viagem foi conferida duas vezes, vale a
        // última leitura.
        orderBy: { criadoEm: "desc" },
      });

      const porViagem = new Map<string, (typeof jobs)[number]>();
      for (const j of jobs) if (!porViagem.has(j.viagemId)) porViagem.set(j.viagemId, j);

      const aprovaveis: Array<{ job: (typeof jobs)[number]; campos: number; resumo: string[] }> = [];

      for (const job of porViagem.values()) {
        const leitura = (job.leitura ?? {}) as Lido & { julgamento?: JulgamentoIa };
        const declarado = (job.declarado ?? {}) as Declarado;
        const confianca = job.confianca ?? leitura.confianca ?? 0;

        if (confianca < config.confiancaParaAprovar) {
          contarRecusa(recusas, "leitura abaixo do limiar");
          continue;
        }

        // Recomparado com o código de hoje: o veredito gravado pode ter saído
        // de uma régua antiga.
        const r = conferirComJulgamento(declarado, { ...leitura, confianca }, leitura.julgamento ?? {});
        if (r.veredito !== "BATE") {
          contarRecusa(recusas, `recomparado hoje dá ${r.veredito}`);
          continue;
        }
        if (r.conferidos.length < config.minCamposParaAprovar) {
          contarRecusa(recusas, "poucos campos conferidos");
          continue;
        }

        const pre = await preAprovacao.avaliar(job.viagemId);
        if (!pre.aprova) {
          contarRecusa(recusas, pre.motivo ?? "viagem não fecha");
          continue;
        }
        aprovaveis.push({ job, campos: r.conferidos.length, resumo: pre.resumo });
      }

      if (aprovaveis.length === 0) return;
      totalAprovadas += aprovaveis.length;
      console.log(`── ${conta.nome} (${conta.slug}): ${aprovaveis.length} viagem(ns)`);
      for (const { job } of aprovaveis.slice(0, 5)) {
        const dia = job.viagem?.data ? job.viagem.data.toISOString().slice(0, 10) : "sem data";
        console.log(`   ${dia}  ${job.viagem?.motorista?.nome ?? "—"}`);
      }
      if (aprovaveis.length > 5) console.log(`   … e mais ${aprovaveis.length - 5}`);

      if (!aplicar) {
        console.log("");
        return;
      }

      for (const { job, campos, resumo } of aprovaveis) {
        // Uma a uma: cada viagem ganha a sua mensagem no chat, e uma falha
        // isolada não derruba o lote.
        try {
          const agora = new Date();
          const alterou = await prisma.viagem.updateMany({
            // O where repete as travas: entre a listagem e agora alguém pode
            // ter conferido a viagem na tela.
            where: {
              id: job.viagemId,
              status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA] },
              revisadoEm: null,
            },
            data: {
              status: StatusViagem.OK,
              revisadoEm: agora,
              conferidoPorIaEm: agora,
              motivoStatus: null,
              tipoDivergencia: null,
            },
          });
          if (alterou.count === 0) continue;

          const confianca = job.confianca ?? 0;
          await prisma.viagemMensagem.create({
            data: {
              viagemId: job.viagemId,
              autor: "ADMIN",
              usuarioId: null,
              autorNome: "Conferência automática",
              texto: [
                `Aprovada automaticamente. Confere com o documento (${campos} campos verificados, leitura ${Math.round(confianca * 100)}%).`,
                ...resumo,
              ].join(" "),
              acao: "CONFERIU",
            },
          });
          await prisma.conferenciaTicket.update({
            where: { id: job.id },
            data: { acao: "APROVOU", aplicadoEm: agora },
          });
        } catch (err) {
          console.error(`   ✗ ${job.viagemId}: ${(err as Error).message}`);
        }
      }
      console.log(`   ✓ ${aprovaveis.length} aprovadas\n`);
    });
  }

  if (recusas.size > 0) {
    console.log("Não aprovadas (seguem na fila de quem confere):");
    for (const [motivo, n] of [...recusas.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(4)}  ${motivo}`);
    }
    console.log("");
  }

  console.log(
    totalAprovadas === 0
      ? "Nenhuma viagem se encaixa — nada a fazer."
      : aplicar
        ? `Pronto: ${totalAprovadas} viagem(ns) aprovadas.`
        : `${totalAprovadas} viagem(ns) seriam aprovadas. Rode com --aplicar pra valer.`,
  );

  await app.close();
}

/** Conta por que cada viagem não passou — é o que diz se a régua está certa. */
function contarRecusa(mapa: Map<string, number>, motivo: string): void {
  mapa.set(motivo, (mapa.get(motivo) ?? 0) + 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
