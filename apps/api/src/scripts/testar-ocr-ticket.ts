/**
 * Testa a leitura de ticket ponta a ponta, com chamada REAL à Anthropic.
 *
 * Uso:
 *   cd apps/api && pnpm testar:ocr -- --foto /caminho/do/ticket.jpg
 *   cd apps/api && pnpm testar:ocr -- --storage-key "cnt_x/tickets/2026-08-20/m1/abc.jpg"
 *
 * Serve pra responder três perguntas que teste unitário não responde:
 *   1. o modelo continua lendo o ticket direito com o catálogo enxuto?
 *   2. o prompt caching está pegando de verdade? (é o que corta a conta)
 *   3. quanto custa, em dinheiro, uma leitura?
 *
 * Roda a chamada DUAS vezes de propósito: na primeira o cache é escrito, na
 * segunda ele deveria ser lido. Se `cache_read` continuar zero na segunda, o
 * prefixo não atingiu o mínimo de 1024 tokens e a economia não existe — falha
 * que a API não reporta como erro.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { IaService } from "../ia/ia.service";
import { UsoIaService } from "../ia/uso-ia.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { travaConta } from "../common/conta/trava-conta";
import type { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const brl = (usd: number) => `R$ ${(usd * 5.45).toFixed(4)}`;

async function main() {
  const caminho = arg("--foto");
  const storageKey = arg("--storage-key");
  const contaSlug = arg("--conta");

  if (!caminho && !storageKey) {
    console.error("Diga --foto <arquivo> ou --storage-key <chave no MinIO>.");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY não está no ambiente. Sem ela não há chamada real —\n" +
        "que é justamente o que este script existe pra fazer.",
    );
    process.exit(1);
  }

  const base = new PrismaClient();
  const prisma = base.$extends(travaConta) as unknown as PrismaService;

  const conta = await comoSistema(() =>
    base.conta.findFirst({
      where: contaSlug ? { slug: contaSlug } : {},
      orderBy: { criadaEm: "asc" },
      select: { id: true, nome: true, iaLeituraTicket: true },
    }),
  );
  if (!conta) {
    console.error("Nenhuma conta no banco.");
    process.exit(1);
  }

  // Carrega a imagem: de disco, ou do MinIO (que é onde as fotos de verdade
  // estão — dá pra reprocessar um ticket real de produção).
  let buffer: Buffer;
  let mime = "image/jpeg";
  if (caminho) {
    buffer = readFileSync(caminho);
    if (caminho.toLowerCase().endsWith(".png")) mime = "image/png";
    if (caminho.toLowerCase().endsWith(".webp")) mime = "image/webp";
  } else {
    const uploads = new UploadsService(new ConfigService());
    await uploads.onModuleInit();
    buffer = await uploads.getObjectBuffer(storageKey!);
    if (storageKey!.toLowerCase().endsWith(".png")) mime = "image/png";
  }
  const fotoBase64 = buffer.toString("base64");

  const uso = new UsoIaService(prisma);
  const ia = new IaService(new ConfigService(), prisma, uso);

  console.log(`Empresa: ${conta.nome} (leitura ${conta.iaLeituraTicket ? "ligada" : "DESLIGADA"})`);
  console.log(`Imagem:  ${Math.round(buffer.length / 1024)} KB, ${mime}\n`);

  await comConta(conta.id, async () => {
    const [clientes, materiais, veiculos] = await Promise.all([
      prisma.cliente.findMany({ where: { ativa: true }, select: { id: true, nome: true, apelidos: true } }),
      prisma.material.findMany({ where: { ativo: true }, select: { id: true, nome: true, apelidos: true } }),
      prisma.veiculo.findMany({ select: { id: true, placa: true, modelo: true } }),
    ]);
    console.log(
      `Catálogo: ${clientes.length} clientes, ${materiais.length} materiais, ${veiculos.length} veículos\n`,
    );

    for (const passada of [1, 2]) {
      const t0 = Date.now();
      const r = await ia.extrairTicket({ fotoBase64, mime, catalogos: { clientes, materiais, veiculos } });
      const ms = Date.now() - t0;

      console.log(`──────── passada ${passada} (${ms} ms) ────────`);
      if (passada === 1) {
        console.log("O que a IA leu:");
        for (const [k, v] of Object.entries(r)) {
          if (v !== undefined && v !== null) console.log(`  ${k.padEnd(18)} ${String(v)}`);
        }
      }

      // O registro de custo é gravado em background pelo UsoIaService; espera
      // um instante e lê de volta a última linha.
      await new Promise((res) => setTimeout(res, 800));
      const linha = await prisma.usoIa.findFirst({
        where: { escopo: "ocr-app" },
        orderBy: { criadoEm: "desc" },
      });
      if (!linha) {
        console.log("  (não achei o registro de uso — a medição não gravou)");
        continue;
      }
      const custo = Number(linha.custoUsd ?? 0);
      console.log(
        `  tokens: ${linha.tokensEntrada} novos · ${linha.tokensCacheLeitura} lidos do cache · ` +
          `${linha.tokensCacheEscrita} escritos no cache · ${linha.tokensSaida} de saída`,
      );
      console.log(`  custo:  US$ ${custo.toFixed(6)}  (${brl(custo)})   modelo: ${linha.modelo}`);

      if (passada === 2) {
        console.log("");
        if (linha.tokensCacheLeitura > 0) {
          console.log(`✅ CACHE PEGOU — ${linha.tokensCacheLeitura} tokens vieram por ~10% do preço.`);
        } else {
          console.log(
            "❌ CACHE NÃO PEGOU. O prefixo não chegou aos 1024 tokens mínimos, ou algo\n" +
              "   variou entre as duas chamadas. A economia principal não está acontecendo.",
          );
        }
      }
      console.log("");
    }

    // Conta do mês, que é o número que interessa pra decidir qualquer coisa.
    const mes = await prisma.usoIa.aggregate({
      where: { escopo: "ocr-app" },
      _sum: { custoUsd: true },
      _count: true,
    });
    const total = Number(mes._sum.custoUsd ?? 0);
    console.log(`Acumulado desta conta: ${mes._count} chamadas, US$ ${total.toFixed(6)} (${brl(total)})`);
  });

  await base.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
