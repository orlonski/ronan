import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { achatarParam } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema } from "../common/conta/conta-context";
import { comLockDeCron } from "../common/cron-exclusivo";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { LeadChatwootService } from "../prospeccao/lead-chatwoot.service";
import { ChatwootClientService } from "../chatwoot/chatwoot-client.service";
import { SdrService } from "../sdr/sdr.service";
import { AtendimentoHumanoService } from "../sdr/atendimento-humano.service";
import { EMPRESA_A_DESCOBRIR, sufixoTelefone, telefoneDaCasa } from "../sdr/lead-inbound";
import { primeiroNome } from "../sdr/roteiro-comercial";
import { lerEnvio, resumoDoEnvio, type EnvioMeta } from "./meta-leads.regras";

const TIMEOUT_MS = 15_000;
/** Só o que chegou nos últimos dias: ligar a importação não pode disparar mensagem pra lead velho. */
const JANELA_DIAS = 3;
/** A Página Movatruck. Não é segredo: aparece na URL de qualquer tela dela. */
const PAGINA_PADRAO = "1347091071811891";

type Formulario = { id: string; name?: string; status?: string };

/**
 * Traz pro sistema quem preencheu o formulário do anúncio da Meta, e faz o
 * primeiro contato em minutos.
 *
 * O dono (28/09/2026): "tinha que ter uma forma de quem tem interesse preencher
 * um formulário". O formulário filtra (dono ou motorista, quantos caminhões);
 * isto garante que o lead filtrado não fique parado na Meta esperando alguém
 * baixar uma planilha — speed-to-lead é o que mais pesa na venda.
 *
 * Varredura, não webhook: a cada 3 minutos pergunta à Meta pelos envios dos
 * últimos dias. Não depende de configurar webhook de Página no app da Meta, e
 * é idempotente (`Lead.metaLeadgenId` é único) — rodar duas vezes não manda
 * duas mensagens.
 *
 * Por envio:
 * 1. Cria (ou completa, se o telefone já conversou com a gente) o lead.
 * 2. Motorista: registra e para. Não é cliente — o formulário já disse isso a ele.
 * 3. Abre a conversa no inbox Comercial do Chatwoot e manda o template
 *    `boas_vindas_lead` pelo NÚMERO COMERCIAL. O texto é a pergunta dos dois
 *    caminhos do robô, então "1" ou "2" já cai no roteiro certo.
 * 4. Avisa a equipe (WhatsApp + sininho). Qualificado = ligar em até 5 min.
 */
