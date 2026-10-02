import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { SessaoPortalObra } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { estadoDaConta } from "../common/conta/estado-da-conta";
import { modulosDaConta } from "../common/conta/teto-da-conta";
import {
  avaliarCodigo,
  CODIGO_TTL_MIN,
  gerarCodigo,
  gerarTokenSessao,
  hashSegredo,
  MENSAGEM_CODIGO,
  normalizarTelefoneEncarregado,
  podeReenviar,
  SESSAO_DIAS,
} from "./encarregado-regras";

/**
 * Resposta do "me manda o código", IGUAL pra número cadastrado ou não. Dizer
 * "esse número não está cadastrado" ensinaria a qualquer um quais celulares
 * são encarregados de obra de qual transportadora.
 */
const RESPOSTA_SOLICITAR = {
  ok: true as const,
  mensagem:
    "Se este número estiver liberado em alguma obra, o código chega no WhatsApp em instantes.",
};

/** O que a conta precisa ter pra o portal abrir. */
const SELECT_CONTA = {
  id: true,
  nome: true,
  logoUrl: true,
  ativa: true,
  somenteLeitura: true,
  trialExpiraEm: true,
  motivoBloqueio: true,
} as const;

/**
 * Entrada do encarregado da obra: código no WhatsApp → sessão de 30 dias.
 *
 * Tudo aqui roda `comoSistema` na hora de DESCOBRIR quem é (o telefone é o que
 * revela a empresa, como no login) e grava cada sessão com a conta explícita.
 * Daí pra frente, quem põe a conta no contexto é o `EncarregadoGuard`.
 */
@Injectable()
export class EncarregadoAuthService {
  private readonly log = new Logger("EncarregadoAuth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
  ) {}

  async solicitar(telefoneDigitado: string) {
    const telefone = normalizarTelefoneEncarregado(telefoneDigitado);
    // Formato inválido pode dizer que é inválido: não revela nada sobre cadastro.
    if (!telefone) throw new BadRequestException("Informe o celular com DDD, ex.: (43) 99999-1234.");

    const alvos = await this.encarregadosQueEntram(telefone);
    if (alvos.length === 0) {
      this.log.log(`código pedido pra número sem obra liberada (final ${telefone.slice(-4)})`);
      return RESPOSTA_SOLICITAR;
    }

    const anterior = await comoSistema(() =>
      this.prisma.codigoEncarregado.findUnique({ where: { telefone }, select: { enviadoEm: true } }),
    );
    // Cooldown em silêncio: um 429 aqui só aconteceria pra número cadastrado,
    // e viraria exatamente o oráculo que a resposta genérica evita.
    if (!podeReenviar(anterior?.enviadoEm ?? null)) return RESPOSTA_SOLICITAR;

    const codigo = gerarCodigo();
    // Envia ANTES de gravar: código que não chegou não pode ficar valendo. O
    // envio corre na conta da (primeira) obra, pra o custo da mensagem cair no
    // histórico de quem convidou — a rota é de plataforma, então o provedor
    // não muda por isso.
    await comConta(alvos[0]!.contaId, () =>
      this.envio.enviarOuFalhar({
        destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(telefone) },
        rota: "OTP_ENCARREGADO",
        texto: `Seu código pra entrar no acompanhamento da obra é ${codigo}. Vale por ${CODIGO_TTL_MIN} minutos. Não passe pra ninguém.`,
        params: [codigo, String(CODIGO_TTL_MIN)],
      }),
    );

    const dados = {
      codigoHash: hashSegredo(codigo),
      expiraEm: new Date(Date.now() + CODIGO_TTL_MIN * 60_000),
      tentativas: 0,
      enviadoEm: new Date(),
    };
    await comoSistema(() =>
      this.prisma.codigoEncarregado.upsert({
        where: { telefone },
        create: { telefone, ...dados },
        update: dados,
      }),
    );
    return RESPOSTA_SOLICITAR;
  }

  /**
   * Confere o código e abre uma sessão POR OBRA liberada pra esse número. O
   * portal guarda todas e deixa trocar — o mesmo encarregado tocando duas
   * obras não precisa sair e entrar.
   */
  async confirmar(telefoneDigitado: string, codigo: string): Promise<{ sessoes: SessaoPortalObra[] }> {
    const telefone = normalizarTelefoneEncarregado(telefoneDigitado);
    if (!telefone) throw new BadRequestException(MENSAGEM_CODIGO.SEM_CODIGO);

    const pendente = await comoSistema(() =>
      this.prisma.codigoEncarregado.findUnique({ where: { telefone } }),
    );
    const r = avaliarCodigo(pendente, codigo);
    if (!r.ok) {
      if (r.motivo === "ERRADO") {
        await comoSistema(() =>
          this.prisma.codigoEncarregado.update({
            where: { telefone },
            data: { tentativas: { increment: 1 } },
          }),
        );
      }
      throw new BadRequestException(MENSAGEM_CODIGO[r.motivo]);
    }

    // Código usado não serve de novo, nem se a criação de sessão falhar abaixo.
    await comoSistema(() => this.prisma.codigoEncarregado.delete({ where: { telefone } }));

    const alvos = await this.encarregadosQueEntram(telefone);
    if (alvos.length === 0) {
      throw new BadRequestException(
        "Esse número não tem mais obra liberada. Fale com a transportadora.",
      );
    }

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + SESSAO_DIAS * 86_400_000);
    const sessoes: SessaoPortalObra[] = [];
    for (const a of alvos) {
      const token = gerarTokenSessao();
      await comConta(a.contaId, async () => {
        await this.prisma.sessaoEncarregado.create({
          data: { encarregadoId: a.id, tokenHash: hashSegredo(token), expiraEm },
        });
        await this.prisma.encarregadoObra.update({
          where: { id: a.id },
          data: { ultimoAcessoEm: agora },
        });
      });
      sessoes.push({
        token,
        expiraEm: expiraEm.toISOString(),
        obra: { nome: a.cliente.nome },
        empresa: { nome: a.conta.nome, logoUrl: a.conta.logoUrl },
      });
    }
    return { sessoes };
  }

  /** "Sair" no portal: revoga só a sessão deste aparelho, desta obra. */
  async sair(sessaoId: string) {
    await this.prisma.sessaoEncarregado.updateMany({
      where: { id: sessaoId, revogadaEm: null },
      data: { revogadaEm: new Date() },
    });
    return { ok: true };
  }

  /**
   * Os cadastros de encarregado que esse celular abre AGORA: ativo, obra
   * ativa, empresa que pode entrar e que contratou o módulo do portal (a
   * torre — é de lá que vêm pedido e programação).
   */
  private async encarregadosQueEntram(telefone: string) {
    const linhas = await comoSistema(() =>
      this.prisma.encarregadoObra.findMany({
        where: { telefone, ativo: true, cliente: { ativa: true } },
        select: {
          id: true,
          contaId: true,
          cliente: { select: { nome: true } },
          conta: { select: SELECT_CONTA },
        },
        orderBy: { criadoEm: "asc" },
      }),
    );
    const ok: typeof linhas = [];
    for (const l of linhas) {
      if (!estadoDaConta(l.conta).podeEntrar) continue;
      const modulos = await comoSistema(() => modulosDaConta(this.prisma, l.contaId));
      if (!modulos.has("torre")) continue;
      ok.push(l);
    }
    return ok;
  }
}
