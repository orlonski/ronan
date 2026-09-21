import { Injectable, Logger } from "@nestjs/common";
import { comoSistema } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";

/**
 * Avisa os motoristas, por push, que saiu uma versão nova do app — pra acelerar
 * a adoção (a push é um "abra o app pra instalar"; quem abre, baixa o OTA novo).
 *
 * Sem cron / sem job em background: é disparado pelo PRÓPRIO publish, via o
 * endpoint `POST /app/deploy/nova-versao` (ver AppDeployController), que o comando
 * de publicar chama logo após `eas update`. O backend não roda nada ocioso —
 * só reage a essa chamada.
 */
@Injectable()
export class AppUpdateNotifierService {
  private readonly logger = new Logger(AppUpdateNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /**
   * Dispara a push pra todos os motoristas ativos com token. Retorna quantos.
   *
   * ⚠️ `comoSistema` NÃO é detalhe: quem chama é `POST /app/deploy/nova-versao`,
   * que é `@Public()` e se autentica por segredo de header. Rota pública não
   * tem conta no contexto, e a trava multi-tenant lança `ContaAusenteError` no
   * `findMany` — o endpoint respondia 500 e ninguém via, porque o script de
   * publicar avisa em amarelo e sai com código 0 pra nunca derrubar o OTA. O
   * resultado é que os motoristas deixaram de ser avisados de versão nova em
   * silêncio, desde que a trava entrou.
   *
   * E é cross-conta de propósito: o OTA é do APP, não de uma empresa. Todo
   * mundo que tem o aplicativo recebe a mesma atualização.
   */
  async notificarTodos(): Promise<number> {
    const todos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { ativo: true, expoPushToken: { not: null } },
        select: { id: true, expoPushToken: true },
      }),
    );
    // Dedup por token: se o mesmo aparelho aparece em 2 cadastros (token órfão),
    // manda só 1 push pra ele. A unicidade de verdade é garantida no registro
    // do token (registrarPushToken), isto aqui é rede de segurança.
    const vistos = new Set<string>();
    const alvos = todos.filter((m) => {
      if (!m.expoPushToken || vistos.has(m.expoPushToken)) return false;
      vistos.add(m.expoPushToken);
      return true;
    });
    if (alvos.length === 0) return 0;

    this.logger.log(`Nova versão publicada — avisando ${alvos.length} motorista(s)`);
    let ok = 0;
    // O envio também mexe no banco (lê preferência, limpa token morto), então
    // ele roda dentro do mesmo contexto de sistema — e o `await` fica DENTRO
    // do `run`: a promise do Prisma é preguiçosa, e devolvê-la pra fora faria
    // a consulta executar sem contexto nenhum.
    await comoSistema(async () => {
      for (const m of alvos) {
        if (!m.expoPushToken) continue;
        try {
          await this.push.enviar({
            motoristaId: m.id,
            token: m.expoPushToken,
            titulo: "Atualização disponível 🚀",
            corpo: "Toque pra abrir o app e instalar a nova versão.",
          });
          ok++;
        } catch {
          // Um token ruim não pode travar os demais.
        }
      }
    });
    return ok;
  }
}
