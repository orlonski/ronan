import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — Movatruck",
  description:
    "Política de privacidade do app e do painel Movatruck — gestão e rastreamento de viagens em logística B2B.",
};

export default function PoliticaPrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-3xl font-bold text-slate-900">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-slate-500">
          Última atualização: 13 de agosto de 2026
        </p>
      </header>

      <section className="space-y-8 text-base leading-relaxed">
        <P>
          Esta política descreve como o aplicativo <strong>Movatruck</strong> e o
          painel web <strong>Movatruck</strong> tratam dados pessoais e
          operacionais dos motoristas e operadores que utilizam o sistema.
        </P>
        <P>
          O Movatruck é uma ferramenta corporativa de uso restrito, fornecida por
          transportadoras aos motoristas com quem trabalham, para registro e
          rastreamento de viagens comerciais. Cada transportadora contratante
          opera em um ambiente isolado dentro da plataforma e é a{" "}
          <strong>controladora</strong> dos dados dos seus motoristas; a
          Movatruck atua como <strong>operadora</strong>, tratando os dados
          apenas para fazer o sistema funcionar, conforme instrução da
          transportadora.
        </P>

        <H2>1. Quais dados coletamos</H2>
        <P>
          <strong>Dados de cadastro do motorista:</strong> nome, CPF, telefone,
          login, veículo associado e foto de perfil (opcional).
        </P>
        <P>
          <strong>Dados das viagens:</strong> data, ticket, toneladas
          transportadas, quilometragem, material, obra de origem e destino,
          observações, foto do ticket de pesagem, valor de pedágio e
          abastecimento (opcionais).
        </P>
        <P>
          <strong>Localização (GPS):</strong>
        </P>
        <Bullets>
          <li>
            <strong>Ponto de lançamento:</strong> latitude e longitude no momento
            em que o motorista registra cada viagem.
          </li>
          <li>
            <strong>Trajeto (opcional):</strong> sequência de pontos GPS captados
            durante a viagem quando o motorista ativa a função &quot;Iniciar
            viagem com GPS&quot;. A captura ocorre apenas durante o tracking
            ativo e é interrompida ao finalizar a viagem.
          </li>
          <li>
            <strong>Posição de busca de endereço:</strong> usada apenas em tempo
            real para priorizar resultados próximos no autocomplete de endereços.
            Não é armazenada.
          </li>
        </Bullets>
        <P>
          <strong>Pedágios e abastecimentos:</strong> data, praça de pedágio ou
          posto, valor pago, veículo utilizado, foto do comprovante (opcional).
        </P>
        <P>
          <strong>Mensagens:</strong> conversas trocadas no chat do aplicativo
          entre motoristas e com a transportadora, e fotos publicadas nos stories
          (que expiram em 24 horas).
        </P>
        <P>
          <strong>Dados técnicos do dispositivo:</strong> versão do aplicativo e
          token de notificação push, usados para entregar avisos e verificar se o
          app está atualizado.
        </P>

        <H2>2. Para que usamos seus dados</H2>
        <Bullets>
          <li>
            Operação interna da transportadora (controle de viagens, conferência
            com clientes, fechamento mensal).
          </li>
          <li>
            Cálculo da quilometragem oficial entre pontos de carga e descarga,
            usando serviços de roteamento (OSRM auto-hospedado / OpenStreetMap).
          </li>
          <li>
            Comprovação do trajeto efetuado para fins de cobrança e auditoria.
          </li>
          <li>
            Geração de planilhas de fechamento enviadas às empresas-cliente
            contratantes da transportadora.
          </li>
          <li>
            Envio de avisos operacionais ao motorista (notificação push e
            WhatsApp), como resumo do dia e recados da transportadora.
          </li>
        </Bullets>
        <P>
          Não usamos os dados para publicidade, perfilamento comercial ou venda a
          terceiros.
        </P>

        <H2>3. Quem tem acesso</H2>
        <Bullets>
          <li>
            <strong>Operadores da transportadora</strong> (perfis
            ADMIN/OPERADOR): acesso às viagens dos motoristas vinculados à
            própria transportadora, conforme as permissões atribuídas a cada
            usuário.
          </li>
          <li>
            <strong>O próprio motorista</strong> (perfil MOTORISTA): acesso
            apenas às próprias viagens, pedágios e abastecimentos.
          </li>
          <li>
            <strong>Empresa contratante:</strong> acesso indireto, apenas aos
            dados consolidados em planilha mensal exportada pela transportadora
            (toneladas, datas, tickets, quilometragem).
          </li>
          <li>
            <strong>Equipe da Movatruck:</strong> acesso técnico restrito, apenas
            quando necessário para manutenção, suporte ou correção de falhas.
          </li>
        </Bullets>
        <P>
          Os dados de cada transportadora são isolados dos das demais: uma
          transportadora não enxerga motoristas, viagens ou mensagens de outra.
        </P>

        <H2>4. Compartilhamento com terceiros</H2>
        <P>
          Não compartilhamos dados pessoais com terceiros para fins
          publicitários, comerciais ou de análise externa.
        </P>
        <P>
          Os seguintes serviços são utilizados estritamente para funcionamento
          técnico:
        </P>
        <Bullets>
          <li>
            <strong>Google Maps Platform</strong> (Places API e Maps SDK): usado
            para autocomplete de endereços e renderização de mapas. Apenas a
            consulta de busca e a posição GPS no momento da consulta são
            enviadas, sem identificação do motorista.
          </li>
          <li>
            <strong>OpenStreetMap / OSRM</strong> (servidor próprio): usado para
            cálculo de rota. Recebe apenas as coordenadas de origem e destino,
            sem nenhum dado do motorista.
          </li>
          <li>
            <strong>Expo / EAS</strong>: plataforma de distribuição do aplicativo
            (atualizações via OTA). Não recebe dados pessoais nem de viagens.
          </li>
          <li>
            <strong>Firebase Cloud Messaging</strong> (Google): entrega das
            notificações push. Recebe o token do dispositivo e o texto do aviso.
          </li>
          <li>
            <strong>WhatsApp</strong> (Meta): envio de avisos e códigos de
            verificação ao número informado pelo motorista.
          </li>
          <li>
            <strong>Provedores de inteligência artificial</strong> (Anthropic,
            Google e OpenAI): leitura automática da foto do ticket de pesagem
            para preencher os campos da viagem. Recebem apenas a imagem do
            ticket, sem identificação do motorista, e não a usam para treinar
            modelos.
          </li>
        </Bullets>

        <H2>5. Localização em segundo plano</H2>
        <P>
          Quando o motorista ativa a função <strong>&quot;Iniciar viagem com
          GPS&quot;</strong>, o app captura a localização em segundo plano (com
          o app fechado ou bloqueado) durante toda a duração da viagem. Isto
          requer a permissão Android &quot;Permitir o tempo todo&quot; ou iOS
          &quot;Sempre permitir&quot;.
        </P>
        <P>
          A localização em segundo plano é usada exclusivamente para registrar o
          trajeto e calcular a quilometragem real percorrida na viagem. Ela não é
          usada para monitorar o motorista fora da viagem, não alimenta
          publicidade e não é compartilhada com terceiros.
        </P>
        <P>
          A captura é interrompida automaticamente quando o motorista toca em
          &quot;Finalizar viagem&quot; ou descarta o tracking. Os pontos
          capturados são armazenados localmente no celular até serem enviados ao
          servidor junto com o registro da viagem.
        </P>
        <P>
          O motorista pode revogar essa permissão a qualquer momento nas
          configurações do sistema operacional. Sem ela, o tracking deixa de
          funcionar mas o aplicativo segue operacional para registro manual.
        </P>

        <H2>6. Armazenamento</H2>
        <P>
          Todos os dados ficam armazenados em servidor próprio da Movatruck, e
          não em plataformas de terceiros. Backups são feitos pela própria
          Movatruck.
        </P>
        <P>
          Fotos de tickets e comprovantes ficam armazenadas em sistema de objetos
          auto-hospedado (MinIO).
        </P>

        <H2>7. Tempo de retenção</H2>
        <P>
          Os dados ficam armazenados enquanto o vínculo entre o motorista e a
          transportadora estiver ativo, e por até 5 (cinco) anos após o
          encerramento, para fins de auditoria fiscal e contábil exigidos por
          legislação brasileira.
        </P>
        <P>
          Fotos publicadas em stories são excluídas automaticamente 24 horas após
          a publicação.
        </P>

        <H2>8. Seus direitos (LGPD)</H2>
        <P>
          De acordo com a Lei Geral de Proteção de Dados Pessoais (Lei
          13.709/2018), você pode solicitar a qualquer momento:
        </P>
        <Bullets>
          <li>Confirmação de existência de tratamento de dados pessoais;</li>
          <li>Acesso aos dados;</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>Portabilidade dos dados a outro fornecedor de serviço;</li>
          <li>Eliminação dos dados pessoais tratados com seu consentimento.</li>
        </Bullets>
        <P>
          Para exercer qualquer um desses direitos, entre em contato pelo email
          abaixo. Pedidos de exclusão de conta e dos dados associados também podem
          ser feitos por esse canal e são atendidos em até 30 dias, ressalvados os
          dados que a legislação fiscal obriga a manter.
        </P>

        <H2>9. Segurança</H2>
        <P>
          Dados em trânsito são criptografados via HTTPS/TLS. Senhas são
          armazenadas com hash bcrypt. Tokens de autenticação ficam armazenados
          de forma segura (SecureStore no app, cookies HttpOnly no painel web).
        </P>

        <H2>10. Crianças e adolescentes</H2>
        <P>
          O Movatruck é uma ferramenta corporativa destinada exclusivamente a
          motoristas profissionais maiores de 18 anos vinculados a empresas
          transportadoras. Não coletamos dados de menores de idade.
        </P>

        <H2>11. Alterações nesta política</H2>
        <P>
          Esta política pode ser atualizada periodicamente. Quando houver
          alterações relevantes, comunicaremos via aplicativo e/ou painel.
        </P>

        <H2>12. Contato</H2>
        <P>
          Para dúvidas, solicitações ou exercício de direitos previstos na LGPD,
          entre em contato com a transportadora responsável pelo seu vínculo, ou
          com a Movatruck pelo email:{" "}
          <a
            href="mailto:contato@movatruck.com.br"
            className="text-blue-600 underline"
          >
            contato@movatruck.com.br
          </a>
          .
        </P>
      </section>
    </main>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 text-xl font-semibold text-slate-900">{children}</h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}
