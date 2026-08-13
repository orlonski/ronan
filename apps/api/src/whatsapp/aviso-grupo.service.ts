import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { contaIdAtual } from "../common/conta/conta-context";

const CONFIG_ID = "default";

const TEMPLATE_DEFAULT =
  "🎉 {nome} acabou de entrar no app! Seja bem-vindo, parceiro 🚛";

/**
 * Aviso automático no grupo de WhatsApp quando um motorista se cadastra no app.
 * Regra simples: cadastrou → anuncia no grupo. NÃO exige que o motorista já
 * esteja no grupo (nada de casar telefone com participantes). Não é spam:
 * evento pontual (cadastro é uma vez só) e com trava de envio único por
 * motorista (`avisoGrupoEnviadoEm`).
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
      where: { contaId: contaIdAtual() },
      create: {},
      update: {},
    });
  }

  async salvarConfig(
    data: { ativo?: boolean; grupoJid?: string | null; grupoNome?: string | null; template?: string | null },
    userId?: string,
  ) {
    return this.prisma.configuracaoAvisoGrupo.upsert({
      where: { contaId: contaIdAtual() },
      create: { ...data, alteradoPorId: userId ?? null },
      update: { ...data, alteradoPorId: userId ?? null },
    });
  }

  /** Lista os grupos do número conectado pro admin escolher no painel. */
  async listarGrupos() {
    if (!this.evolution.configurado) return [];
    return this.evolution.listarGrupos();
  }

  /**
   * Anuncia no grupo que um motorista entrou no app — se tudo bater: config
   * ativa, grupo escolhido, Evolution conectada e motorista ainda não anunciado.
   * Best-effort: nunca lança.
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
    const motorista = await this.prisma.motorista.findFirst({
      where: ref,
      select: { id: true, nome: true, telefone: true, avisoGrupoEnviadoEm: true },
    });
    if (!motorista) {
      return { ok: false, motivo: "Motorista não encontrado pra esse CPF/id." };
    }
    const r = await this.avaliar(motorista.id, { enviar: opts.enviar, ignorarTrava: true });
    return { ok: r.enviado, motorista: { nome: motorista.nome }, ...r };
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
      textoPreview: null as string | null,
    };

    if (!evolutionConfigurado) return { ...base, motivo: "Evolution API não configurada no servidor." };
    if (!config.ativo) return { ...base, motivo: "Aviso de grupo está DESLIGADO na config." };
    if (!config.grupoJid) return { ...base, motivo: "Nenhum grupo escolhido na config." };
    if (!motorista) return { ...base, motivo: "Motorista não encontrado." };
    if (motorista.avisoGrupoEnviadoEm && !opts.ignorarTrava) {
      return { ...base, motivo: `Já foi avisado em ${motorista.avisoGrupoEnviadoEm.toISOString()}.` };
    }

    // Sem match com participantes: cadastrou → anuncia. O texto usa só o nome.
    const texto = (config.template?.trim() || TEMPLATE_DEFAULT).replace(
      /\{nome\}/g,
      primeiroNome(motorista.nome),
    );
    const comTexto = { ...base, textoPreview: texto };

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