@Injectable()
export class MetaLeadsService {
  private readonly log = new Logger("MetaLeads");
  private readonly token: string | undefined;
  private readonly pagina: string;
  private readonly versao: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly leadChatwoot: LeadChatwootService,
    private readonly chatwoot: ChatwootClientService,
    private readonly sdr: SdrService,
    private readonly atendimento: AtendimentoHumanoService,
    config: ConfigService,
  ) {
    // Token próprio quando existir; senão o do WhatsApp, que é do mesmo app —
    // serve se o usuário do sistema também tiver a Página com `leads_retrieval`.
    this.token = config.get<string>("META_LEADS_TOKEN") ?? config.get<string>("META_WHATSAPP_TOKEN");
    this.pagina = config.get<string>("META_LEADS_PAGE_ID") ?? PAGINA_PADRAO;
    this.versao = config.get<string>("META_GRAPH_VERSION") ?? "v21.0";
  }

  @Cron("0 */3 * * * *", { name: "meta-leads", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    if (!this.token) return;
    await comLockDeCron(this.prisma, "meta-leads", async () => {
      try {
        const r = await this.importarRecentes();
        if (r.novos > 0) this.log.log(`${r.novos} lead(s) novo(s) do formulário da Meta`);
      } catch (e) {
        this.log.error(`varredura falhou: ${(e as Error).message}`);
      }
    });
  }

  /**
   * O que a tela de diagnóstico mostra: o token alcança a Página? Quais
   * formulários existem? Sem isto, "não chegou lead" não tem como ser
   * investigado sem ler log.
   */
  async status(): Promise<{ ok: boolean; pagina: string; formularios: Formulario[]; erro?: string }> {
    if (!this.token) return { ok: false, pagina: this.pagina, formularios: [], erro: "Sem token da Meta no servidor." };
    try {
      const formularios = await this.formularios();
      return { ok: true, pagina: this.pagina, formularios };
    } catch (e) {
      return { ok: false, pagina: this.pagina, formularios: [], erro: (e as Error).message };
    }
  }

  async importarRecentes(): Promise<{ novos: number }> {
    const desde = Math.floor(Date.now() / 1000) - JANELA_DIAS * 86_400;
    let novos = 0;
    for (const f of await this.formularios()) {
      if (f.status && f.status !== "ACTIVE") continue;
      const filtro = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]));
      const campos = "id,created_time,form_id,ad_id,ad_name,campaign_name,field_data";
      const r = await this.graph<{ data?: EnvioMeta[] }>(
        `/${f.id}/leads?fields=${campos}&limit=100&filtering=${filtro}`,
      );
      for (const envio of r.data ?? []) {
        if (await this.importar({ ...envio, form_id: envio.form_id ?? f.id })) novos++;
      }
    }
    return { novos };
  }

  /** Um envio. `true` = era novo e foi tratado. */
  async importar(envio: EnvioMeta): Promise<boolean> {
    const ja = await comoSistema(() =>
      this.prisma.lead.findUnique({ where: { metaLeadgenId: envio.id }, select: { id: true } }),
    );
    if (ja) return false;

    const l = lerEnvio(envio);
    const telefone = l.telefone ? telefoneDaCasa(l.telefone) : null;
    const dadosMeta = {
      metaLeadgenId: l.leadgenId,
      metaFormId: envio.form_id ?? null,
      metaAdId: envio.ad_id ?? null,
      metaAnuncio: envio.ad_name ?? null,
      metaCampanha: envio.campaign_name ?? null,
      funcaoInformada: l.funcao,
      frota: l.frota,
      // O formulário termina com o botão do cadastro: o teste já foi oferecido.
      // É o que faz o robô mandar o passo a passo quando a conta nascer.
      ...(l.motorista ? {} : { testeOferecidoEm: new Date() }),
    };

    // Quem já conversou com a gente pelo WhatsApp é a MESMA pessoa: completa o
    // lead que existe em vez de criar um segundo.
    const existente = telefone
      ? await comoSistema(() =>
          this.prisma.lead.findFirst({
            where: { telefone: { endsWith: sufixoTelefone(telefone) } },
            orderBy: [{ chatwootConversaId: { sort: "desc", nulls: "last" } }, { criadoEm: "desc" }],
            select: { id: true, nome: true, optOut: true },
          }),
        )
      : null;

    let leadId: string;
    try {
      if (existente) {
        await comoSistema(() =>
          this.prisma.lead.update({
            where: { id: existente.id },
            data: { ...dadosMeta, nome: existente.nome ?? l.nome, ultimoContato: new Date() },
          }),
        );
        leadId = existente.id;
      } else {
        const criado = await comoSistema(() =>
          this.prisma.lead.create({
            data: {
              ...dadosMeta,
              empresa: EMPRESA_A_DESCOBRIR,
              nome: l.nome,
              telefone,
              origem: "META_FORMULARIO",
              origemDado: "Formulário de anúncio da Meta, preenchido pelo próprio titular",
              coletadoEm: envio.created_time ? new Date(envio.created_time) : new Date(),
              utmSource: "meta",
              utmMedium: "formulario",
              utmCampaign: envio.campaign_name ?? null,
              ultimoContato: new Date(),
            },
            select: { id: true },
          }),
        );
        leadId = criado.id;
      }
    } catch (e) {
      // Duas varreduras no mesmo segundo: a outra já criou. Não é erro.
      if ((e as { code?: string }).code === "P2002") return false;
      throw e;
    }

    const resumo = resumoDoEnvio(l);
    await comoSistema(() =>
      this.prisma.interacaoLead.create({
        data: { leadId, canal: "NOTA", desfecho: "RESPONDEU", resumo, autor: null },
      }),
    );

    if (l.motorista || existente?.optOut || !telefone) {
      this.log.log(`formulário ${l.leadgenId}: ${l.motorista ? "motorista" : existente?.optOut ? "opt-out" : "sem telefone"} — sem contato`);
      return true;
    }

    let conversaId: number | null = null;
    let contaChatwoot: number | null = null;
    try {
      const c = await this.leadChatwoot.abrirConversa(leadId);
      conversaId = c.conversaId;
      contaChatwoot = await this.chatwoot.contaPadrao();
    } catch (e) {
      this.log.warn(`formulário ${l.leadgenId}: não abri a conversa no Chatwoot — ${(e as Error).message}`);
    }

    const nome = primeiroNome(l.nome) ?? "tudo bem";
    const texto =
      `Oi, ${nome}! Aqui é a Movatruck. Recebemos seu pedido pra testar o sistema na sua transportadora.\n\n` +
      "Pra você conhecer, tem dois caminhos:\n" +
      "*1.* Um consultor te liga e mostra o sistema funcionando, uns 10 minutos\n" +
      "*2.* Você cria sua conta e testa 30 dias grátis, sem cartão, e a gente te acompanha aqui em cada passo\n\n" +
      "Qual prefere? É só responder 1 ou 2.";
    const r = await this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(telefone) },
      rota: "BOAS_VINDAS_LEAD",
      texto,
      params: [achatarParam(nome)],
      remetente: "comercial",
    });
    if (r.enviado) {
      // Vira a "última fala nossa": a resposta dele cai no roteiro dos caminhos.
      await this.sdr.registrarSaida(leadId, texto);
    } else {
      this.log.warn(`formulário ${l.leadgenId}: boas-vindas não saiu — ${r.erro?.codigo ?? "?"} ${r.erro?.detalhe ?? ""}`);
    }

    if (contaChatwoot && conversaId) {
      await this.chatwoot.anotar(
        contaChatwoot,
        conversaId,
        `${resumo}\n` +
          (r.enviado
            ? "Mensagem de boas-vindas enviada pelo número comercial (ligação ou teste)."
            : `A mensagem de boas-vindas NÃO saiu (${r.erro?.codigo ?? "erro"}). Chame manualmente.`),
      );
      await this.atendimento.avisarLeadNovo(
        leadId,
        l.qualificado
          ? `${resumo} Qualificado: ligue em até 5 minutos.`
          : `${resumo} Frota pequena: o robô conduz o teste; ligar se ele pedir.`,
        conversaId,
      );
    }
    return true;
  }

  private async formularios(): Promise<Formulario[]> {
    const r = await this.graph<{ data?: Formulario[] }>(`/${this.pagina}/leadgen_forms?fields=id,name,status&limit=50`);
    return r.data ?? [];
  }

  /**
   * Chamada à Graph API com o token da PÁGINA. Formulário e lead só respondem a
   * token de página; o token do servidor (usuário do sistema) serve pra pedir o
   * da página, e é o que se tenta primeiro.
   */
  private tokenDaPagina: string | null = null;
  private async graph<T>(caminho: string): Promise<T> {
    if (!this.tokenDaPagina) {
      const p = await this.get<{ access_token?: string }>(`/${this.pagina}?fields=access_token`, this.token!).catch(() => null);
      this.tokenDaPagina = p?.access_token ?? this.token!;
    }
    try {
      return await this.get<T>(caminho, this.tokenDaPagina);
    } catch (e) {
      // Token de página vence ou é revogado: a próxima rodada pede outro.
      this.tokenDaPagina = null;
      throw e;
    }
  }

  private async get<T>(caminho: string, token: string): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      // Token no cabeçalho, nunca na URL: URL vai parar em log.
      const res = await fetch(`https://graph.facebook.com/${this.versao}${caminho}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
      if (!res.ok || corpo.error) {
        throw new Error(`Meta ${res.status}: ${corpo.error?.message ?? "sem detalhe"} (código ${corpo.error?.code ?? "?"})`);
      }
      return corpo;
    } finally {
      clearTimeout(t);
    }
  }
}
