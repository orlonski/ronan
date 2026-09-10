/**
 * Cliente mínimo pra ler a flag. Tipado por forma, e não como `PrismaService`,
 * pelo mesmo motivo de `para-cada-conta.ts`: este arquivo mora ao lado da trava
 * e o import direto fecharia um ciclo.
 */
type ClienteConta = {
  conta: {
    findUnique: (args: {
      where: { id: string };
      select: { ehPlataforma: true };
    }) => Promise<{ ehPlataforma: boolean } | null>;
  };
};

/**
 * A conta da plataforma é a casa: a Movatruck, dona do sistema. Ela manda no
 * WhatsApp que todas as empresas dividem, nas chaves de IA que ela paga e na
 * versão do app que publica nas lojas — as empresas clientes mandam só na
 * operação delas.
 *
 * Era resolvido em dois serviços por `ORDER BY criadaEm ASC LIMIT 1`. Agora é
 * `Conta.ehPlataforma`, num lugar só. `Conta` está em `MODELS_GLOBAIS`, então
 * esta leitura não depende do contexto de conta da requisição.
 */
export async function ehContaDaPlataforma(
  prisma: ClienteConta,
  contaId: string,
): Promise<boolean> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: { ehPlataforma: true },
  });
  return conta?.ehPlataforma ?? false;
}
