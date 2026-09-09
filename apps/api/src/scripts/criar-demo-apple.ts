/**
 * A conta de demonstração que vai nas review notes da Apple (e da Play).
 *
 * Uso: cd apps/api && pnpm demo:apple -- --senha "Teste@2026"
 *      (opcional: --cpf 52998224725 --nome "Motorista Demo Apple" --telefone 42999999999)
 *
 * Por que um script, e não o painel: o painel só cria VÍNCULO (motorista dentro
 * de uma conta), e o cadastro pelo app exige código enviado por WhatsApp — um
 * revisor em Cupertino não tem CPF nem WhatsApp brasileiro, então a conta tem
 * que existir pronta.
 *
 * E ela precisa ser de alguém SEM transportadora: entregar um motorista
 * vinculado reacende a recusa por 3.2 ("app de uma organização") e liga de volta
 * a captura periódica de posição, que só roda pra quem tem vínculo — exatamente
 * o oposto do que dizemos na submissão. Ver docs/app-store-submissao.md.
 *
 * `ultimoLoginEm` é gravado de propósito: com ele preenchido, uma empresa que
 * cadastre esse CPF pelo painel gera um CONVITE pendente (que não vira vínculo
 * vivo sozinho) em vez de adotar a conta — ver common/vinculo.ts. É a trava que
 * impede a conta do revisor de ganhar empresa por acidente.
 *
 * Usa o PrismaClient cru, sem a trava de conta: identidade é da plataforma, não
 * de uma transportadora, e isto roda fora de qualquer requisição.
 */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

function arg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

/** Mesma regra do app: 11 dígitos, não todos iguais, dois dígitos verificadores. */
function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

async function main() {
  const cpf = (arg("--cpf", "52998224725") ?? "").replace(/\D/g, "");
  const nome = arg("--nome", "Motorista Demo Apple")!;
  const telefone = arg("--telefone", "42999999999")!.replace(/\D/g, "");
  const senha = arg("--senha");

  if (!cpfValido(cpf)) {
    throw new Error(`CPF ${cpf} é inválido — o app recusaria no login.`);
  }
  if (!senha || senha.length < 6) {
    throw new Error("Passe --senha com pelo menos 6 caracteres.");
  }

  const prisma = new PrismaClient();
  const senhaHash = await bcrypt.hash(senha, 10);

  const existente = await prisma.motoristaIdentidade.findUnique({
    where: { cpf },
    include: { vinculos: { select: { id: true, contaId: true, ativo: true } } },
  });

  if (existente?.vinculos.length) {
    // Não desligo vínculo sozinho: se este CPF já roda pra alguma empresa, é um
    // motorista de verdade, e a conta de demo tem que ser outra.
    throw new Error(
      `O CPF ${cpf} tem ${existente.vinculos.length} vínculo(s) com empresa e não serve como conta de demonstração. ` +
        `Rode de novo com --cpf de um CPF válido que não esteja em uso.`,
    );
  }

  const identidade = await prisma.motoristaIdentidade.upsert({
    where: { cpf },
    update: {
      nome,
      telefone,
      senhaHash,
      ativo: true,
      tentativasLogin: 0,
      bloqueadoAte: null,
      ultimoLoginEm: existente?.ultimoLoginEm ?? new Date(),
    },
    create: {
      cpf,
      nome,
      telefone,
      senhaHash,
      ultimoLoginEm: new Date(),
    },
    select: { id: true, cpf: true, nome: true },
  });

  console.log("Conta de demonstração pronta (sem empresa):");
  console.log(`  id:       ${identidade.id}`);
  console.log(`  nome:     ${identidade.nome}`);
  console.log(`  CPF:      ${identidade.cpf}`);
  console.log(`  senha:    ${senha}`);
  console.log("");
  console.log("Confira antes de mandar pra loja: o login tem que devolver a lista");
  console.log("de cadastros VAZIA — se aparecer empresa, a conta não serve.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
