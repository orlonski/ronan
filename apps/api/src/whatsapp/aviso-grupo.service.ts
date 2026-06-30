import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";

const CONFIG_ID = "default";

const TEMPLATE_DEFAULT =
  "🎉 {nome} acabou de entrar no app da Schaba! Seja bem-vindo, parceiro 🚛";

/**
 * Aviso automático no grupo de WhatsApp quando um motorista que JÁ está no grupo
 * se cadastra no app. Prova social numa comunidade pequena e fechada (~45
 * membros), não spam: evento pontual (cadastro é uma vez só) e com trava de
 * envio único por motorista (`avisoGrupoEnviadoEm`).
 *
 * Tudo aqui é best-effort: nunca lança pra quem chama (o cadastro não pode
 * quebrar por causa de um aviso). Desligado por padrão na config.
 */
@Injectable()
export class AvisoGrupoService {
  private readonly log = new Logger(AvisoGrupoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClientService,
  ) {}

  /** Config singleton (cria com defaults na primeira leitura). */
  async pegarConfig() {
    return this.prisma.configuracaoAvisoGrupo.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
  }

  async salvarConfig(
    data: { ativo?: boolean; grupoJid?: string | null; grupoNome?: string | null; template?: string | null },
    userId?: string,
  ) {
    return this.prisma.configuracaoAvisoGrupo.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, ...data, alteradoPorId: userId ?? null },
      update: { ...data, alteradoPorId: userId ?? null },
    });
  }

  /** Lista os grupos do número conectado pro admin escolher no painel. */
  async listarGrupos() {
    if (!this.evolution.configurado) return [];
    return this.evolution.listarGrupos();
  }

  /**
   * Anuncia no grupo que um motorista entrou no app — se (e só se) tudo bater:
   * config ativa, grupo escolhido, Evolution conectada, motorista ainda não
   * anunciado, com telefone, e já presente no grupo. Best-effort: nunca lança.
   */
  async anunciarCadastro(motoristaId: string): Promise<void> {
    try {
      const r = await this.avaliar(motoristaId, { enviar: true });
      if (r.enviado) {
        this.log.log(`Aviso postado no grupo pra motorista ${motoristaId}.`);
      } else {
        this.log.log(`Sem aviso pra motorista ${motoristaId}: ${r.motivo}`);
      }
    } catch (e) {
      this.log.warn(`Falha ao anunciar cadastro no grupo: ${(e as Error).message}`);
    }
  }

  /**
   * Roda toda a régua de decisão do aviso pra um motorista (por id ou CPF) e
   * devolve cada etapa — pra o admin enxergar EXATAMENTE por que (não) disparou.
   * Por padrão é dry-run (não envia, não marca a trava). `enviar=true` envia de
   * verdade ignorando a trava de envio único (útil pra re-testar o mesmo cara).
   */
  async diagnosticar(motoristaRef: string, opts: { enviar?: boolean } = {}) {
    const ref = motoristaRef.replace(/\D/g, "").length === 11 ? { cpf: motoristaRef.replace(/\D/g, "") } : { id: motoristaRef };
    const motorista = await this.prisma.motorista.findUnique({
      where: ref,
      select: { id: true, nome: true, telefone: true, avisoGrupoEnviadoEm: true },
    });
    if (!motorista) {
      return { ok: false, motivo: "Motorista não encontrado pra esse CPF/id." };
    }
    const r = await this.avaliar(motorista.id, { enviar: opts.enviar, ignorarTrava: true });
    return { ok: r.enviado || r.presenteNoGrupo, motorista: { nome: motorista.nome }, ...r };
  }

  /**
   * Núcleo compartilhado: avalia (e opcionalmente executa) o aviso. Retorna um
   * relatório de cada checagem. `ignorarTrava` pula a trava de envio único (só
   * o diagnóstico usa). Marca `avisoGrupoEnviadoEm` quando envia de verdade.
   */
  private async avaliar(
    motoristaId: string,
    opts: { enviar?: boolean; ignorarTrava?: boolean } = {},
  ): Promise<{
    enviado: boolean;
    motivo: string;
    evolutionConfigurado: boolean;
    configAtivo: boolean;
    grupoJid: string | null;
    grupoNome: string | null;
    temTelefone: boolean;
    telefoneAlvo: string | null;
    jaAvisadoEm: Date | null;
    totalParticipantes: number;
    presenteNoGrupo: boolean;
    textoPreview: string | null;
  }> {
    const evolutionConfigurado = this.evolution.configurado;
    const config = await this.pegarConfig();
    const motorista = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { nome: true, telefone: true, avisoGrupoEnviadoEm: true },
    });

    const base = {
      enviado: false,
      evolutionConfigurado,
      configAtivo: config.ativo,
      grupoJid: config.grupoJid,
      grupoNome: config.grupoNome,
      temTelefone: !!motorista?.telefone,
      telefoneAlvo: motorista?.telefone ? SessaoService.normalizar(motorista.telefone) : null,
      jaAvisadoEm: motorista?.avisoGrupoEnviadoEm ?? null,
      totalParticipantes: 0,
      presenteNoGrupo: false,
      textoPreview: null as string | null,
    };

    if (!evolutionConfigurado) return { ...base, motivo: "Evolution API não configurada no servidor." };
    if (!config.ativo) return { ...base, motivo: "Aviso de grupo está DESLIGADO na config." };
    if (!config.grupoJid) return { ...base, motivo: "Nenhum grupo escolhido na config." };
    if (!motorista) return { ...base, motivo: "Motorista não encontrado." };
    if (!motorista.telefone) return { ...base, motivo: "Motorista não tem telefone cadastrado." };
    if (motorista.avisoGrupoEnviadoEm && !opts.ignorarTrava) {
      return { ...base, motivo: `Já foi avisado em ${motorista.avisoGrupoEnviadoEm.toISOString()}.` };
    }

    let participantes: string[];
    try {
      participantes = await this.evolution.participantesDoGrupo(config.grupoJid);
    } catch (e) {
      return { ...base, motivo: `Falha ao ler participantes do grupo: ${(e as Error).message}. O número da Evolution está DENTRO do grupo?` };
    }
    const presente = participantes.some((p) => mesmoNumero(p, motorista.telefone!));
    const comParticipantes = { ...base, totalParticipantes: participantes.length, presenteNoGrupo: presente };

    if (participantes.length === 0) {
      return { ...comParticipantes, motivo: "Grupo retornou 0 participantes — confira o JID do grupo e se o número da Evolution está nele." };
    }
    if (!presente) {
      return { ...comParticipantes, motivo: `Telefone ${base.telefoneAlvo} não bate com nenhum dos ${participantes.length} participantes do grupo.` };
    }

    const texto = (config.template?.trim() || TEMPLATE_DEFAULT).replace(
      /\{nome\}/g,
      primeiroNome(motorista.nome),
    );
    const comTexto = { ...comParticipantes, textoPreview: texto };

    if (!opts.enviar) {
      return { ...comTexto, motivo: "Tudo certo — enviaria (dry-run, não enviado)." };
    }

    // O Evolution aceita o JID do grupo (@g.us) no lugar do número em sendText.
    await this.evolution.enviarTexto(config.grupoJid, texto);
    await this.prisma.motorista.update({
      where: { id: motoristaId },
      data: { avisoGrupoEnviadoEm: new Date() },
    });
    return { ...comTexto, enviado: true, jaAvisadoEm: new Date(), motivo: "Enviado com sucesso." };
  }
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/**
 * Compara dois telefones tolerando o inferno do 9º dígito no Brasil: o JID do
 * WhatsApp às vezes vem sem o 9 (DDD + 8 dígitos), o cadastro às vezes com.
 * Bate DDD + os últimos 8 dígitos (que são estáveis nas duas formas).
 */
function mesmoNumero(a: string, b: string): boolean {
  const da = soDigitos(a);
  const db = soDigitos(b);
  if (!da || !db) return false;
  return da.ddd === db.ddd && da.ult8 === db.ult8;
}

function soDigitos(raw: string): { ddd: string; ult8: string } | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // tira DDI
  if (d.length < 10) return null; // sem DDD válido
  return { ddd: d.slice(0, 2), ult8: d.slice(-8) };
}
