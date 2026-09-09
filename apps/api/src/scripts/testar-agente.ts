/**
 * Conversa com o agente do WhatsApp pelo terminal.
 *
 * Existe porque, até aqui, o único jeito de saber se uma mudança no agente
 * funcionou era alguém mandar mensagem de verdade pelo WhatsApp e outra pessoa
 * ler o log do container em produção. Cada hipótese custava um deploy, um
 * motorista e um pedaço do crédito de IA — e erro pequeno virava meia hora.
 *
 * Aqui não passa Chatwoot nem WhatsApp: o `AgenteService` não conhece nenhum
 * dos dois. Entra texto, sai a resposta, e o rastro de ferramenta aparece no
 * log (`tool=X input=... output=...`), que é exatamente o que se quer olhar.
 *
 *   pnpm testar:agente "me mostra minhas últimas viagens"
 *   pnpm testar:agente --limpar "e a viagem de ontem?"
 *   pnpm testar:agente --motorista "Cleber" "quantas viagens eu fiz esse mês?"
 *   pnpm testar:agente --bateria
 *
 * O histórico é real: as mensagens ficam gravadas numa sessão de teste, então
 * a conversa continua entre execuções. É de propósito — vários defeitos só
 * aparecem no SEGUNDO turno, quando o modelo depende do que ele mesmo disse
 * antes. `--limpar` zera essa sessão pra começar do zero.
 */
// O `.env` é coisa de dev; na imagem de produção as variáveis já vêm do
// ambiente e o `dotenv` nem está instalado.
try {
  require("dotenv/config");
} catch {
  /* segue com as variáveis do ambiente */
}
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { IaModule } from "../ia/ia.module";
import { LancamentosResgatadosModule } from "../lancamentos-resgatados/lancamentos-resgatados.module";
import { AgenteService } from "../whatsapp/agente/agente.service";
import { comConta, comoSistema } from "../common/conta/conta-context";

/**
 * Só o que o agente precisa. De propósito NÃO é o AppModule: subir a aplicação
 * inteira ligaria crons e workers — efeito colateral que um script de teste
 * rodado dezenas de vezes seguidas não pode ter.
 */
@Module({
  // `IaModule` entra porque o `WhatsappModule` não é auto-suficiente: ele
  // depende de `TranscricaoService`, que na aplicação vem por um import do
  // AppModule. Um módulo que só monta dentro do app inteiro é justamente o que
  // impedia testar o agente isolado.
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IaModule,
    LancamentosResgatadosModule,
    WhatsappModule,
  ],
})
class HarnessModule {}

/** Telefone que não existe no mundo: a sessão de teste nunca colide com a de um motorista. */
const TELEFONE_TESTE = "5500000000000";

/**
 * As perguntas que um motorista faz de verdade. Rodar isto depois de mexer no
 * prompt ou nas ferramentas mostra os defeitos juntos, em vez de um por vez
 * ao custo de uma mensagem de WhatsApp cada.
 */
const BATERIA = [
  "me mostra minhas últimas viagens",
  "e a viagem de ontem?",
  "quero ver o detalhe dessa",
  "quantas viagens eu fiz esse mês?",
  "cadê a viagem que eu lancei sem o peso?",
  "tem alguma pendência minha?",
];

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const tem = (flag: string) => process.argv.includes(flag);

async function main() {
  const limpar = tem("--limpar");
  const bateria = tem("--bateria");
  const nomeBusca = arg("--motorista") ?? "Vagner";

  // A mensagem é o primeiro argumento que não é flag nem valor de flag.
  const flagsComValor = ["--motorista"];
  const argv = process.argv.slice(2);
  const mensagens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flagsComValor.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    mensagens.push(a);
  }

  const app = await NestFactory.createApplicationContext(HarnessModule, {
    // Logger ligado de propósito: é dele que vem `tool=... input=... output=...`
    // e a contagem de tokens por loop. Sem isso o harness não serve pra nada.
    logger: ["log", "warn", "error"],
  });
  const prisma = app.get(PrismaService);
  const agente = app.get(AgenteService);

  // Fora de request não há conta no contexto — e a trava do Prisma recusa
  // qualquer leitura de dado de negócio. `comoSistema` é o modo declarado pra
  // script, e atravessa contas de propósito só até descobrir de quem é o
  // motorista.
  const motorista = await comoSistema(() =>
    prisma.motorista.findFirst({
      where: { nome: { contains: nomeBusca, mode: "insensitive" }, ativo: true },
      select: { id: true, nome: true, contaId: true },
      orderBy: { nome: "asc" },
    }),
  );
  if (!motorista) {
    console.error(`Nenhum motorista ativo com nome contendo "${nomeBusca}".`);
    process.exit(1);
  }

  const sessao = await comoSistema(async () => {
    const existente = await prisma.whatsappSessao.findFirst({
      where: { telefone: TELEFONE_TESTE, motoristaId: motorista.id },
    });
    if (existente) return existente;
    return prisma.whatsappSessao.create({
      data: { telefone: TELEFONE_TESTE, motoristaId: motorista.id, contaId: motorista.contaId },
    });
  });

  if (limpar) {
    const { count } = await comoSistema(() =>
      prisma.whatsappMensagem.deleteMany({ where: { sessaoId: sessao.id } }),
    );
    console.log(`\n[harness] histórico zerado (${count} mensagens apagadas)`);
  }

  const identidade = {
    tipo: "MOTORISTA" as const,
    sessaoId: sessao.id,
    motoristaId: motorista.id,
    nome: motorista.nome,
    contaId: motorista.contaId,
  };

  const perguntas = bateria ? BATERIA : mensagens;
  if (perguntas.length === 0) {
    console.error('Passe uma mensagem: pnpm testar:agente "me mostra minhas viagens"');
    process.exit(1);
  }

  console.log(`\n[harness] motorista: ${motorista.nome} (conta ${motorista.contaId})`);
  console.log(`[harness] sessão de teste: ${sessao.id}\n`);

  for (const pergunta of perguntas) {
    console.log(`\n${"=".repeat(70)}\n>>> ${pergunta}\n${"=".repeat(70)}`);
    const inicio = Date.now();

    // Tudo dentro do `comConta`, com o await DENTRO: promise do Prisma é
    // preguiçosa, e resolver fora do contexto faria a query sair sem a trava.
    const resposta = await comConta(identidade.contaId, async () => {
      // Grava a ENTRADA como o fluxo real grava — é dela que o agente monta o
      // histórico do próximo turno.
      await prisma.whatsappMensagem.create({
        data: {
          sessaoId: sessao.id,
          telefone: TELEFONE_TESTE,
          direcao: "ENTRADA",
          conteudo: pergunta,
          tipo: "TEXTO",
          provedor: "meta",
        },
      });

      const r = await agente.processar(identidade, pergunta);

      if (r.trim()) {
        await prisma.whatsappMensagem.create({
          data: {
            sessaoId: sessao.id,
            telefone: TELEFONE_TESTE,
            direcao: "SAIDA",
            conteudo: r,
            tipo: "TEXTO",
            provedor: "meta",
          },
        });
      }
      return r;
    });

    const seg = ((Date.now() - inicio) / 1000).toFixed(1);
    console.log(`\n<<< (${seg}s)\n${resposta || "[VAZIO — o motorista não receberia nada]"}\n`);
  }

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
