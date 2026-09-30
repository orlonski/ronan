/**
 * Por que cada viagem ficou "Em conferência"? Relatório pra afinar o leitor.
 *
 *   cd apps/api && pnpm diagnosticar:conferencias
 *   cd apps/api && pnpm diagnosticar:conferencias -- --conta schaba --exemplos 8
 *   cd apps/api && pnpm diagnosticar:conferencias -- --detalhe   # uma linha por viagem
 *
 * No container (Easypanel), flags direto:
 *
 *   cd /repo/apps/api && node dist/scripts/diagnosticar-conferencias.js
 *
 * **Só lê.** Não gasta IA, não escreve nada. Pega a última leitura concluída
 * de cada viagem parada em EM_CONFERENCIA (sem decisão humana), recompara com
 * a régua de HOJE e diz qual trava segurou — agrupado por motivo, com exemplos
 * do lançado × lido e da justificativa que a própria IA escreveu.
 *
 * A saída é feita pra ser colada numa conversa: curta no agrupado, e o
 * `--detalhe` quando precisar olhar caso a caso.
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
import {
  conferirComJulgamento,
  LIMIARES_PADRAO,
  type Declarado,
  type JulgamentoIa,
  type Lido,
  type ResultadoConferencia,
} from "../common/conferencia-ticket";
import { comConta, comoSistema } from "../common/conta/conta-context";

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule] })
class ScriptModule {}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const tem = (flag: string) => process.argv.includes(flag);

type Caso = { viagemId: string; linha: string };
type Grupo = { casos: Caso[] };

const corta = (s: string | null | undefined, n = 60) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || "—";
};

/**
 * A trava que segurou, na mesma ordem em que `decidirVeredito` decide. Cada
 * incerteza vira uma chave "campo · motivo" — o motivo da IA é livre, então só
 * o começo entra na chave, pra frases parecidas caírem juntas.
 */
function motivos(
  r: ResultadoConferencia,
  confianca: number,
  vereditoGravado: string | null,
  passadas: number,
): string[] {
  if (r.veredito === "NAO_APLICAVEL") return ["nada pra conferir (sem campos lidos)"];
  if (confianca < LIMIARES_PADRAO.confiancaMinima) return [`leitura fraca (< ${LIMIARES_PADRAO.confiancaMinima})`];

  const saida: string[] = [];
  for (const i of r.incertezas) saida.push(`dúvida · ${i.campo} · ${corta(i.motivo, 45).toLowerCase()}`);

  const alta = r.divergencias.filter((d) => d.gravidade === "ALTA");
  if (alta.length > 0 && confianca < LIMIARES_PADRAO.confiancaParaAvisar) {
    saida.push(`diverge em ${alta.map((d) => d.campo).join("+")} mas leitura < ${LIMIARES_PADRAO.confiancaParaAvisar}`);
  }
  // Pela régua de hoje a 1ª leitura sairia DIVERGE/BATE, mas o gravado é
  // INCERTO depois de 2 passadas: foi a segunda leitura que discordou.
  if (saida.length === 0 && passadas >= 2 && vereditoGravado === "INCERTO" && r.veredito !== "INCERTO") {
    saida.push(`as duas leituras discordaram (1ª dá ${r.veredito})`);
  }
  if (saida.length === 0 && r.veredito !== "INCERTO") {
    saida.push(`pela régua de hoje sairia ${r.veredito} — reavaliar resolve`);
  }
  return saida.length > 0 ? saida : ["INCERTO sem trava identificada"];
}

async function main() {
  const contaSlug = arg("--conta");
  const nExemplos = Number(arg("--exemplos") ?? 4);
  const detalhe = tem("--detalhe");

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: false });
  const prisma = app.get(PrismaService);

  const contas = await comoSistema(() =>
    prisma.conta.findMany({
      where: contaSlug ? { slug: contaSlug } : { ativa: true },
      select: { id: true, nome: true, slug: true },
      orderBy: { criadaEm: "asc" },
    }),
  );

  for (const conta of contas) {
    await comConta(conta.id, async () => {
      const viagens = await prisma.viagem.findMany({
        where: { status: StatusViagem.EM_CONFERENCIA, revisadoEm: null },
        select: {
          id: true,
          conferenciasTicket: {
            where: { status: "CONCLUIDA" },
            orderBy: { criadoEm: "desc" },
            take: 1,
            select: { veredito: true, confianca: true, passadas: true, declarado: true, leitura: true, modelo: true },
          },
        },
      });
      if (viagens.length === 0) return;

      const grupos = new Map<string, Grupo>();
      const porViagem: string[] = [];
      let semLeitura = 0;
      const confs: number[] = [];

      for (const v of viagens) {
        const c = v.conferenciasTicket[0];
        if (!c) {
          semLeitura++;
          continue;
        }
        const leitura = (c.leitura ?? {}) as Lido & { julgamento?: JulgamentoIa };
        const declarado = (c.declarado ?? {}) as Declarado;
        const confianca = c.confianca ?? leitura.confianca ?? 0;
        confs.push(confianca);
        const julgamento = leitura.julgamento ?? {};
        const r = conferirComJulgamento(declarado, { ...leitura, confianca }, julgamento);
        const ms = motivos(r, confianca, c.veredito, c.passadas ?? 1);

        // O que a IA disse de cada campo em dúvida/divergente — é o texto que
        // mostra se a régua está certa.
        const chaveJulg: Record<string, keyof JulgamentoIa> = {
          ticket: "numeroDocumento",
          toneladas: "toneladas",
          data: "data",
          placa: "placa",
          cliente: "cliente",
          material: "material",
        };
        const campos = [...r.incertezas, ...r.divergencias];
        const linha =
          `conf ${confianca.toFixed(2)} · ${c.passadas ?? 1}p · ` +
          campos
            .map((x) => {
              const j = julgamento[chaveJulg[x.campo]];
              return `${x.campo}: lançado "${corta(x.declarado, 30)}" × lido "${corta(x.lido, 30)}"${
                j ? ` [IA: ${j.confere} — ${corta(j.porque, 70)}]` : ""
              }`;
            })
            .join(" | ");

        for (const m of ms) {
          const g = grupos.get(m) ?? { casos: [] };
          g.casos.push({ viagemId: v.id, linha });
          grupos.set(m, g);
        }
        porViagem.push(`${v.id}  ${ms.join(" ; ")}\n      ${linha}`);
      }

      const mediaConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
      console.log(`\n══ ${conta.nome} (${conta.slug}): ${viagens.length} em conferência`);
      console.log(`   confiança média da leitura: ${mediaConf.toFixed(2)}${semLeitura ? ` · ${semLeitura} sem leitura concluída` : ""}`);
      console.log(`   (uma viagem pode cair em mais de um grupo)\n`);

      for (const [motivo, g] of [...grupos.entries()].sort((a, b) => b[1].casos.length - a[1].casos.length)) {
        console.log(`${String(g.casos.length).padStart(4)}  ${motivo}`);
        for (const caso of g.casos.slice(0, nExemplos)) console.log(`        · ${caso.linha}`);
      }

      if (detalhe) {
        console.log(`\n── uma linha por viagem`);
        for (const l of porViagem) console.log(`   ${l}`);
      }
    });
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
