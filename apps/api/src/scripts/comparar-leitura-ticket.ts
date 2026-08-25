/**
 * Roda a MESMA foto de ticket em vários modelos e põe os resultados lado a lado.
 *
 *   cd apps/api && pnpm comparar:ticket -- --ultima
 *   cd apps/api && pnpm comparar:ticket -- --ultima --modelos claude-haiku-4-5-20251001,MiniMax-M3
 *   cd apps/api && pnpm comparar:ticket -- --foto /caminho/ticket.jpg
 *
 * Existe pra responder a única pergunta que decide troca de fornecedor de OCR:
 * **este modelo lê ticket brasileiro amassado tão bem quanto o que está lá?**
 * Benchmark publicado não responde isso, e teste unitário muito menos — o que
 * responde é a mesma foto, o mesmo prompt, dois modelos, e a comparação contra
 * o que o motorista declarou.
 *
 * Imprime, por modelo: o que leu campo a campo, o veredito que sairia, a
 * latência (que é o risco do MiniMax, com servidor na Ásia) e o custo medido —
 * não estimado: lido de volta da tabela `usoIa`.
 *
 * Roda contra a API de verdade e gasta dinheiro. É pouco: uma rodada dessas
 * custa menos que um centavo.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { UsoIaService } from "../ia/uso-ia.service";
import { ClienteIaFactory } from "../ia/cliente-ia";
import { LeitorTicketService } from "../conferencia-ticket/leitor-ticket.service";
import { provedorDoModelo, chaveDoProvedor } from "../common/ia/provedor-ia";
import { conferirComJulgamento, type Declarado } from "../common/conferencia-ticket";
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

/** O que roda hoje contra o candidato. Sobrescrevível com --modelos. */
const MODELOS_PADRAO = ["claude-haiku-4-5-20251001", "MiniMax-M3"];

