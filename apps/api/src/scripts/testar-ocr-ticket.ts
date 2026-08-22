/**
 * Testa a leitura de ticket ponta a ponta, com chamada REAL à Anthropic.
 *
 * Em desenvolvimento (precisa de ANTHROPIC_API_KEY no .env):
 *   cd apps/api && pnpm testar:ocr -- --ultima
 *   cd apps/api && pnpm testar:ocr -- --foto /caminho/do/ticket.jpg
 *
 * DENTRO do container em produção (a chave já está no ambiente, e o `src/` não
 * existe lá — só o compilado):
 *   node dist/scripts/testar-ocr-ticket.js --ultima
 *
 * `--ultima` pega a foto mais recente que um motorista mandou e compara o que a
 * IA lê com o que ele DECLAROU na viagem — o conferente da Fase 2 em miniatura,
 * feito à mão. É o jeito mais rápido de responder "por que não apareceu
 * sugestão nenhuma pro motorista?", porque mostra o `confidence` contra o corte
 * de 0.2 que o app aplica em silêncio.
 *
 * Responde o que teste unitário não responde: o modelo lê direito com o
 * catálogo enxuto, quanto custa de verdade, e quantos tokens vão em cada parte.
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

const tem = (flag: string) => process.argv.includes(flag);

const brl = (usd: number) => `R$ ${(usd * 5.45).toFixed(4)}`;

async function main() {
  const caminho = arg("--foto");
  let storageKey = arg("--storage-key");
  const contaSlug = arg("--conta");
  const ultima = tem("--ultima");

  if (!caminho && !storageKey && !ultima) {
    console.error(
      "Escolha a foto:\n" +
        "  --ultima                  a última que um motorista mandou (o caso comum)\n" +
        "  --foto <arquivo>          um arquivo do disco\n" +
        "  --storage-key <chave>     uma chave específica do MinIO\n" +
        "\nOpcional: --conta <slug> pra escolher a empresa.",
    );
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

  // `--ultima`: acha sozinho a foto mais recente da conta e, junto, o que o
  // motorista declarou naquela viagem. É o que permite comparar leitura x
  // declaração sem ninguém precisar caçar uuid no banco.
  // `data` é nullable na viagem (lifecycle guiado abre sem ela).
  let declarado:
    | {
        ticket: string | null;
        toneladas: unknown;
        data: Date | null;
        placa?: string;
        cliente?: string;
        material?: string;
      }
    | undefined;

  if (ultima) {
    const foto = await comoSistema(() =>
      base.ticketFoto.findFirst({
        where: { contaId: conta.id },
        orderBy: { capturadaEm: "desc" },
        select: {
          storageKey: true,
          capturadaEm: true,
          viagem: {
            select: {
              ticket: true,
              toneladas: true,
              data: true,
              veiculo: { select: { placa: true } },
              cliente: { select: { nome: true } },
              material: { select: { nome: true } },
            },
          },
        },
      }),
    );
    if (!foto) {
      console.error(`Nenhuma foto de ticket em ${conta.nome}.`);
      process.exit(1);
    }
    storageKey = foto.storageKey;
    const v = foto.viagem;
    declarado = {
      ticket: v.ticket,
      toneladas: v.toneladas,
      data: v.data,
      placa: v.veiculo?.placa,
      cliente: v.cliente?.nome,
      material: v.material?.nome,
    };
    console.log(`Foto mais recente: ${foto.capturadaEm.toISOString()}\n`);
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

        // O corte que o app usa: abaixo disso o resultado é descartado sem
        // aparecer pro motorista. É a explicação mais provável pra "tirei a
        // foto e não apareceu nada".
        console.log("");
        if ((r.confidence ?? 0) <= 0.2) {
          console.log(
            `⚠️  confidence ${r.confidence} — ABAIXO do corte de 0.2 do app.\n` +
              "   Nesta viagem o motorista não teria visto sugestão nenhuma.",
          );
        } else {
          console.log(`✅ confidence ${r.confidence} — acima do corte de 0.2; o app mostraria.`);
        }

        if (declarado) {
          // Conferente em miniatura: a comparação que a Fase 2 vai automatizar.
          console.log("\n  campo        declarado            lido");
          const linha = (campo: string, dec: unknown, lido: unknown) => {
            const d = dec == null || dec === "" ? "—" : String(dec);
            const l = lido == null || lido === "" ? "—" : String(lido);
            const bate = d !== "—" && l !== "—" && d.toLowerCase() === l.toLowerCase();
            const marca = d === "—" || l === "—" ? " " : bate ? "✓" : "✗";
            console.log(`  ${marca} ${campo.padEnd(11)}${d.padEnd(21)}${l}`);
          };
          // Quando a IA casa o nome com o cadastro, ela devolve o ID — e ID não
          // se compara com nome. Resolver de volta pro nome é o que torna a
          // linha legível; sem isso toda leitura BOA aparecia como divergência.
          const nomeCliente = r.clienteId
            ? clientes.find((c) => c.id === r.clienteId)?.nome
            : r.clienteSugerido;
          const nomeMaterial = r.materialId
            ? materiais.find((m) => m.id === r.materialId)?.nome
            : r.materialSugerido;

          linha("ticket", declarado.ticket, r.ticket);
          linha("toneladas", declarado.toneladas, r.toneladas);
          linha("data", declarado.data?.toISOString().slice(0, 10), r.data);
          linha("placa", declarado.placa, r.placaSugerida);
          linha("cliente", declarado.cliente, nomeCliente);
          linha("material", declarado.material, nomeMaterial);

          console.log(
            "\n  ✗ = o que o conferente da Fase 2 olharia. Nem todo ✗ vira aviso\n" +
              "  pro motorista: 1 caractere de diferença numa placa ou num ticket é\n" +
              "  leitura ruim (G/Q, 0/O, 1/7, 5/S, 8/B), não motorista errado — vai\n" +
              "  pra revisão humana, nunca pra cobrança.",
          );
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
            "ℹ️  Sem cache, e no Haiku 4.5 é esperado: o prefixo mínimo cacheável dele\n" +
              "   é 4096 tokens, e uma leitura inteira não chega lá. Não é defeito de\n" +
              "   configuração — é o modelo. (Sonnet pede 1024, Opus 5 pede 512.)",
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
