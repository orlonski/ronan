/** O backfill acha e enfileira o acervo pendente? */
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { travaConta } from "./src/common/conta/trava-conta";
import { comConta, comoSistema } from "./src/common/conta/conta-context";
import { ConferenciaFilaService } from "./src/conferencia-ticket/conferencia-fila.service";
import { ConferenciaConfig } from "./src/conferencia-ticket/conferencia.config";
import type { PrismaService } from "./src/prisma/prisma.service";

const base = new PrismaClient();
const prisma = base.$extends(travaConta) as unknown as PrismaService;
const fila = new ConferenciaFilaService(prisma, new ConferenciaConfig(new ConfigService()));

async function main() {
  const contas = await comoSistema(() => base.conta.findMany({ where: { ativa: true } }));
  let conta = null as (typeof contas)[number] | null;
  for (const c of contas) {
    const temTudo = await comoSistema(async () =>
      (await base.motorista.count({ where: { contaId: c.id } })) > 0 &&
      (await base.veiculo.count({ where: { contaId: c.id } })) > 0 &&
      (await base.local.count({ where: { contaId: c.id } })) > 0,
    );
    if (temTudo) { conta = c; break; }
  }
  if (!conta) { console.error("nenhuma conta com cadastro base"); process.exit(1); }
  console.log(`conta: ${conta.nome}`);
  const dep = await comoSistema(async () => ({
    m: await base.motorista.findFirst({ where: { contaId: conta!.id } }),
    v: await base.veiculo.findFirst({ where: { contaId: conta!.id } }),
    l: await base.local.findFirst({ where: { contaId: conta!.id } }),
  }));

  const ids: string[] = [];
  // Três viagens "antigas": uma normal, uma já conferida, uma sem foto.
  for (const [i, caso] of ["pendente", "ja-conferida", "sem-foto"].entries()) {
    const v = await comoSistema(() =>
      base.viagem.create({
        data: {
          contaId: conta!.id,
          motoristaId: dep.m!.id,
          veiculoId: dep.v!.id,
          localCargaId: dep.l!.id,
          clientId: `bf-${caso}-${Math.floor(Math.random() * 1e9)}`,
          data: new Date("2026-08-10"),
          km: 100,
          toneladas: 30,
          ticket: `ANTIGA-${i}`,
          status: "ENVIADA",
          ...(caso === "sem-foto"
            ? {}
            : { fotos: { create: { contaId: conta!.id, storageKey: `k-${i}.jpg` } } }),
        },
      }),
    );
    ids.push(v.id);
    if (caso === "ja-conferida") {
      await comoSistema(() =>
        base.conferenciaTicket.create({
          data: {
            contaId: conta!.id,
            viagemId: v.id,
            storageKey: `k-${i}.jpg`,
            origem: "create",
            declarado: {},
            status: "CONCLUIDA",
            veredito: "BATE",
          },
        }),
      );
    }
  }

  await comConta(conta!.id, async () => {
    const antes = await fila.contarPendentesDeConferencia();
    console.log(`pendentes de conferência: ${antes}`);
    const r = await fila.reprocessarPendentes(100);
    console.log(`enfileiradas: ${r.enfileiradas} de ${r.candidatas} candidata(s)`);

    const jobs = await base.conferenciaTicket.findMany({
      where: { viagemId: { in: ids }, origem: "reconferencia" },
      select: { viagemId: true },
    });
    const comJob = new Set(jobs.map((j) => j.viagemId));
    console.log(`  viagem pendente     -> ${comJob.has(ids[0]) ? "OK entrou" : "FALHOU"}`);
    console.log(`  viagem já conferida -> ${comJob.has(ids[1]) ? "FALHOU (pagaria 2x)" : "OK pulou"}`);
    console.log(`  viagem sem foto     -> ${comJob.has(ids[2]) ? "FALHOU" : "OK pulou"}`);

    const depois = await fila.contarPendentesDeConferencia();
    console.log(`pendentes depois: ${depois} (as enfileiradas ainda contam até concluírem)`);
  });

  await comoSistema(async () => {
    await base.conferenciaTicket.deleteMany({ where: { viagemId: { in: ids } } });
    for (const id of ids) await base.viagem.delete({ where: { id } }).catch(() => {});
  });
  await base.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
