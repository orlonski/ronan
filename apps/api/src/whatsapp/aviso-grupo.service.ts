import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EvolutionClientService } from "./evolution-client.service";

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
   * anunciado, com telefone, e já presente no grupo. Best-effort.
   */
  async anunciarCadastro(motoristaId: string): Promise<void> {
    try {
      if (!this.evolution.configurado) return;

      const config = await this.pegarConfig();
      if (!config.ativo || !config.grupoJid) return;

      const motorista = await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true, telefone: true, avisoGrupoEnviadoEm: true },
      });
      if (!motorista || motorista.avisoGrupoEnviadoEm || !motorista.telefone) return;

      const participantes = await this.evolution.participantesDoGrupo(config.grupoJid);
      const presente = participantes.some((p) => mesmoNumero(p, motorista.telefone!));
      if (!presente) {
        this.log.log(
          `Motorista ${motoristaId} não está no grupo configurado — sem aviso.`,
        );
        return;
      }

      const texto = (config.template?.trim() || TEMPLATE_DEFAULT).replace(
        /\{nome\}/g,
        primeiroNome(motorista.nome),
      );
      // O Evolution aceita o JID do grupo (@g.us) no lugar do número em sendText.
      await this.evolution.enviarTexto(config.grupoJid, texto);

      await this.prisma.motorista.update({
        where: { id: motoristaId },
        data: { avisoGrupoEnviadoEm: new Date() },
      });
      this.log.log(`Aviso de cadastro postado no grupo pra motorista ${motoristaId}.`);
    } catch (e) {
      this.log.warn(`Falha ao anunciar cadastro no grupo: ${(e as Error).message}`);
    }
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
