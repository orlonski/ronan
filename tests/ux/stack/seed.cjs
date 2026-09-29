// Seed determinístico do stack de medidas de UX (tests/ux). Contas fictícias; NUNCA aponta pra dados reais. Rodar com DATABASE_URL do Postgres temporário. NUNCA produção.
const path = require("path");
const API = path.resolve(__dirname, "../../../apps/api");
const req = (m) => require(require.resolve(m, { paths: [API] }));
const { PrismaClient } = req("@prisma/client");
const bcrypt = req("bcrypt");
const shared = req("@ronan/shared-types");
const crypto = require("crypto");
const fs = require("fs");

if (!/localhost:\d+\/uxmedidas$/.test(process.env.DATABASE_URL || "")) {
  console.error("DATABASE_URL não é o banco temporário. Abortando.");
  process.exit(1);
}
const prisma = new PrismaClient();
const uid = () => crypto.randomUUID();
let seedN = 42;
const rnd = () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const dias = (n, h = 12) => {
  const d = new Date("2026-09-29T15:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(h + 3, Math.floor(rnd() * 60), 0, 0);
  return d;
};
const diaDate = (n) => { const d = new Date("2026-09-29T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d; };

const NOMES = ["João Silva","Carlos Souza","Marcos Oliveira","Pedro Santos","Rafael Lima","Anderson Costa","Luiz Pereira","Fernando Alves","Ricardo Rocha","Paulo Gomes","Sérgio Martins","Jorge Barbosa","Antônio Ribeiro","Roberto Carvalho","Eduardo Nunes","Marcelo Araújo","Diego Ferreira","Gustavo Mendes","Felipe Cardoso","Rodrigo Teixeira","Adriano Moreira","Claudio Dias","Vanderlei Freitas","Ademir Correia","Josué Batista","Edson Pinto","Valdir Monteiro","Nelson Cavalcante","Osmar Duarte","Wilson Campos"];
const CIDADES = [
  ["Curitiba","PR",-25.4284,-49.2733],["São José dos Pinhais","PR",-25.5313,-49.2064],["Araucária","PR",-25.5932,-49.4102],
  ["Colombo","PR",-25.2925,-49.2242],["Pinhais","PR",-25.4445,-49.1926],["Campo Largo","PR",-25.4595,-49.5278],
  ["Fazenda Rio Grande","PR",-25.6626,-49.3078],["Almirante Tamandaré","PR",-25.3247,-49.3049],
];

async function main() {
  const senhaHash = await bcrypt.hash("uxmedidas123", 4);
  const chaves = shared.TODAS_AS_CHAVES;
  const MODULOS = shared.MODULOS_CHAVES;

  // ---------- contas
  const plat = await prisma.conta.findFirst({ where: { ehPlataforma: true } });
  const conta = await prisma.conta.create({
    data: { nome: "Transportes Modelo Ltda", slug: "modelo", cnpj: "11222333000181", permiteAutoCadastro: true, codigoConvite: "MODELO1", telefoneParaMotoristas: "41999990000", razaoSocial: "Transportes Modelo Ltda", municipio: "Curitiba", uf: "PR" },
  });
  const C = conta.id;
  const papelAdmin = await prisma.papel.create({ data: { contaId: C, nome: "Administrador", descricao: "Acesso total", permissoes: chaves, sistema: true } });
  const admin = await prisma.user.create({ data: { contaId: C, nome: "Admin Modelo", email: "admin@modelo.test", senhaHash, papelId: papelAdmin.id } });
  const papelPlat = await prisma.papel.upsert({
    where: { contaId_nome: { contaId: plat.id, nome: "Administrador" } },
    update: { permissoes: chaves }, create: { contaId: plat.id, nome: "Administrador", permissoes: chaves, sistema: true },
  });
  const superAdmin = await prisma.user.create({ data: { contaId: plat.id, nome: "Super Admin", email: "super@movatruck.test", senhaHash, papelId: papelPlat.id, plataforma: true } });
  const papelOperador = await prisma.papel.create({ data: { contaId: C, nome: "Operador", descricao: "Lança e confere", permissoes: chaves.filter((c) => /^(viagens|motoristas|veiculos|locais)/.test(c)), sistema: false } });
  // Usuário de papel RESTRITO (menos telas): a suíte de navegação do celular compara o que ele vê com o que a sidebar mostra.
  const operador = await prisma.user.create({ data: { contaId: C, nome: "Operador Teste", email: "operador@modelo.test", senhaHash, papelId: papelOperador.id } });
  for (const chave of MODULOS) {
    if (chave !== "plataforma") await prisma.moduloContratado.create({ data: { contaId: C, chave, ativo: true } });
    await prisma.moduloContratado.createMany({ data: [{ contaId: plat.id, chave, ativo: true }], skipDuplicates: true });
  }
  // termos
  for (const tipo of ["USO", "PRIVACIDADE"]) {
    const tv = await prisma.termoVersao.create({ data: { tipo, versao: "1.0", corpo: "Termo de teste.", sha256: crypto.createHash("sha256").update(tipo).digest("hex"), vigenteDesde: new Date("2026-01-01"), publicadoEm: new Date("2026-01-01") } });
    for (const [cid, u] of [[C, admin], [C, operador], [plat.id, superAdmin]]) {
      await prisma.aceiteTermo.create({ data: { contaId: cid, termoVersaoId: tv.id, userId: u.id, nomeQuemAceitou: u.nome, emailQuemAceitou: u.email, origem: "seed" } });
    }
  }

  // ---------- cadastros
  const transp = [];
  for (const n of ["Transportadora Alfa", "Transportes Beta", "Frota Gama"]) transp.push(await prisma.transportadora.create({ data: { contaId: C, nome: n, cnpj: String(10000000000000 + transp.length * 1111) } }));
  const empresas = [];
  for (const n of ["Pedreira Vale Verde", "Construtora Horizonte", "Mineração Serra Azul", "Concreteira Central", "Terraplenagem Paraná", "Britagem Rio Branco"]) {
    empresas.push(await prisma.empresa.create({ data: { contaId: C, nome: n, cnpj: String(20000000000000 + empresas.length * 7777), razaoSocial: n + " S.A.", contato: "contato@" + n.split(" ")[0].toLowerCase() + ".com.br", municipio: "Curitiba", uf: "PR", prazoPagamentoDias: 30 } }));
  }
  const clientes = [];
  for (let i = 0; i < 15; i++) clientes.push(await prisma.cliente.create({ data: { contaId: C, nome: `Obra ${["Residencial Aurora","Parque Industrial","Rodovia BR-277 Lote 3","Shopping Norte","Condomínio Bela Vista","Loteamento Jardim","Ponte Rio Iguaçu","Hospital Regional","Escola Municipal","Duplicação PR-418","Aterro Sanitário","Terminal Logístico","Viaduto Central","Fábrica Sul","Centro Esportivo"][i]}`, empresaId: empresas[i % 6].id, kmMinimos: i % 4 === 0 ? 20 : null, toneladasMinimas: i % 5 === 0 ? 25 : null, apelidos: [] } }));
  const materiais = [];
  for (const [n, t, bf] of [["Brita 1", true, false], ["Brita 2", true, false], ["Pó de pedra", true, false], ["Areia lavada", true, false], ["Bica corrida", true, false], ["Rachão", true, false], ["Concreto usinado", false, false], ["Terra / bota-fora", true, true]])
    materiais.push(await prisma.material.create({ data: { contaId: C, nome: n, exigeTicket: t, permiteBotaFora: bf, dispensaConferencia: n === "Concreto usinado" } }));
  const tipos = [];
  for (const [i, [slug, n]] of [["transporte", "Transporte de material"], ["bota-fora", "Bota-fora"], ["carga-dedicada", "Carga dedicada"]].entries())
    tipos.push(await prisma.tipoServico.create({ data: { contaId: C, slug, nome: n, ordem: i, padrao: i === 0 } }));
  const modal = [];
  for (const [slug, n] of [["percentual", "Percentual do frete"], ["por-viagem", "Valor por viagem"], ["por-tonelada", "Valor por tonelada"]]) modal.push(await prisma.modalidadeMotorista.create({ data: { contaId: C, slug, nome: n } }));

  const locais = [];
  for (let i = 0; i < 26; i++) {
    const c = CIDADES[i % CIDADES.length];
    const tipo = i < 6 ? "CARGA" : i < 20 ? "DESCARGA" : "AMBOS";
    locais.push(await prisma.local.create({ data: { contaId: C, nome: (tipo === "CARGA" ? "Pedreira " : "Obra ") + ["Norte", "Sul", "Vale", "Serra", "Central", "Leste", "Oeste", "Boa Vista", "Iguaçu"][i % 9] + " " + (i + 1), logradouro: "Rodovia PR-" + (100 + i), numero: "s/n", bairro: "Zona Rural", cidade: c[0], uf: c[1], cep: "83000000", lat: c[2] + between(-0.15, 0.15), lng: c[3] + between(-0.15, 0.15), tipo, nivelConfianca: i % 7 === 0 ? "RASCUNHO" : "HUMANO" } }));
  }

  const veic = [];
  for (let i = 0; i < 30; i++) veic.push(await prisma.veiculo.create({ data: { contaId: C, placa: `ABC${1000 + i * 37}`.slice(0, 3) + (i % 10) + String.fromCharCode(65 + (i % 26)) + String(10 + i).slice(-2), modelo: pick(["Scania R450", "Volvo FH 540", "Mercedes Actros", "DAF XF", "Iveco Hi-Way"]), marca: "Caminhão", capacidadeToneladas: 30 + (i % 3) * 5, anoFabricacao: 2015 + (i % 10), tipoCarroceria: "Caçamba", transportadoraId: transp[i % 3].id, crlvValidade: dias(-(i * 9) + 60), seguroValidade: dias(-(i * 5) + 100) } }));
  const mot = [];
  for (let i = 0; i < 30; i++) {
    mot.push(await prisma.motorista.create({ data: { contaId: C, nome: NOMES[i], cpf: String(10000000000 + i * 1234567).slice(0, 11), senhaHash, telefone: `4199${String(1000000 + i * 3111).slice(0, 7)}`, status: i === 28 ? "PENDENTE_APROVACAO" : "APROVADO", aprovadoEm: dias(60), veiculoDefaultId: veic[i].id, transportadoraId: transp[i % 3].id, modalidadeId: modal[i % 3].id, podeIniciarViagem: i % 2 === 0, podeViagemLifecycle: i % 2 === 0, podeLancarPedagio: i % 3 === 0, ultimoLoginEm: dias(i % 6), appVersion: "1.1.4", appPlatform: i % 3 ? "android" : "ios", appVistoEm: dias(i % 4), expoPushToken: i % 4 ? "ExponentPushToken[seed" + i + "]" : null, chavePix: NOMES[i].split(" ")[0].toLowerCase() + "@pix.test" } }));
    await prisma.motoristaVeiculo.create({ data: { contaId: C, motoristaId: mot[i].id, veiculoId: veic[i].id } }).catch(() => {});
  }

  // ---------- viagens
  const viagens = [];
  const STATUS = ["OK", "OK", "OK", "OK", "ENVIADA", "ENVIADA", "EM_CONFERENCIA", "DIVERGENTE", "AJUSTADA", "OK"];
  for (let i = 0; i < 150; i++) {
    const m = mot[i % 30], idx = i % 30;
    const cli = clientes[i % 15];
    let status = STATUS[i % STATUS.length];
    if (i % 41 === 0) status = "EM_ANDAMENTO";
    if (i % 37 === 0) status = "AGUARDANDO_PESO";
    const cg = locais[i % 6], ds = locais[6 + (i % 20)];
    const km = Math.round(between(12, 95) * 10) / 10;
    const v = await prisma.viagem.create({
      data: {
        contaId: C, clientId: uid(), motoristaId: m.id, veiculoId: veic[idx].id, clienteId: cli.id, materialId: materiais[i % 8].id, tipoServicoId: tipos[i % 3 === 2 ? 1 : 0].id,
        data: dias(Math.floor(i / 3), 8 + (i % 9)), toneladas: status === "EM_ANDAMENTO" || status === "AGUARDANDO_PESO" ? null : Math.round(between(22, 38) * 100) / 100,
        ticket: String(50000 + i), km, kmMotorista: km, kmFonte: "ROTA_OSRM", status, localCargaId: cg.id, localDescargaId: ds.id,
        valorPedagioTotal: i % 3 ? Math.round(between(8, 60) * 100) / 100 : null, iniciadaGuiada: status === "EM_ANDAMENTO",
        iniciadoEm: status === "EM_ANDAMENTO" ? dias(0, 6) : null, lat: ds.lat, lng: ds.lng, transportadoraId: transp[idx % 3].id,
        tipoDivergencia: status === "DIVERGENTE" ? pick(["KM_DIVERGENTE", "TICKET_DUPLICADO", "MATERIAL_DIVERGENTE", "FOTO_ILEGIVEL"]) : null,
        motivoStatus: status === "DIVERGENTE" ? "Divergência detectada na conferência." : null,
        observacao: i % 9 === 0 ? "Descarga no período da tarde, pátio cheio." : null, sincronizadoEm: dias(Math.floor(i / 3)),
      },
    });
    viagens.push(v);
  }
  // ponto de trajeto pras em andamento
  for (const v of viagens.filter((x) => x.status === "EM_ANDAMENTO")) {
    for (let k = 0; k < 6; k++) await prisma.viagemPonto.create({ data: { contaId: C, viagemId: v.id, lat: v.lat + k * 0.01, lng: v.lng + k * 0.01, capturadoEm: dias(0, 6 + k) } }).catch(() => {});
  }
  // pedágios / abastecimentos
  for (let i = 0; i < 60; i++) {
    const v = viagens[i * 2];
    await prisma.pedagio.create({ data: { contaId: C, clientId: uid(), veiculoId: v.veiculoId, motoristaId: v.motoristaId, data: v.data, pracaPedagio: pick(["Praça Campo Largo", "Praça Palmeira", "Praça Ponta Grossa", "Praça São Luiz do Purunã"]), valor: Math.round(between(9, 32) * 100) / 100, viagemId: v.id } });
  }
  for (let i = 0; i < 60; i++) {
    const idx = i % 30;
    const litros = Math.round(between(150, 380));
    await prisma.abastecimento.create({ data: { contaId: C, clientId: uid(), motoristaId: mot[idx].id, veiculoId: veic[idx].id, empresaId: i % 3 ? empresas[i % 6].id : null, data: dias(Math.floor(i / 2)), litros, precoLitro: 5.89, valorTotal: Math.round(litros * 5.89 * 100) / 100, odometro: 180000 + i * 900 + idx * 5000, postoNome: pick(["Posto Ipiranga BR-277", "Posto Shell Rodovia", "Posto Petrobras Vale"]), tanqueCheio: i % 4 !== 0, transportadoraId: transp[idx % 3].id } });
  }

  // ---------- pedidos
  const pedidos = [];
  for (let i = 0; i < 8; i++) pedidos.push(await prisma.pedido.create({ data: { contaId: C, numero: i + 1, empresaId: empresas[i % 6].id, clienteId: clientes[i].id, materialId: materiais[i % 8].id, localCargaId: locais[i % 6].id, localDescargaId: locais[6 + i].id, tipoServicoId: tipos[0].id, quantidadeAlvo: 40 + i * 10, unidadeAlvo: i % 2 ? "TONELADAS" : "VIAGENS", inicioEm: dias(10), prazoEm: dias(-20), status: i === 7 ? "CUMPRIDO" : i > 4 ? "EM_CURSO" : "ABERTO" } }));
  for (let i = 0; i < 20; i++) await prisma.viagemPlanejada.create({ data: { contaId: C, pedidoId: pedidos[i % 8].id, motoristaId: mot[i].id, veiculoId: veic[i].id, dataPrevista: diaDate(-(i % 4)), janelaInicio: "07:00", janelaFim: "17:00", sequencia: i, status: pick(["PLANEJADA", "PUBLICADA", "ACEITA"]) } });

  // ---------- financeiro / preços
  for (const e of empresas) {
    await prisma.regraMinimo.create({ data: { contaId: C, empresaId: e.id, kmFaixaDe: 0, kmFaixaAte: 30, kmMinimo: 20 } }).catch(async () => prisma.regraMinimo.create({ data: { contaId: C, empresaId: e.id, kmFaixaDe: 0 } }).catch(() => {}));
    await prisma.tabelaPreco.create({ data: { contaId: C, empresaId: e.id, kmFaixaDe: 0, base: "TONELADA", precoUnitario: 18.5, vigenciaDe: dias(90) } }).catch((e2) => console.log("tabelaPreco", e2.message.slice(-120)));
  }
  const fech = [];
  for (let i = 0; i < 3; i++) {
    const f = await prisma.fechamento.create({ data: { contaId: C, empresaId: empresas[i].id, periodoInicio: dias(30 + i * 7), periodoFim: dias(i * 7), fonte: "UPLOAD", arquivoOriginalNome: `fechamento-${i}.xlsx`, versao: 1, status: ["CONFERIDO", "AGUARDANDO_REVISAO", "EM_CONCILIACAO"][i] } });
    fech.push(f);
    for (let k = 0; k < 12; k++) await prisma.fechamentoLinha.create({ data: { contaId: C, fechamentoId: f.id, ordem: k, rawData: { ticket: String(50000 + k), toneladas: 30 + k, data: "2026-09-1" + (k % 9) }, status: pick(["MATCH", "MATCH", "DIVERGENCIA", "FALTANDO", "EXTRA"]), viagemMatchId: k % 5 ? viagens[k].id : null } }).catch((e2) => { if (k === 0) console.log("fechLinha", e2.message.slice(-160)); });
  }
  for (let i = 0; i < 4; i++) {
    const a = await prisma.acertoMotorista.create({ data: { contaId: C, motoristaId: mot[i].id, periodoInicio: dias(30), periodoFim: dias(1), valorCreditos: 5200 + i * 300, valorDebitos: 400, valorLiquido: 4800 + i * 300, status: ["ABERTO", "FECHADO", "PAGO", "ABERTO"][i] } });
    await prisma.itemAcerto.create({ data: { contaId: C, acertoId: a.id, tipo: "FRETE", descricao: "Fretes do período", valor: 5200 + i * 300 } });
    await prisma.itemAcerto.create({ data: { contaId: C, acertoId: a.id, tipo: "DESCONTO_MULTA", descricao: "Multa", valor: -400 } }).catch(() => {});
  }
  for (let i = 0; i < 4; i++) {
    await prisma.fatura.create({ data: { contaId: C, numero: i + 1, empresaId: empresas[i].id, periodoInicio: dias(30), periodoFim: dias(1), valorBruto: 30000 + i * 1000, valorDescontos: 0, valorLiquido: 30000 + i * 1000, status: undefined } }).catch((e2) => { if (i === 0) console.log("fatura", e2.message.slice(-200)); });
    await prisma.tituloReceber.create({ data: { contaId: C, empresaId: empresas[i].id, emissao: dias(20), vencimento: dias(-10 + i * 15), valor: 12000 + i * 900 } }).catch((e2) => { if (i === 0) console.log("tr", e2.message.slice(-200)); });
    await prisma.tituloPagar.create({ data: { contaId: C, descricao: "Combustível fornecedor " + i, emissao: dias(15), vencimento: dias(-5 + i * 8), valor: 4300 + i * 500 } }).catch(() => {});
  }
  await prisma.fornecedor.create({ data: { contaId: C, nome: "Auto Peças Central" } }).catch(() => {});

  for (let i = 0; i < 100; i++) { const v = viagens[i]; if (v.toneladas) await prisma.viagemValor.create({ data: { contaId: C, viagemId: v.id, base: "TONELADA", precoUnitario: 18.5, quantidade: v.toneladas, valorFrete: Number(v.toneladas) * 18.5, valorTotal: Number(v.toneladas) * 18.5 } }).catch((e2) => { if (i === 0) console.log("vvalor", e2.message.slice(-200)); }); }
  // ---------- frota / manutenção
  for (let i = 0; i < 6; i++) {
    await prisma.problemaVeiculo.create({ data: { contaId: C, clientId: uid(), motoristaId: mot[i].id, veiculoId: veic[i].id, descricao: pick(["Freio fazendo barulho", "Pneu dianteiro careca", "Luz do painel acesa", "Vazamento de óleo"]), avisadoEm: dias(i) } }).catch((e2) => { if (i === 0) console.log("problema", e2.message.slice(-200)); });
    await prisma.manutencaoVeiculo.create({ data: { contaId: C, veiculoId: veic[i].id, descricao: "Revisão " + (i + 1) * 10000 + " km" } }).catch(() => {});
    await prisma.planoManutencao.create({ data: { contaId: C, veiculoId: veic[i].id, descricao: "Troca de óleo a cada 20.000 km" } }).catch(() => {});
    await prisma.multa.create({ data: { contaId: C, infracao: "Excesso de velocidade", ocorridaEm: dias(10 + i), valor: 195.23, veiculoId: veic[i].id, motoristaId: mot[i].id } }).catch((e2) => { if (i === 0) console.log("multa", e2.message.slice(-200)); });
    await prisma.pneu.create({ data: { contaId: C, numeroFogo: "PN" + (100 + i) } }).catch(() => {});
  }
  for (let i = 0; i < 10; i++) await prisma.pedagioRodovia.create({ data: { nome: "Praça de Pedágio " + (i + 1), concessionaria: "Ecovia", rodovia: "BR-277", cidade: CIDADES[i % 8][0], uf: "PR", lat: -25.4 + i * 0.05, lng: -49.2 - i * 0.05, valorBase: 8.9 + i, fonte: "MANUAL" } }).catch(() => {});

  // ---------- conferência diária
  await prisma.configuracaoConferenciaDiaria.create({ data: { contaId: C, ativo: true, modo: "ENVIANDO" } }).catch((e2) => console.log("cfgConf", e2.message.slice(-200)));
  const opcoes = ["NAO_TIVE", "TIVE_NAO_LANCEI", "SAI_DA_EMPRESA", "PARAR", "AMBIGUA"];
  for (let i = 0; i < 40; i++) {
    const estado = ["RESPONDIDA", "ENVIADA", "PENDENTE", "SUPRIMIDA", "EXPIRADA", "FALHOU", "SOMBRA"][i % 7];
    await prisma.conferenciaDiaria.create({ data: { contaId: C, motoristaId: mot[i % 30].id, dia: diaDate(Math.floor(i / 5) + 1), estado, motivo: estado === "SUPRIMIDA" ? "Lançou viagem no dia." : "3 dias úteis sem lançar viagem.", snapshot: { deveriaPerguntar: estado !== "SUPRIMIDA", evidencias: { diasSemMovimento: 3, diasEsperadosVerificados: ["2026-09-25"] } }, enviadaEm: ["ENVIADA", "RESPONDIDA", "EXPIRADA"].includes(estado) ? dias(Math.floor(i / 5) + 1) : null, opcao: estado === "RESPONDIDA" ? opcoes[i % 5] : null, respostaTexto: estado === "RESPONDIDA" ? pick(["Não tive viagem", "Tive e esqueci de lançar", "2"]) : null, respondidaEm: estado === "RESPONDIDA" ? dias(Math.floor(i / 5) + 1, 18) : null } }).catch((e2) => { if (i === 0) console.log("conf", e2.message.slice(-200)); });
  }
  for (let i = 0; i < 5; i++) await prisma.sugestaoGestor.create({ data: { contaId: C, motoristaId: mot[i].id, tipo: pick(["INATIVAR_VINCULO", "LANCAR_VIAGEM_FALTANTE", "RESPOSTA_AMBIGUA"]), resumo: "Motorista respondeu que não tem viagem há 10 dias.", evidencia: { dias: 10 } } }).catch((e2) => { if (i === 0) console.log("sug", e2.message.slice(-200)); });

  // ---------- notificações / chat / erros / auditoria
  for (let i = 0; i < 25; i++) await prisma.adminNotificacao.create({ data: { contaId: C, usuarioId: admin.id, tipo: pick(["VIAGEM_DIVERGENTE", "MOTORISTA_NOVO", "PROBLEMA_VEICULO"]), titulo: pick(["Viagem divergente", "Novo motorista aguardando aprovação", "Problema avisado pelo motorista"]), corpo: "Detalhe da notificação " + i, lida: i > 6, criadoEm: dias(Math.floor(i / 3)) } });
  for (let i = 0; i < 30; i++) await prisma.notificacao.create({ data: { contaId: C, motoristaId: mot[i].id, tipo: "AVISO", titulo: "Aviso da empresa", corpo: "Lembre de lançar suas viagens.", criadoEm: dias(i % 8) } });
  const conv = await prisma.conversa.create({ data: { contaId: C, tipo: "AVISOS" } }).catch((e2) => { console.log("conversa", e2.message.slice(-200)); return null; });
  if (conv) for (let i = 0; i < 8; i++) await prisma.mensagemChat.create({ data: { contaId: C, clientId: uid(), conversaId: conv.id, autor: i % 2 ? "ADMIN" : "MOTORISTA", motoristaId: i % 2 ? null : mot[0].id, usuarioId: i % 2 ? admin.id : null, autorNome: i % 2 ? "Admin" : NOMES[0], texto: "Mensagem de teste " + i } }).catch((e2) => { if (i === 0) console.log("msg", e2.message.slice(-200)); });
  for (let i = 0; i < 6; i++) await prisma.errorLog.create({ data: { contaId: C, hash: "h" + i, origem: pick(["motorista-app", "dashboard", "api"]), message: "TypeError: cannot read properties of undefined (reading 'id')" } }).catch((e2) => { if (i === 0) console.log("err", e2.message.slice(-200)); });
  for (let i = 0; i < 20; i++) await prisma.auditLog.create({ data: { contaId: C, entidade: "Viagem", entidadeId: viagens[i].id, acao: "UPDATE", usuarioId: admin.id } }).catch((e2) => { if (i === 0) console.log("audit", e2.message.slice(-200)); });
  for (let i = 0; i < 6; i++) await prisma.lancamentoResgatado.create({ data: { contaId: C, clientId: uid(), tipo: "viagem", motoristaId: mot[i].id, motoristaNome: NOMES[i], payload: { toneladas: 30 } } }).catch((e2) => { if (i === 0) console.log("resg", e2.message.slice(-200)); });
  for (const t of ["Carregado", "Descarregado", "Parado", "Aguardando"]) await prisma.tipoEventoViagem.create({ data: { contaId: C, slug: t.toLowerCase(), nome: t } }).catch(() => {});
  await prisma.documentoExigido.create({ data: { contaId: C, titulo: "CNH", tipo: "CNH" } }).catch((e2) => console.log("docex", e2.message.slice(-200)));
  await prisma.perfilAcessoApp.create({ data: { contaId: C, nome: "Parceiro padrão" } }).catch((e2) => console.log("perfil", e2.message.slice(-200)));
  for (let i = 0; i < 8; i++) await prisma.lead.create({ data: { contaId: plat.id, empresa: "Transportadora Lead " + i } }).catch((e2) => { if (i === 0) console.log("lead", e2.message.slice(-200)); });

  // ---------- ponto
  await prisma.configPonto.create({ data: { contaId: C, razaoSocial: "Transportes Modelo Ltda", cnpj: "11222333000181", identificacaoRep: "REP-P-1", avisoLgpdTexto: "Aviso." } }).catch((e2) => console.log("cfgPonto", e2.message.slice(-200)));
  for (let i = 0; i < 5; i++) await prisma.funcionario.create({ data: { contaId: C, nome: "Funcionário " + NOMES[i], cpf: String(30000000000 + i * 999).slice(0, 11), admitidoEm: dias(200), cargo: "Motorista" } }).catch((e2) => { if (i === 0) console.log("func", e2.message.slice(-200)); });

  fs.mkdirSync(path.join(__dirname, "..", ".stack"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", ".stack", "seed-ids.json"), JSON.stringify({
    contaId: C, plataformaContaId: plat.id, adminEmail: admin.email, superEmail: superAdmin.email, operadorEmail: operador.email, senha: "uxmedidas123",
    viagem: viagens[0].id, viagemEmAndamento: viagens.find((v) => v.status === "EM_ANDAMENTO")?.id, viagemDivergente: viagens.find((v) => v.status === "DIVERGENTE").id,
    motorista: mot[0].id, veiculo: veic[0].id, cliente: clientes[0].id, empresa: empresas[0].id, local: locais[0].id, material: materiais[0].id, tipoServico: tipos[0].id,
    modalidade: modal[0].id, transportadora: transp[0].id, pedido: pedidos[0].id,
  }, null, 2));
  console.log("seed ok");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
