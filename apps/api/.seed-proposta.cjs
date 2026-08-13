// Seed de vitrine pra proposta comercial: dados 100% fictícios (nenhum dado real
// de cliente entra em screenshot). Roda de dentro de apps/api pra resolver o
// @prisma/client. Apaga a base de demonstração antes de recriar.
const { PrismaClient, Prisma } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

const D = (n) => new Prisma.Decimal(n.toFixed(3));
const dia = 24 * 60 * 60 * 1000;
const hoje = new Date("2026-08-11T12:00:00-03:00");
const dataDe = (d) => new Date(hoje.getTime() - d * dia);
const soData = (dt) => new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));

// gerador determinístico (mesma vitrine em toda re-execução)
let _s = 20260811;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const entre = (a, b) => a + rnd() * (b - a);

function cpfValido(base9) {
  const n = base9.split("").map(Number);
  const dv = (arr, peso) => {
    const s = arr.reduce((acc, v, i) => acc + v * (peso - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n, 10);
  const d2 = dv([...n, d1], 11);
  return base9 + d1 + d2;
}

const hav = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// polyline Google precision 5 — pra desenhar o trajeto no detalhe da viagem
function encodePolyline(pts) {
  let out = "", plat = 0, plng = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    out += enc(lat - plat) + enc(lng - plng);
    plat = lat; plng = lng;
  }
  return out;
}
// trajeto sinuoso plausível entre dois pontos
function geometriaEntre(a, b) {
  const pts = [{ lat: a.lat, lng: a.lng }];
  const n = 14;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const desvio = Math.sin(t * Math.PI) * 0.018 * (i % 2 ? 1 : -1);
    pts.push({ lat: a.lat + (b.lat - a.lat) * t + desvio * 0.5, lng: a.lng + (b.lng - a.lng) * t + desvio });
  }
  pts.push({ lat: b.lat, lng: b.lng });
  return encodePolyline(pts);
}