async function main() {
  const caminho = arg("--foto");
  let storageKey = arg("--storage-key");
  const contaSlug = arg("--conta");
  const ultima = tem("--ultima");
  const modelos = (arg("--modelos") ?? MODELOS_PADRAO.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  if (!caminho && !storageKey && !ultima) {
    console.error(
      "Escolha a foto:\n" +
        "  --ultima                  a última que um motorista mandou (o caso comum)\n" +
        "  --foto <arquivo>          um arquivo do disco\n" +
        "  --storage-key <chave>     uma chave específica do MinIO\n" +
        "\nOpcional: --conta <slug>, --modelos a,b,c\n" +
        "          --declarado '{\"ticket\":\"123\",\"toneladas\":30,...}'  o que o motorista lançou",
    );
    process.exit(1);
  }

  // Falta de chave é o erro mais provável aqui, e descobrir isso DEPOIS de
  // pagar a primeira leitura seria bobagem.
  const config = new ConfigService();
  const clientes = new ClienteIaFactory(config);
  const semChave = modelos.filter((m) => !clientes.disponivel(m));
  if (semChave.length) {
    for (const m of semChave) {
      console.error(`${chaveDoProvedor(provedorDoModelo(m))} não está no ambiente — "${m}" não roda.`);
    }
    process.exit(1);
  }

  const base = new PrismaClient();
  const prisma = base.$extends(travaConta) as unknown as PrismaService;

  const conta = await comoSistema(() =>
    base.conta.findFirst({
      where: contaSlug ? { slug: contaSlug } : {},
      orderBy: { criadaEm: "asc" },
      select: { id: true, nome: true },
    }),
  );
  if (!conta) {
    console.error("Nenhuma conta no banco.");
    process.exit(1);
  }

  let declarado: Declarado | undefined;

  // `--declarado '{"ticket":"123","toneladas":30}'` simula o fluxo REAL sem
  // depender do banco: no conferente o modelo nunca extrai do zero, ele confere
  // contra o que o motorista lançou. Testar sem isso mede a tarefa errada — e
  // mede uma mais difícil do que a que roda em produção.
  const declaradoJson = arg("--declarado");
  if (declaradoJson) {
    declarado = JSON.parse(declaradoJson) as Declarado;
  }

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
      toneladas: v.toneladas == null ? null : Number(v.toneladas),
      data: v.data,
      placa: v.veiculo?.placa ?? null,
      clienteNome: v.cliente?.nome ?? null,
      materialNome: v.material?.nome ?? null,
    };
    console.log(`Foto mais recente: ${foto.capturadaEm.toISOString()}`);
  }

  let buffer: Buffer;
  let mime = "image/jpeg";
  if (caminho) {
    buffer = readFileSync(caminho);
    if (caminho.toLowerCase().endsWith(".png")) mime = "image/png";
    if (caminho.toLowerCase().endsWith(".webp")) mime = "image/webp";
  } else {
    const uploads = new UploadsService(config);
    await uploads.onModuleInit();
    buffer = await uploads.getObjectBuffer(storageKey!);
    if (storageKey!.toLowerCase().endsWith(".png")) mime = "image/png";
  }
  const fotoBase64 = buffer.toString("base64");

  const uso = new UsoIaService(prisma);
  const leitor = new LeitorTicketService(clientes, uso);

  console.log(`Empresa: ${conta.nome}`);
  console.log(`Imagem:  ${Math.round(buffer.length / 1024)} KB, ${mime}`);
  console.log(`Modelos: ${modelos.join(", ")}\n`);

  const paraOModelo = declarado
    ? {
        numeroDocumento: declarado.ticket,
        toneladas: declarado.toneladas,
        data: declarado.data ? String(declarado.data).slice(0, 10) : null,
        placa: declarado.placa,
        cliente: declarado.clienteNome,
        material: declarado.materialNome,
      }
    : {};

  await comConta(conta.id, async () => {
    for (const modelo of modelos) {
      console.log(`──────── ${modelo} (${provedorDoModelo(modelo)}) ────────`);
      const t0 = Date.now();
      let r;
      try {
        r = await leitor.ler({ fotoBase64, mime, declarado: paraOModelo, modelo });
      } catch (err) {
        // Um modelo cair não pode impedir de ver os outros — é justamente a
        // comparação que interessa.
        console.log(`  ✗ falhou em ${Date.now() - t0} ms: ${(err as Error).message}\n`);
        continue;
      }
      const ms = Date.now() - t0;

      console.log(`  latência: ${ms} ms   confiança: ${r.lido.confianca}   legível: ${r.legivel}`);
      if (r.falha) console.log(`  falha: ${r.falha}`);

      if (declarado) {
        console.log("\n  campo        declarado            lido");
        const linha = (campo: string, dec: unknown, lido: unknown) => {
          const d = dec == null || dec === "" ? "—" : String(dec);
          const l = lido == null || lido === "" ? "—" : String(lido);
          const bate = d !== "—" && l !== "—" && d.toLowerCase() === l.toLowerCase();
          const marca = d === "—" || l === "—" ? " " : bate ? "✓" : "✗";
          console.log(`  ${marca} ${campo.padEnd(11)}${d.padEnd(21)}${l}`);
        };
        linha("ticket", declarado.ticket, r.lido.ticket);
        linha("toneladas", declarado.toneladas, r.lido.toneladas);
        linha("data", declarado.data ? String(declarado.data).slice(0, 10) : null, r.lido.data);
        linha("placa", declarado.placa, r.lido.placa);
        linha("cliente", declarado.clienteNome, r.lido.clienteNome);
        linha("material", declarado.materialNome, r.lido.materialNome);

        // O veredito é o que importa de verdade: um ✗ de um caractere numa
        // placa não vira aviso pra ninguém, e um peso errado vira.
        const v = conferirComJulgamento(declarado, r.lido, r.julgamento);
        console.log(`\n  veredito: ${v.veredito}`);
        if (v.divergencias.length) {
          console.log(`  divergências: ${v.divergencias.map((d) => d.campo).join(", ")}`);
        }
        if (v.incertezas.length) {
          console.log(`  incertezas:   ${v.incertezas.map((i) => i.campo).join(", ")}`);
        }
      } else {
        console.log(`  leu: ${JSON.stringify(r.lido)}`);
      }

      // O custo é gravado em background pelo UsoIaService; espera e lê de volta.
      // Medido, não estimado — é a diferença entre comparar preço e comparar conta.
      await new Promise((res) => setTimeout(res, 800));
      const registro = await prisma.usoIa.findFirst({
        where: { escopo: "conferencia", modelo },
        orderBy: { criadoEm: "desc" },
      });
      if (!registro) {
        console.log("\n  (não achei o registro de uso — a medição não gravou)\n");
        continue;
      }
      const custo = Number(registro.custoUsd ?? 0);
      console.log(
        `\n  tokens: ${registro.tokensEntrada} novos · ${registro.tokensCacheLeitura} do cache · ` +
          `${registro.tokensSaida} de saída`,
      );
      console.log(
        registro.custoUsd == null
          ? "  custo:  não sei — modelo fora da tabela de preços (common/ia/uso-ia.ts)\n"
          : `  custo:  US$ ${custo.toFixed(6)} (${brl(custo)}) · ~US$ ${(custo * 1000).toFixed(2)} a cada mil tickets\n`,
      );
    }

    console.log(
      "Como ler isto: ✗ de um caractere em placa ou ticket é leitura ruim\n" +
        "(G/Q, 0/O, 1/7, 5/S, 8/B), não motorista errado. O que decide a troca é o\n" +
        "VEREDITO bater com o do modelo de hoje, e o peso nunca sair errado.",
    );
  });

  await base.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
