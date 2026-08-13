/**
 * Seed do primeiro admin de uma conta.
 * Uso: cd apps/api && pnpm seed:admin -- --email user@x --senha minhasenha --nome "Fulano"
 *
 * Sem `--conta <slug>`, cai na conta mais antiga — que é a Schaba, a primeira.
 * Usa o PrismaClient cru (sem a trava de conta), então o `contaId` aqui é
 * escrito na mão de propósito: é script de linha de comando, roda fora de
 * qualquer requisição.
 */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

function arg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

async function main() {
  const email = arg("--email", "admin@ronan.local")!;
  const senha = arg("--senha", "ronan_admin_2026")!;
  const nome = arg("--nome", "Admin")!;

  const contaSlug = arg("--conta");

  const prisma = new PrismaClient();
  const senhaHash = await bcrypt.hash(senha, 10);

  const conta = await prisma.conta.findFirst({
    where: contaSlug ? { slug: contaSlug } : {},
    orderBy: { criadaEm: "asc" },
    select: { id: true, nome: true },
  });
  if (!conta) {
    throw new Error(
      contaSlug
        ? `Nenhuma conta com o slug "${contaSlug}".`
        : "Nenhuma conta cadastrada — rode a migration antes.",
    );
  }

  // Garante o papel Administrador (acesso total) e atribui ao admin semeado.
  // Caso o app ainda não tenha rodado o seed do RBAC, cria com todas as chaves.
  const { TODAS_AS_CHAVES } = await import("@ronan/shared-types");
  const papelAdmin = await prisma.papel.upsert({
    where: { contaId_nome: { contaId: conta.id, nome: "Administrador" } },
    update: { permissoes: TODAS_AS_CHAVES, sistema: true },
    create: {
      contaId: conta.id,
      nome: "Administrador",
      descricao: "Acesso total ao sistema.",
      permissoes: TODAS_AS_CHAVES,
      sistema: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { senhaHash, nome, ativo: true, papelId: papelAdmin.id },
    create: { contaId: conta.id, email, senhaHash, nome, papelId: papelAdmin.id },
  });

  console.log(`✓ Admin pronto: ${user.email} (id: ${user.id}) na conta ${conta.nome}`);
  console.log(`  Senha: ${senha}`);
  console.log(`  Use POST /admin/auth/login com email e senha pra obter o token.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
