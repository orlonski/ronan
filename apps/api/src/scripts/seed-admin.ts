/**
 * Seed do primeiro admin.
 * Uso: cd apps/api && pnpm seed:admin -- --email user@x --senha minhasenha --nome "Fulano"
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

  const prisma = new PrismaClient();
  const senhaHash = await bcrypt.hash(senha, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { senhaHash, nome, perfil: "ADMIN", ativo: true },
    create: { email, senhaHash, nome, perfil: "ADMIN" },
  });

  console.log(`✓ Admin pronto: ${user.email} (id: ${user.id})`);
  console.log(`  Senha: ${senha}`);
  console.log(`  Use POST /admin/auth/login com email e senha pra obter o token.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