async function limpar() {
  const ordem = [
    "story_reacoes", "story_visualizacoes", "stories",
    "denuncias_mensagem_chat", "bloqueios_chat", "mensagens_chat", "conversa_participantes", "conversas",
    "eventos_motorista", "viagem_mensagens", "viagem_compartilhamentos",
    "fechamento_linhas", "envios_fechamento", "fechamentos",
    "layouts_envio", "layout_import_blocos",
    "eventos_viagem", "trechos_viagem", "viagem_pontos", "ticket_fotos", "pedagios",
    "abastecimento_fotos", "abastecimentos", "viagens",
    "rota_cache", "local_evidencia", "local_cliente", "locais",
    "motorista_posicoes", "motorista_posicao_config", "motorista_veiculo", "motorista_documento",
    "cadastros_motorista_pendentes", "redefinicoes_senha_pendentes", "notificacoes",
    "motoristas", "veiculos", "regras_minimo", "clientes", "empresas", "materiais",
    "usuario_transportadoras", "transportadoras",
    "audit_logs", "error_logs", "admin_notificacoes", "whatsapp_mensagens", "whatsapp_convites", "whatsapp_sessoes",
    "tipos_evento_viagem", "pedagios_rodovia", "geocoding_cache",
  ];
  for (const t of ordem) {
    try { await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`); }
    catch (e) { /* tabela pode não existir nessa versão */ }
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE email <> 'admin@ronan.local'`);
  console.log("base limpa");
}

async function main() {
  await limpar();

  const senhaHash = await bcrypt.hash("demo1234", 10);

  // ---------- papéis ----------
  const todasPerms = (await prisma.permissao.findMany({ select: { chave: true } })).map((p) => p.chave);
  const papelAdmin = await prisma.papel.upsert({
    where: { nome: "Administrador" },
    update: { permissoes: todasPerms },
    create: { nome: "Administrador", descricao: "Acesso total ao sistema", permissoes: todasPerms, sistema: true },
  });
  const permOperacao = todasPerms.filter((c) => /^(viagens|abastecimentos|motoristas|veiculos|locais|mapa|inbox|notificacoes)\./.test(c) && !/excluir|expurgar/.test(c));
  const papelOperacao = await prisma.papel.upsert({
    where: { nome: "Operação" },
    update: { permissoes: permOperacao },
    create: { nome: "Operação", descricao: "Lançamentos, conferência e acompanhamento da frota", permissoes: permOperacao },
  });
  const permFin = todasPerms.filter((c) => /^(fechamentos|envios|empresas|clientes|regras-minimo|viagens)\./.test(c) && !/excluir/.test(c));
  await prisma.papel.upsert({
    where: { nome: "Financeiro" },
    update: { permissoes: permFin },
    create: { nome: "Financeiro", descricao: "Conciliação, faturamento e envio às tomadoras", permissoes: permFin },
  });
  const permFrota = todasPerms.filter((c) => /^(viagens\.(ver|listar)|motoristas\.(ver|listar)|veiculos\.(ver|listar)|mapa\.)/.test(c));
  const papelFrota = await prisma.papel.upsert({
    where: { nome: "Gestor de frota terceira" },
    update: { permissoes: permFrota },
    create: { nome: "Gestor de frota terceira", descricao: "Vê apenas a operação da própria frota, sem dados comerciais", permissoes: permFrota },
  });

  // ---------- usuários ----------
  const admin = await prisma.user.upsert({
    where: { email: "admin@ronan.local" },
    update: { nome: "Marcos Andrade", papelId: papelAdmin.id, acessoGlobal: true, ativo: true, senhaHash, ultimoLoginEm: dataDe(0) },
    create: { nome: "Marcos Andrade", email: "admin@ronan.local", senhaHash, papelId: papelAdmin.id, ultimoLoginEm: dataDe(0) },
  });
  await prisma.user.create({ data: { nome: "Juliana Prado", email: "juliana@alvorada.com.br", senhaHash, papelId: papelOperacao.id, ultimoLoginEm: dataDe(0), criadoPorId: admin.id } });
  await prisma.user.create({ data: { nome: "Rafael Menezes", email: "financeiro@alvorada.com.br", senhaHash, papelId: (await prisma.papel.findUnique({ where: { nome: "Financeiro" } })).id, ultimoLoginEm: dataDe(1), criadoPorId: admin.id } });

  // ---------- transportadoras ----------
  const t1 = await prisma.transportadora.create({ data: { nome: "Transportes Alvorada", cnpj: "18432770000164", contato: "(41) 3555-2100", criadoPorId: admin.id } });
  const t2 = await prisma.transportadora.create({ data: { nome: "Frota Bandeirantes", cnpj: "24907315000188", contato: "(42) 3622-4410", criadoPorId: admin.id } });

  const userFrota = await prisma.user.create({ data: { nome: "Elton Bandeira", email: "elton@bandeirantes.com.br", senhaHash, papelId: papelFrota.id, acessoGlobal: false, ultimoLoginEm: dataDe(2), criadoPorId: admin.id } });
  await prisma.usuarioTransportadora.create({ data: { usuarioId: userFrota.id, transportadoraId: t2.id } });

  // ---------- empresas / clientes ----------
  const e1 = await prisma.empresa.create({ data: { nome: "Construtora Vale Verde", cnpj: "07994431000152", contato: "(41) 3021-8800", papel: "AMBOS", toleranciaKmPct: 5, toleranciaTonPct: 2, criadoPorId: admin.id } });
  const e2 = await prisma.empresa.create({ data: { nome: "Mineração Serra Azul", cnpj: "11570862000107", contato: "(42) 3225-9000", papel: "RECEBE_PLANILHA", toleranciaKmPct: 3, toleranciaTonPct: 0, criadoPorId: admin.id } });

  const clientes = [];
  for (const [nome, empresaId] of [
    ["Obra Contorno Leste", e1.id], ["Terminal Rodoviário Norte", e1.id],
    ["Pátio Industrial CIC", e2.id], ["Loteamento Jardim Aurora", e2.id],
  ]) clientes.push(await prisma.cliente.create({ data: { nome, empresaId, criadoPorId: admin.id } }));

  // ---------- materiais ----------
  const mats = {};
  for (const [nome, exigeTicket, botaFora] of [
    ["Brita 1", true, true], ["Brita 0", true, true], ["Areia Média", true, false],
    ["Saibro", true, true], ["Pó de Pedra", true, false], ["Concreto Usinado", false, false],
  ]) mats[nome] = await prisma.material.create({ data: { nome, exigeTicket, permiteBotaFora: botaFora, criadoPorId: admin.id } });
  const matsArr = Object.values(mats);

  // ---------- regras de mínimo ----------
  await prisma.regraMinimo.createMany({ data: [
    { empresaId: e1.id, materialId: null, kmFaixaDe: D(0), kmFaixaAte: D(20), kmMinimo: D(20), toneladasMinimo: D(24), criadoPorId: admin.id },
    { empresaId: e1.id, materialId: mats["Brita 1"].id, kmFaixaDe: D(20), kmFaixaAte: D(60), kmMinimo: D(30), toneladasMinimo: D(26), criadoPorId: admin.id },
    { empresaId: e1.id, materialId: null, kmFaixaDe: D(60), kmFaixaAte: null, kmMinimo: null, toneladasMinimo: D(28), criadoPorId: admin.id },
    { empresaId: e2.id, materialId: null, kmFaixaDe: D(0), kmFaixaAte: D(35), kmMinimo: D(25), toneladasMinimo: D(25), criadoPorId: admin.id },
  ] });

  // ---------- veículos ----------
  const placas = [
    ["AZW-4G18", "Volvo FH 540 8x4"], ["BCK-2H07", "Scania R 450 6x4"], ["AQP-1D55", "Mercedes Actros 2651"],
    ["BEE-7J31", "Volvo FMX 500"], ["ARH-3C92", "Iveco Hi-Way 600S44T"], ["BFT-9K46", "DAF XF 480"],
    ["AXM-6B20", "Scania P 360 6x2"], ["BGN-5L83", "Volkswagen Meteor 29.520"],
  ];
  const veics = [];
  for (const [placa, modelo] of placas)
    veics.push(await prisma.veiculo.create({ data: { placa, modelo, transportadoraId: veics.length < 6 ? t1.id : t2.id, criadoPorId: admin.id } }));

  // ---------- motoristas ----------
  const nomes = [
    "Adilson Ferreira", "Cleber Mattos", "Sandro Ribeiro", "Vagner Pinheiro", "Jocimar Teles",
    "Rogério Bastos", "Everton Camargo", "Márcio Nogueira", "Lauro Bittencourt", "Silvio Rocha",
  ];
  const motos = [];
  for (let i = 0; i < nomes.length; i++) {
    const cpf = cpfValido(String(41200000 + i * 137).padStart(9, "0"));
    const t = i < 6 ? t1.id : t2.id;
    motos.push(await prisma.motorista.create({ data: {
      nome: nomes[i], cpf, senhaHash, telefone: `4199${String(1000000 + i * 4321).slice(0, 7)}`,
      veiculoDefaultId: veics[i % veics.length].id, transportadoraId: t,
      status: i === 9 ? "PENDENTE_APROVACAO" : "APROVADO", aprovadoEm: i === 9 ? null : dataDe(80 - i),
      aprovadoPorId: i === 9 ? null : admin.id, criadoPorId: admin.id,
      podeLancarViagem: true, podeIniciarViagem: i < 6, podeViagemLifecycle: i < 6,
      podeLancarPedagio: true, podeLancarAbastecimento: true, podeUsarOcrTicket: i < 7,
      podeVerStories: true, podeReferenciaKm: i < 6, podeChat: true, podeTelemetria: i < 3,
      appVersion: i < 7 ? "1.0.3" : "1.0.2", appPlatform: i % 3 === 0 ? "ios" : "android",
      appCanal: "production", appVistoEm: dataDe(rnd() * 2), ultimoLoginEm: dataDe(rnd() * 3),
      receberResumoDiario: true,
    } }));
    await prisma.motoristaVeiculo.create({ data: { motoristaId: motos[i].id, veiculoId: veics[i % veics.length].id } }).catch(() => {});
  }

  // ---------- locais ----------
  const defLocais = [
    ["Pedreira Serra Azul", "Rodovia do Café, s/n", "Campo Largo", "PR", -25.4589, -49.528, "CARGA"],
    ["Pedreira Rio Verde", "BR-376, km 502", "Ponta Grossa", "PR", -25.0916, -50.1668, "CARGA"],
    ["Areal Boa Vista", "Estrada do Cerne, km 14", "Balsa Nova", "PR", -25.58, -49.63, "CARGA"],
    ["Britagem São Luiz", "Av. das Araucárias, 4200", "Araucária", "PR", -25.593, -49.41, "CARGA"],
    ["Usina de Asfalto Km 118", "BR-277, km 118", "Palmeira", "PR", -25.429, -49.999, "AMBOS"],
    ["Obra Contorno Leste", "Contorno Leste, km 8", "São José dos Pinhais", "PR", -25.535, -49.205, "DESCARGA"],
    ["Terminal Rodoviário Norte", "Rua Antônio Zaitter, 1500", "Colombo", "PR", -25.292, -49.224, "DESCARGA"],
    ["Pátio Industrial CIC", "Av. Juscelino K. de Oliveira, 9100", "Curitiba", "PR", -25.478, -49.35, "DESCARGA"],
    ["Loteamento Jardim Aurora", "Rua das Palmeiras, 300", "Fazenda Rio Grande", "PR", -25.662, -49.307, "DESCARGA"],
    ["Duplicação BR-277 Lote 3", "BR-277, km 132", "Campo Largo", "PR", -25.465, -49.59, "DESCARGA"],
    ["Terraplenagem Vila Nova", "Rua Sete de Setembro, 890", "Araucária", "PR", -25.601, -49.398, "DESCARGA"],
  ];
  const locais = [];
  for (const [nome, logradouro, cidade, uf, lat, lng, tipo] of defLocais)
    locais.push(await prisma.local.create({ data: {
      nome, logradouro, cidade, uf, lat, lng, tipo, cep: "83600000", criadoPorId: admin.id,
      nivelConfianca: "HUMANO", origemCadastro: "ADMIN_MANUAL",
    } }));
  // dois locais nascidos no app, ainda em validação
  const emValidacao = [];
  for (const [nome, cidade, lat, lng, nivel, origem] of [
    ["Obra Ponte Rio Verde", "Ponta Grossa", -25.1105, -50.1402, "DWELL_CONFIRMADO", "MOTORISTA_RAPIDO"],
    ["Pátio Provisório KM 9", "Campo Largo", -25.4491, -49.5622, "PRESENCA_PONTUAL", "MOTORISTA_FORMULARIO"],
  ]) {
    emValidacao.push(await prisma.local.create({ data: {
      nome, logradouro: "Sem número", cidade, uf: "PR", lat, lng, tipo: "DESCARGA",
      nivelConfianca: nivel, origemCadastro: origem, criadoPorMotoristaId: motos[2].id,
      latLngPrecisao: 12.4, latLngFonte: "PRECISA", contadorValidacoes: nivel === "DWELL_CONFIRMADO" ? 3 : 1,
      ultimaValidacaoEm: dataDe(2),
    } }));
  }
  const cargas = locais.filter((l) => l.tipo === "CARGA");
  const descargas = locais.filter((l) => l.tipo === "DESCARGA");
  for (const l of descargas) await prisma.localCliente.create({ data: { localId: l.id, clienteId: pick(clientes).id } }).catch(() => {});

  // ---------- praças de pedágio ----------
  await prisma.pedagioRodovia.createMany({ data: [
    { nome: "Praça São Luiz do Purunã", concessionaria: "EPR Litoral Pioneiro", rodovia: "BR-277", cidade: "Balsa Nova", uf: "PR", lat: -25.4472, lng: -49.7231, valorBase: D(4.9), fonte: "manual" },
    { nome: "Praça Cascavel Norte", concessionaria: "Via Araucária", rodovia: "BR-277", cidade: "Cascavel", uf: "PR", lat: -24.9012, lng: -53.4102, valorBase: D(5.4), fonte: "osm", osmId: "node/1001" },
    { nome: "Praça Fernão Dias PR", concessionaria: "Arteris", rodovia: "BR-376", cidade: "Ponta Grossa", uf: "PR", lat: -25.1521, lng: -50.0043, valorBase: D(4.6), fonte: "osm", osmId: "node/1002" },
    { nome: "Praça Contorno Sul", concessionaria: "Via Araucária", rodovia: "BR-116", cidade: "Curitiba", uf: "PR", lat: -25.5602, lng: -49.2891, valorBase: D(4.2), fonte: "manual" },
  ] });

  // ---------- catálogo de eventos da viagem guiada ----------
  const eventos = [
    ["cheguei-carga", "Cheguei no local de carga", 1, true, false, true, false, false, false, false],
    ["carreguei", "Carreguei", 2, true, false, false, false, true, false, true],
    ["sai-carga", "Saí do local de carga", 3, false, false, false, false, false, false, false],
    ["parada", "Parei no caminho", 4, false, true, false, false, false, false, false],
    ["paguei-pedagio", "Paguei pedágio", 5, false, true, false, false, false, true, false],
    ["cheguei-descarga", "Cheguei no local de descarga", 6, true, false, false, true, false, false, false],
    ["descarreguei", "Descarreguei", 7, true, false, false, false, false, false, false],
  ];
  for (const [slug, nome, ordem, obrig, repet, ehCarga, ehDescarga, pedeTon, pedeValor, pedeTicket] of eventos)
    await prisma.tipoEventoViagem.create({ data: {
      slug, nome, ordem, obrigatorio: obrig, repetivel: repet, ehCarga, ehDescarga,
      pedeToneladas: pedeTon, pedeValor, pedeTicket, pedeFoto: slug === "carreguei", criadoPorId: admin.id,
    } });

  // ---------- viagens ----------
  let ticketSeq = 48210;
  const viagensCriadas = [];
  for (let d = 60; d >= 0; d--) {
    const dt = dataDe(d);
    const dow = dt.getDay();
    if (dow === 0) continue;
    const qtd = dow === 6 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < qtd; k++) {
      const mi = Math.floor(rnd() * 9); // o 10º está pendente de aprovação
      const mot = motos[mi];
      const vei = veics[mi % veics.length];
      const carga = pick(cargas), descarga = pick(descargas);
      const cli = pick(clientes);
      const mat = pick(matsArr.slice(0, 5));
      const kmBase = hav(carga, descarga) * entre(1.22, 1.42);
      const km = Math.round(kmBase * 10) / 10;
      const ton = Math.round(entre(22, 31.5) * 100) / 100;
      const atipica = rnd() < 0.05;
      const kmFinal = atipica ? Math.round(km * entre(1.45, 1.75) * 10) / 10 : km;
      let status = "OK";
      const r = rnd();
      if (d <= 6) status = r < 0.45 ? "ENVIADA" : r < 0.7 ? "EM_CONFERENCIA" : "OK";
      else if (r < 0.05) status = "DIVERGENTE";
      const guiada = rnd() < 0.45 && mi < 6;
      const v = await prisma.viagem.create({ data: {
        clientId: `demo-${d}-${k}-${ticketSeq}`,
        motoristaId: mot.id, veiculoId: vei.id, clienteId: cli.id, materialId: mat.id,
        data: soData(dt), toneladas: D(ton), ticket: String(ticketSeq++),
        km: D(kmFinal), kmCalculado: D(km), kmEditadoManual: atipica,
        kmFonte: atipica ? "MANUAL" : guiada ? "ROTA_OSRM" : pick(["ROTA_OSRM", "ROTA_ESCOLHIDA", "HISTORICO"]),
        kmForaDoPadrao: atipica || null,
        kmReferencia: atipica ? D(km) : null, kmReferenciaFonte: atipica ? "HISTORICO" : null,
        kmReferenciaAmostra: atipica ? 11 : null,
        kmDesvioPct: atipica ? new Prisma.Decimal((((kmFinal - km) / km) * 100).toFixed(2)) : null,
        kmAvaliadoEm: atipica ? dt : null,
        status, iniciadaGuiada: guiada,
        localCargaId: carga.id, localDescargaId: descarga.id,
        valorPedagioTotal: rnd() < 0.35 ? D(entre(18, 46)) : null,
        rotaGeometria: geometriaEntre(carga, descarga),
        lat: carga.lat + entre(-0.001, 0.001), lng: carga.lng + entre(-0.001, 0.001),
        cargaLat: carga.lat + entre(-0.0008, 0.0008), cargaLng: carga.lng + entre(-0.0008, 0.0008),
        cargaPrecisao: entre(4, 22), cargaFonte: pick(["PRECISA", "PRECISA", "BALANCED"]),
        cargaDistanciaMetros: Math.round(entre(5, 90)), cargaRaioUsadoM: 150,
        descargaLat: descarga.lat + entre(-0.0009, 0.0009), descargaLng: descarga.lng + entre(-0.0009, 0.0009),
        descargaPrecisao: entre(5, 28), descargaFonte: pick(["PRECISA", "PRECISA", "BALANCED", "CACHE"]),
        descargaDistanciaMetros: Math.round(entre(8, 140)), descargaRaioUsadoM: rnd() < 0.2 ? 500 : 150,
        descargaBuscaOffline: rnd() < 0.25,
        transportadoraId: mot.transportadoraId,
        appVersaoCriacao: mot.appVersion,
        sincronizadoEm: new Date(dt.getTime() + entre(6, 16) * 3600 * 1000),
        criadoOfflineEm: rnd() < 0.3 ? new Date(dt.getTime() + 5 * 3600 * 1000) : null,
        revisadoEm: status === "OK" ? new Date(dt.getTime() + 30 * 3600 * 1000) : null,
        revisadoPorId: status === "OK" ? admin.id : null,
        tipoDivergencia: status === "DIVERGENTE" ? pick(["PEDAGIO_SEM_VALOR", "FOTO_ILEGIVEL", "KM_DIVERGENTE"]) : null,
        motivoStatus: status === "DIVERGENTE" ? "Rota passa por praça de pedágio e o valor não foi informado." : null,
        ocrCampos: rnd() < 0.5 ? ["ticket", "toneladas", "data"] : [],
        ocrConfidence: rnd() < 0.5 ? Math.round(entre(0.86, 0.99) * 100) / 100 : null,
      } });
      viagensCriadas.push(v);
    }
  }

  // viagens em andamento (aparecem na tela "Ao vivo")
  for (let i = 0; i < 3; i++) {
    const mot = motos[i], carga = pick(cargas);
    const v = await prisma.viagem.create({ data: {
      clientId: `demo-andamento-${i}`, motoristaId: mot.id, veiculoId: veics[i].id,
      status: "EM_ANDAMENTO", iniciadaGuiada: true, localCargaId: carga.id,
      iniciadoEm: new Date(hoje.getTime() - (1 + i) * 3600 * 1000),
      cargaLat: carga.lat, cargaLng: carga.lng, cargaPrecisao: 8.2, cargaFonte: "PRECISA",
      transportadoraId: mot.transportadoraId, appVersaoCriacao: "1.0.3",
    } });
    const tipos = await prisma.tipoEventoViagem.findMany({ orderBy: { ordem: "asc" }, take: 2 + i });
    for (let j = 0; j < tipos.length; j++)
      await prisma.eventoViagem.create({ data: {
        id: `demo-ev-${i}-${j}`, viagemId: v.id, tipoEventoId: tipos[j].id, tipoSlug: tipos[j].slug, ocorridoEm: new Date(hoje.getTime() - (1 + i) * 3600 * 1000 + j * 22 * 60000),
        lat: carga.lat, lng: carga.lng, precisao: 9.1, localId: carga.id,
      } }).catch((e) => { if (j === 0) console.log("evento:", e.message.split("\n")[0]); });
  }
  // duas aguardando peso
  for (let i = 0; i < 2; i++) {
    const mot = motos[3 + i];
    await prisma.viagem.create({ data: {
      clientId: `demo-peso-${i}`, motoristaId: mot.id, veiculoId: veics[3 + i].id,
      clienteId: clientes[i].id, materialId: matsArr[i].id, data: soData(dataDe(0)),
      km: D(entre(30, 70)), status: "AGUARDANDO_PESO",
      localCargaId: cargas[i].id, localDescargaId: descargas[i].id,
      transportadoraId: mot.transportadoraId, appVersaoCriacao: "1.0.3",
    } });
  }

  // ---------- pedágios avulsos ----------
  const pracas = ["Praça São Luiz do Purunã", "Praça Contorno Sul", "Praça Fernão Dias PR"];
  for (let i = 0; i < 40; i++) {
    const v = pick(viagensCriadas);
    await prisma.pedagio.create({ data: {
      clientId: `demo-ped-${i}`, veiculoId: v.veiculoId, motoristaId: v.motoristaId,
      data: v.data, pracaPedagio: pick(pracas), valor: D(entre(18.4, 49.6)),
      viagemId: v.id, transportadoraId: v.transportadoraId,
    } }).catch(() => {});
  }

  // ---------- abastecimentos ----------
  const postos = ["Posto Trevo BR-277", "Auto Posto Colombo", "Posto Rodoserv Palmeira", "Posto Ipiranga Araucária"];
  let odo = 418000;
  for (let i = 0; i < 55; i++) {
    const mot = motos[i % 9];
    const dt = dataDe(Math.floor(rnd() * 60));
    const litros = Math.round(entre(180, 420) * 10) / 10;
    const preco = Math.round(entre(5.72, 6.38) * 1000) / 1000;
    await prisma.abastecimento.create({ data: {
      clientId: `demo-ab-${i}`, motoristaId: mot.id, veiculoId: veics[i % veics.length].id,
      empresaId: rnd() < 0.5 ? e1.id : e2.id, data: dt, tipo: rnd() < 0.9 ? "DIESEL_S10" : "ARLA_32",
      litros: D(litros), valorTotal: D(litros * preco), precoLitro: new Prisma.Decimal(preco.toFixed(3)),
      odometro: (odo += Math.floor(entre(900, 2400))), postoNome: pick(postos), tanqueCheio: rnd() < 0.8,
      transportadoraId: mot.transportadoraId,
      lat: -25.4 + entre(-0.3, 0.3), lng: -49.4 + entre(-0.4, 0.4), precisao: entre(6, 30),
    } }).catch(() => {});
  }

  // ---------- layouts de envio ----------
  await prisma.layoutEnvio.create({ data: {
    empresaId: e1.id, nome: "Planilha mensal de viagens", padrao: true, criadoPorId: admin.id,
    colunas: [
      { campo: "data", header: "DATA", ordem: 1, formato: "data_br" },
      { campo: "placa", header: "PLACA", ordem: 2 },
      { campo: "motorista", header: "MOTORISTA", ordem: 3 },
      { campo: "ticket", header: "TICKET", ordem: 4 },
      { campo: "cliente", header: "OBRA / DESTINO", ordem: 5 },
      { campo: "material", header: "MATERIAL", ordem: 6 },
      { campo: "toneladas", header: "TONELADAS", ordem: 7, formato: "decimal_br" },
      { campo: "km", header: "KM RODADO", ordem: 8, formato: "decimal_br" },
      { campo: "valorPedagio", header: "PEDÁGIO (R$)", ordem: 9, formato: "moeda" },
    ],
    config: { incluiCabecalhoEmpresa: true, formatoData: "data_br", separadorDecimal: ",", totaisRodape: true },
  } });
  await prisma.layoutEnvio.create({ data: {
    empresaId: e1.id, nome: "Pedágios do período", criadoPorId: admin.id,
    colunas: [
      { campo: "data", header: "DATA", ordem: 1, formato: "data_br" },
      { campo: "placa", header: "PLACA", ordem: 2 },
      { campo: "pracaPedagio", header: "PRAÇA", ordem: 3 },
      { campo: "valor", header: "VALOR", ordem: 4, formato: "moeda" },
    ],
    config: { formatoData: "data_br", separadorDecimal: ",", totaisRodape: true },
  } });

  // ---------- fechamento com conciliação ----------
  const alvo = viagensCriadas.filter((v) => v.data && v.data >= soData(dataDe(45)) && v.data <= soData(dataDe(16))).slice(0, 46);
  const fech = await prisma.fechamento.create({ data: {
    empresaId: e1.id, periodoInicio: soData(dataDe(45)), periodoFim: soData(dataDe(16)),
    fonte: "UPLOAD", arquivoOriginalNome: "vale-verde-fechamento-julho.xlsx",
    arquivoMimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    status: "AGUARDANDO_REVISAO", criadoPorId: admin.id, criadoEm: dataDe(9),
    resumoIa: { total: alvo.length + 3, match_auto: 0, match_ia: 0, divergencia: 0, falta: 0, extra: 0 },
  } });
  let ordem = 0, cnt = { MATCH: 0, MATCH_IA: 0, DIVERGENCIA: 0, FALTANDO: 0, EXTRA: 0 };
  for (const v of alvo) {
    const r = rnd();
    let status = "MATCH", divergencias = null, sugestaoIa = null;
    let km = Number(v.km), ton = Number(v.toneladas);
    if (r < 0.1) { status = "MATCH_IA"; sugestaoIa = { viagemId: v.id, confidence: Math.round(entre(0.87, 0.98) * 100) / 100, motivo: "Ticket com dígito trocado na planilha; placa, data e tonelagem conferem." }; }
    else if (r < 0.2) {
      status = "DIVERGENCIA";
      km = Math.round(km * entre(0.82, 0.93) * 10) / 10;
      divergencias = { km: { motorista: Number(v.km), empresa: km } };
    } else if (r < 0.24) { status = "FALTANDO"; }
    const vei = veics.find((x) => x.id === v.veiculoId);
    cnt[status]++;
    await prisma.fechamentoLinha.create({ data: {
      fechamentoId: fech.id, ordem: ordem++, tipo: "VIAGEM",
      rawData: { DATA: v.data.toISOString().slice(0, 10), PLACA: vei.placa, TICKET: v.ticket, KM: km, TONELADAS: ton, MATERIAL: "BRITA 1" },
      placa: vei.placa, data: v.data, ticket: v.ticket, km: D(km), toneladas: D(ton),
      clienteTexto: "OBRA CONTORNO LESTE", materialTexto: "BRITA 1",
      viagemMatchId: status === "FALTANDO" ? null : v.id,
      status, divergencias, sugestaoIa,
    } });
  }
  for (let i = 0; i < 3; i++) {
    cnt.EXTRA++;
    await prisma.fechamentoLinha.create({ data: {
      fechamentoId: fech.id, ordem: ordem++, tipo: "VIAGEM",
      rawData: { DATA: soData(dataDe(30)).toISOString().slice(0, 10), PLACA: "BQX-1A22", TICKET: String(99100 + i), KM: 41.2, TONELADAS: 27.5 },
      placa: "BQX-1A22", data: soData(dataDe(30)), ticket: String(99100 + i), km: D(41.2), toneladas: D(27.5),
      clienteTexto: "OBRA CONTORNO LESTE", materialTexto: "BRITA 1", status: "EXTRA",
    } });
  }
  await prisma.fechamento.update({ where: { id: fech.id }, data: { resumoIa: { total: ordem, match_auto: cnt.MATCH, match_ia: cnt.MATCH_IA, divergencia: cnt.DIVERGENCIA, falta: cnt.FALTANDO, extra: cnt.EXTRA } } });

  // fechamento anterior já conferido
  await prisma.fechamento.create({ data: {
    empresaId: e2.id, periodoInicio: soData(dataDe(75)), periodoFim: soData(dataDe(46)),
    fonte: "UPLOAD", arquivoOriginalNome: "serra-azul-junho.xlsx", status: "CONFERIDO",
    criadoPorId: admin.id, criadoEm: dataDe(40),
    resumoIa: { total: 38, match_auto: 34, match_ia: 3, divergencia: 1, falta: 0, extra: 0 },
  } });

  // ---------- posições da frota (mapa) ----------
  for (let i = 0; i < 8; i++) {
    const mot = motos[i];
    for (let j = 0; j < 4; j++)
      await prisma.motoristaPosicao.create({ data: {
        motoristaId: mot.id, lat: -25.35 - i * 0.045 + j * 0.004, lng: -49.32 - i * 0.052 + j * 0.005,
        precisao: entre(6, 24), capturadoEm: new Date(hoje.getTime() - (j * 12 + 3) * 60000),
      } }).catch(() => {});
  }

  const tot = await prisma.viagem.count();
  console.log(`pronto: ${tot} viagens, ${motos.length} motoristas, ${veics.length} veículos, ${ordem} linhas de fechamento`);
  console.log("login: admin@ronan.local / demo1234");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
