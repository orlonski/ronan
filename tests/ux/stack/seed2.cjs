// Complemento do seed (tokens públicos, CT-e, assinatura). Roda depois do seed.cjs. Só banco temporário.
// (origem: harness uxaudit) Complemento do seed: tokens públicos, CT-e, assinatura. Idempotente o bastante pra rodar uma vez após seed.cjs.
const path = require("path");
const API = path.resolve(__dirname, "../../../apps/api");
const { PrismaClient } = require(require.resolve("@prisma/client", { paths: [API] }));
const fs = require("fs");
if (!/localhost:\d+\/uxmedidas$/.test(process.env.DATABASE_URL || "")) { console.error("banco errado"); process.exit(1); }
const prisma = new PrismaClient();
(async () => {
  const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".stack", "seed-ids.json")));
  const C = ids.contaId;
  const exp = new Date(Date.now() + 30 * 864e5);
  await prisma.viagemCompartilhamento.create({ data: { contaId: C, viagemId: ids.viagem, token: "tokenviagem123456", expiraEm: exp } }).catch((e) => console.log("compart", e.message.slice(-150)));
  await prisma.conviteColeta.create({ data: { contaId: C, motoristaId: ids.motorista, token: "tokencoleta123456", expiraEm: exp } }).catch((e) => console.log("coleta", e.message.slice(-150)));
  const ass = await prisma.assinatura.create({ data: { contaId: C, status: "RASCUNHO", forma: "PIX", valorCentavos: 189000, nomeResponsavel: "Fulano", emailCobranca: "f@modelo.test", telefoneCobranca: "41999990000", documento: "11222333000181", tokenPagamento: "tokenpagar123456", proximoVencimento: exp } }).catch((e) => console.log("assin", e.message.slice(-150)));
  if (ass) await prisma.cobrancaAssinatura.create({ data: { assinaturaId: ass.id, contaId: C, competencia: new Date(), vencimento: exp, valorCentavos: 189000, linkPagamento: "https://example.test/pagar" } }).catch((e) => console.log("cobr", e.message.slice(-150)));
  const v = ids.viagem;
  await prisma.documentoFiscal.create({ data: { contaId: C, viagemId: v, modelo: "57", serie: 1, numero: 1, chave: "41260911222333000181570010000000011000000019", ambiente: 2, emissor: "DIRETO", payload: {} } }).catch((e) => console.log("cte", e.message.slice(-150)));
  await prisma.execucaoAgente.create({ data: { taskId: 'demo-1', status: 'CONCLUIDA', payload: { titulo: 'Melhorar a tela de viagens', descricao: 'Pedido de exemplo' }, resumo: 'Feito.' } }).catch((e) => console.log('exec', e.message.slice(-150)));
  await prisma.$disconnect();
})();
