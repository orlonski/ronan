// Seed pra verificar a aba "Pedágios" do histórico (viagens com pedágio).
// Rodar de dentro de apps/api: node .seed-pedagio-aba.cjs
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const CPF = "39053344705";
const SENHA = "senha123";
const MES = new Date();
const ano = MES.getUTCFullYear();
const mes = MES.getUTCMonth(); // 0-based

function dia(d) {
  return new Date(Date.UTC(ano, mes, d));
}

async function main() {
  const empresa = await prisma.empresa.upsert({
    where: { cnpj: "11222333000181" },
    update: {},
    create: { nome: "Schaba Teste", cnpj: "11222333000181" },
  });

  const cliente = await prisma.cliente.upsert({
    where: { id: "c0000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "c0000000-0000-4000-8000-000000000001",
      nome: "Cliente Pedagio",
      empresaId: empresa.id,
    },
  });

  const material = await prisma.material.upsert({
    where: { id: "m0000000-0000-4000-8000-000000000001" },
    update: {},
    create: { id: "m0000000-0000-4000-8000-000000000001", nome: "Areia" },
  });

  const veiculo = await prisma.veiculo.upsert({
    where: { placa: "ABC1D23" },
    update: {},
    create: { placa: "ABC1D23" },
  });

  const motorista = await prisma.motorista.upsert({
    where: { cpf: CPF },
    update: { status: "APROVADO", senhaHash: await bcrypt.hash(SENHA, 10) },
    create: {
      nome: "Motorista Teste",
      cpf: CPF,
      senhaHash: await bcrypt.hash(SENHA, 10),
      status: "APROVADO",
      podeLancarViagem: true,
    },
  });

  const mkLocal = (id, nome) =>
    prisma.local.upsert({
      where: { id },
      update: {},
      create: {
        id,
        nome,
        tipo: "AMBOS",
        logradouro: "Rua Teste, 100",
        cidade: "Curitiba",
        uf: "PR",
        lat: -25.43,
        lng: -49.27,
      },
    });

  const carga = await mkLocal("10000000-0000-4000-8000-000000000001", "Pedreira Norte");
  const descarga = await mkLocal("10000000-0000-4000-8000-000000000002", "Obra Centro");

  const base = {
    motoristaId: motorista.id,
    veiculoId: veiculo.id,
    clienteId: cliente.id,
    materialId: material.id,
    localCargaId: carga.id,
    localDescargaId: descarga.id,
    km: 120,
  };

  const casos = [
    { clientId: "seed-pedagio-1", ticket: "T-COM-45", data: dia(3), toneladas: 30, valorPedagioTotal: 45.5, status: "ENVIADA" },
    { clientId: "seed-pedagio-2", ticket: "T-COM-12", data: dia(5), toneladas: 28, valorPedagioTotal: 12.3, status: "OK" },
    { clientId: "seed-pedagio-3", ticket: "T-ZERO", data: dia(7), toneladas: 31, valorPedagioTotal: 0, status: "ENVIADA" },
    { clientId: "seed-pedagio-4", ticket: "T-NULL", data: dia(9), toneladas: 29, valorPedagioTotal: null, status: "ENVIADA" },
    // Caso que denuncia o where errado no contador: aguardando peso COM pedágio.
    { clientId: "seed-pedagio-5", ticket: "T-PESO", data: dia(11), toneladas: 0, valorPedagioTotal: 99.9, status: "AGUARDANDO_PESO" },
    // Fora do feed: EM_ANDAMENTO nunca aparece.
    { clientId: "seed-pedagio-6", ticket: "T-ANDAMENTO", data: dia(13), toneladas: 0, valorPedagioTotal: 77.7, status: "EM_ANDAMENTO" },
  ];

  for (const c of casos) {
    await prisma.viagem.upsert({
      where: { clientId: c.clientId },
      update: { valorPedagioTotal: c.valorPedagioTotal, status: c.status },
      create: { ...base, ...c },
    });
  }

  console.log(JSON.stringify({ motoristaId: motorista.id, cpf: CPF, senha: SENHA, mes: `${ano}-${String(mes + 1).padStart(2, "0")}` }, null, 2));
}

main().finally(() => prisma.$disconnect());
