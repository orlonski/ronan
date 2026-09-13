// API falsa pras gravações do app NATIVO.
//
// No PWA dava pra interceptar `/m/*` dentro do navegador. No nativo não existe
// esse gancho: o app fala com a rede de verdade. E o padrão dele é PRODUÇÃO —
// `lib/api-url.ts` cai em https://api.schaba.com.br quando EXPO_PUBLIC_API_URL
// não está setada. Gravar sem isto criaria dados reais no cliente.
//
//   node marketing/reels/api-falsa.mjs          # sobe em :4599
//   EXPO_PUBLIC_API_URL=http://127.0.0.1:4599 npx expo run:ios
//
// Derrubar este processo é o jeito de simular queda de rede (Ctrl+C ou SIGSTOP).
import { createServer } from "node:http";

const PORTA = Number(process.env.PORTA ?? 4599);
const T = { accessToken: "falso-access", refreshToken: "falso-refresh" };
const CONTA = { motoristaId: "m-aurora", contaId: "conta-aurora", contaNome: "Transportes Aurora", status: "APROVADO" };

const VEICULO = { id: "7a1f2c94-5e63-4b81-9d20-3f6a8c14e5b7", placa: "AZW-4G18", modelo: "Scania R450" };
const CLIENTE = { id: "1d84f6a2-9c37-4e50-b1a8-6f2c35d97e01", nome: "Mineração Boa Vista", empresa: { id: "b3c9d47e-2a15-4f68-8c03-9e7b1d5a2f46", nome: "Transportes Aurora" } };
const MATERIAL = { id: "4e72b8d1-3f96-42ac-85b7-0c19d6a4f38e", nome: "Areia Média", exigeTicket: false, permiteBotaFora: false };
const LOCAIS = [
  { id: "92af5c07-6b41-4d38-a5e9-7c30f1b82d64", nome: "Areal Boa Vista", tipo: "CARGA", cidade: "Balsa Nova", uf: "PR", logradouro: "Rod. do Xisto, km 12", lat: -25.4921, lng: -49.6312, raioMetros: 300 },
  { id: "5c018e3b-7d92-4a16-93f4-2b85c67e0a19", nome: "Obra Contorno Leste", tipo: "DESCARGA", cidade: "São José dos Pinhais", uf: "PR", logradouro: "BR-116, km 84", lat: -25.5307, lng: -49.2064, raioMetros: 300 },
];
const ME = {
  id: "m-aurora", nome: "Adilson Ferreira", cpf: "00000000000", status: "APROVADO",
  contaNome: "Transportes Aurora",
  podeLancarViagem: true, podeIniciarViagem: true, podeViagemLifecycle: true,
  podeUsarOcrTicket: true, podeVerStories: false, podeTelemetria: false,
};

const rotas = [
  [/\/m\/auth\/login$/, () => ({ ...T, status: "APROVADO", identidade: T, cadastros: [{ ...CONTA, ...T }] })],
  [/\/m\/auth\/refresh$/, () => T],
  [/\/m\/me$/, () => ME],
  [/\/m\/catalogos/, () => ({ veiculos: [VEICULO], empresas: [{ id: CLIENTE.empresa.id, nome: CLIENTE.empresa.nome }], clientes: [CLIENTE], materiais: [MATERIAL], locais: LOCAIS })],
  [/\/m\/viagens/, (m) => (m === "POST" ? { id: "viagem-nova", clientId: "cli-1", status: "AGUARDANDO_PESO" } : { itens: [], nextCursor: null })],
  [/\/m\/locais\/proximos/, () => LOCAIS.filter((l) => l.tipo === "DESCARGA")],
  [/\/m\/abastecimentos\/postos-recentes/, () => ["Posto Trevo BR-376", "Auto Posto Aurora", "Graal Ponta Grossa"]],
  [/\/m\/notificacoes/, () => ({ itens: [], naoLidas: 0 })],
];

let enviadas = 0;
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const achou = rotas.find(([re]) => re.test(req.url ?? ""));
    const dado = achou ? achou[1](req.method, corpo) : {};
    if (req.method === "POST" && /\/m\/viagens/.test(req.url ?? "")) enviadas++;
    console.log(`${req.method} ${req.url} -> ${achou ? "mock" : "VAZIO (rota não mapeada)"}`);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(dado));
  });
});

// O contador é a prova de que o vídeo não mente: se a viagem não subiu quando a
// rede voltou, ele fica em zero.
process.on("SIGINT", () => {
  console.log(`\nviagens recebidas: ${enviadas}`);
  process.exit(0);
});
servidor.listen(PORTA, "0.0.0.0", () => console.log(`api falsa em http://127.0.0.1:${PORTA}`));
