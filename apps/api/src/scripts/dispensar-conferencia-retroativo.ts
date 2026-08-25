/**
 * Aplica a dispensa de conferência nas viagens que JÁ estão paradas esperando.
 *
 *   cd apps/api && pnpm dispensar:retroativo                    # só mostra (padrão)
 *   cd apps/api && pnpm dispensar:retroativo -- --aplicar       # escreve de verdade
 *   cd apps/api && pnpm dispensar:retroativo -- --conta schaba
 *
 * A regra de material que dispensa conferência só vale para viagens NOVAS. As
 * que entraram antes continuam paradas no contador "a conferir", esperando um
 * aval que ninguém tem motivo pra dar. Este script limpa esse acúmulo.
 *
 * **`--dry-run` é o padrão de propósito.** Isto reescreve status de viagem e
 * preenche `revisadoEm`, que é o campo que faz o FechamentoProcessor parar de
 * sobrescrever o status. Rodar sem olhar antes é a receita de um estrago que
 * ninguém percebe até o fechamento do mês.
 *
 * Nunca toca em viagem que:
 *   - já tem decisão humana (`revisadoEm` preenchido);
 *   - já entrou em algum fechamento;
 *   - não está em ENVIADA (incompleta, aguardando, divergente, já OK).
 */
import "dotenv/config";
import { PrismaClient, StatusViagem } from "@prisma/client";
import {
  carimbosDaDispensa,
  textoDispensa,
} from "../common/conferencia-dispensada";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { travaConta } from "../common/conta/trava-conta";
import type { PrismaService } from "../prisma/prisma.service";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const tem = (flag: string) => process.argv.includes(flag);

async function main() {
  const aplicar = tem("--aplicar");
  const contaSlug = arg("--conta");

  const base = new PrismaClient();
  const prisma = base.$extends(travaConta) as unknown as PrismaService;

  const contas = await comoSistema(() =>
    base.conta.findMany({
      where: contaSlug ? { slug: contaSlug } : { ativa: true },
      select: { id: true, nome: true, slug: true },
      orderBy: { criadaEm: "asc" },
    }),
  );

  if (!aplicar) {
    console.log("MODO SIMULAÇÃO — nada será escrito. Use --aplicar pra valer.\n");
  }

  let totalGeral = 0;

  for (const conta of contas) {
    await comConta(conta.id, async () => {
      const candidatas = await prisma.viagem.findMany({
        where: {
          status: StatusViagem.ENVIADA,
          // Decisão humana manda. Sempre.
          revisadoEm: null,
          material: { dispensaConferencia: true },
          // Nada que já virou dinheiro é tocado.
          matchesFechamento: { none: {} },
        },
        select: {
          id: true,
          data: true,
          material: { select: { nome: true } },
          motorista: { select: { nome: true } },
        },
        orderBy: { data: "asc" },
      });

      if (candidatas.length === 0) return;
      totalGeral += candidatas.length;

      console.log(`── ${conta.nome} (${conta.slug}): ${candidatas.length} viagem(ns)`);
      for (const v of candidatas.slice(0, 5)) {
        const dia = v.data ? v.data.toISOString().slice(0, 10) : "sem data";
        console.log(`   ${dia}  ${v.material?.nome ?? "—"}  ${v.motorista?.nome ?? "—"}`);
      }
      if (candidatas.length > 5) console.log(`   … e mais ${candidatas.length - 5}`);

      if (!aplicar) {
        console.log("");
        return;
      }

      const agora = new Date();
      for (const v of candidatas) {
        // Uma a uma, e não em updateMany: cada viagem ganha a sua mensagem no
        // chat, e uma falha isolada não derruba o lote inteiro.
        try {
          await prisma.viagem.update({
            where: { id: v.id },
            data: carimbosDaDispensa(agora),
          });
          await prisma.viagemMensagem.create({
            data: {
              viagemId: v.id,
              autor: "ADMIN",
              usuarioId: null,
              autorNome: "Sistema",
              texto: textoDispensa(v.material?.nome),
              acao: "DISPENSOU_CONFERENCIA",
            },
          });
        } catch (err) {
          console.error(`   ✗ ${v.id}: ${(err as Error).message}`);
        }
      }
      console.log(`   ✓ ${candidatas.length} aprovadas\n`);
    });
  }

  console.log(
    totalGeral === 0
      ? "Nenhuma viagem se encaixa — nada a fazer."
      : aplicar
        ? `Pronto: ${totalGeral} viagem(ns) aprovadas.`
        : `${totalGeral} viagem(ns) seriam aprovadas. Rode com --aplicar pra valer.`,
  );

  await base.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
