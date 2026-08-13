// Seed pra verificar o relatório de produção.
// Roda de dentro de apps/api: node .seed-relatorios.cjs
const { PrismaClient, Prisma } = require("@prisma/client");
const bcrypt = require("bcrypt");
const p = new PrismaClient();

const D = (v) => new Prisma.Decimal(v);
const dia = (d) => new Date(`2026-07-${String(d).padStart(2, "0")}`);

async function main() {
  await p.viagem.deleteMany({ where: { ticket: { startsWith: "RELT-" } } });
  await p.pedagio.deleteMany({ where: { pracaPedagio: { startsWith: "RELT-" } } });

  const senhaHash = await bcrypt.hash("admin123", 10);

  // O papel Administrador é semeado pela API no boot (PermissoesService).
  // Dois usuários de propósito: um com tudo, outro SEM viagens.ver-comercial,
  // pra provar o gate de dimensão/coluna comercial do relatório.
  const admin = await p.papel.findUnique({ where: { nome: "Administrador" } });
  if (!admin) throw new Error("Suba a API uma vez antes: ela semeia o papel Administrador.");

  const semComercial = await p.papel.upsert({
    where: { nome: "Frota terceira (teste)" },
    update: { permissoes: admin.permissoes.filter((c) => c !== "viagens.ver-comercial") },
    create: {
      nome: "Frota terceira (teste)",
      permissoes: admin.permissoes.filter((c) => c !== "viagens.ver-comercial"),
    },
  });

  const user = await p.user.upsert({
    where: { email: "relt@schaba.com.br" },
    update: { papelId: admin.id },
    create: { email: "relt@schaba.com.br", nome: "Admin Relatorio", senhaHash, papelId: admin.id },
  });
  await p.user.upsert({
    where: { email: "relt-frota@schaba.com.br" },
    update: { papelId: semComercial.id },
    create: {
      email: "relt-frota@schaba.com.br", nome: "Gestor Frota",
      senhaHash, papelId: semComercial.id,
    },
  });

  const empresa = await p.empresa.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: { id: "00000000-0000-4000-8000-000000000001", nome: "Construtora Alfa", papel: "AMBOS" },
  });

  const cliente = await p.cliente.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    update: {},
    create: { id: "00000000-0000-4000-8000-000000000002", nome: "Obra Centro", empresaId: empresa.id },
  });
  const cliente2 = await p.cliente.upsert({
    where: { id: "00000000-0000-4000-8000-000000000012" },
    update: {},
    create: { id: "00000000-0000-4000-8000-000000000012", nome: "Obra Norte", empresaId: empresa.id },
  });

  const areia = await p.material.upsert({
    where: { nome: "Areia RELT" },
    update: {},
    create: { nome: "Areia RELT" },
  });
  const brita = await p.material.upsert({
    where: { nome: "Brita RELT" },
    update: {},
    create: { nome: "Brita RELT" },
  });

  const veiculo = await p.veiculo.upsert({
    where: { placa: "RLT1A23" },
    update: {},
    create: { placa: "RLT1A23", modelo: "Scania R450" },
  });

  const m1 = await p.motorista.upsert({
    where: { cpf: "11122233344" },
    update: {},
    create: { cpf: "11122233344", nome: "Joao da Silva", senhaHash, status: "APROVADO" },
  });
  const m2 = await p.motorista.upsert({
    where: { cpf: "55566677788" },
    update: {},
    create: { cpf: "55566677788", nome: "Pedro Souza", senhaHash, status: "APROVADO" },
  });

  const lc = await p.local.upsert({
    where: { id: "00000000-0000-4000-8000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000003",
      nome: "Pedreira Sul", tipo: "CARGA",
      logradouro: "Rod BR-376 km 10", cidade: "Maringa", uf: "PR",
    },
  });
  const ld = await p.local.upsert({
    where: { id: "00000000-0000-4000-8000-000000000004" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000004",
      nome: "Obra Centro", tipo: "DESCARGA",
      logradouro: "Av Brasil 1000", cidade: "Maringa", uf: "PR",
    },
  });

  // Regra de mínimo: 25t para Areia da Alfa na faixa 0-100km.
  // Serve pra provar que o "faturado" diverge do "real" no relatório.
  await p.regraMinimo.deleteMany({ where: { empresaId: empresa.id, materialId: areia.id } });
  await p.regraMinimo.create({
    data: {
      empresaId: empresa.id, materialId: areia.id,
      kmFaixaDe: D(0), kmFaixaAte: D(100),
      toneladasMinimo: D(25), kmMinimo: D(40),
      ativo: true,
    },
  });

  const viagens = [
    // João / Areia / abaixo do mínimo (20t, 30km) → deve faturar 25t e 40km
    { n: 1, mot: m1, cli: cliente, mat: areia, dia: 3, ton: 20, km: 30, ped: 12.4 },
    { n: 2, mot: m1, cli: cliente, mat: areia, dia: 5, ton: 22, km: 35, ped: 12.4 },
    // João / Areia / acima do mínimo → real vale
    { n: 3, mot: m1, cli: cliente, mat: areia, dia: 8, ton: 30, km: 60, ped: null },
    // João / Brita (sem regra) → real sempre
    { n: 4, mot: m1, cli: cliente2, mat: brita, dia: 10, ton: 28, km: 55, ped: 20 },
    // Pedro / Areia abaixo do mínimo
    { n: 5, mot: m2, cli: cliente, mat: areia, dia: 12, ton: 18, km: 25, ped: 12.4 },
    { n: 6, mot: m2, cli: cliente2, mat: brita, dia: 15, ton: 31.5, km: 80, ped: null },
  ];

  for (const v of viagens) {
    await p.viagem.create({
      data: {
        clientId: `relt-${v.n}`,
        motoristaId: v.mot.id, veiculoId: veiculo.id,
        clienteId: v.cli.id, materialId: v.mat.id,
        data: dia(v.dia), toneladas: D(v.ton), km: D(v.km),
        ticket: `RELT-${v.n}`, status: "OK",
        localCargaId: lc.id, localDescargaId: ld.id,
        valorPedagioTotal: v.ped != null ? D(v.ped) : null,
      },
    });
  }

  // ARMADILHA 1: viagem sem peso. NÃO pode entrar no relatório (viraria 0t).
  await p.viagem.create({
    data: {
      clientId: "relt-semp", motoristaId: m1.id, veiculoId: veiculo.id,
      clienteId: cliente.id, materialId: areia.id,
      data: dia(20), toneladas: null, km: D(45),
      ticket: "RELT-SEMPESO", status: "AGUARDANDO_PESO",
      localCargaId: lc.id, localDescargaId: ld.id,
    },
  });

  // ARMADILHA 2: viagem em andamento. Também fora.
  await p.viagem.create({
    data: {
      clientId: "relt-andando", motoristaId: m2.id, veiculoId: veiculo.id,
      data: dia(21), ticket: "RELT-ANDANDO", status: "EM_ANDAMENTO",
      localCargaId: lc.id,
    },
  });

  // ARMADILHA 3: viagem FORA do período (agosto). Não pode aparecer no de julho.
  await p.viagem.create({
    data: {
      clientId: "relt-fora", motoristaId: m1.id, veiculoId: veiculo.id,
      clienteId: cliente.id, materialId: areia.id,
      data: new Date("2026-08-05"), toneladas: D(99), km: D(99),
      ticket: "RELT-FORA", status: "OK",
      localCargaId: lc.id, localDescargaId: ld.id,
    },
  });

  // Pedágios praça a praça: 1 vinculado a viagem + 1 avulso.
  // Provam a reconciliação — NÃO podem ser somados ao total do relatório.
  const v1 = await p.viagem.findUnique({ where: { clientId: "relt-1" } });
  await p.pedagio.create({
    data: {
      clientId: "relt-ped-1", veiculoId: veiculo.id, motoristaId: m1.id,
      data: dia(3), pracaPedagio: "RELT-Praca A", valor: D(12.4), viagemId: v1.id,
    },
  });
  await p.pedagio.create({
    data: {
      clientId: "relt-ped-2", veiculoId: veiculo.id, motoristaId: m2.id,
      data: dia(18), pracaPedagio: "RELT-Praca B avulso", valor: D(33.7),
    },
  });

  console.log("seed ok — user:", user.email);
}

main().finally(() => p.$disconnect());
