// Text of the Privacy Policy and Terms of Service (English + Portuguese).
// Rendered by views/legal.ejs. Edit the wording here; the pages update on the next deploy.
// The contact line comes from the CONTACT_EMAIL environment variable (see index.js).

const UPDATED = { en: 'October 17, 2026', 'pt-br': '17 de outubro de 2026' };

const en = {
    privacy: {
        title: 'Privacy Policy',
        intro: 'This policy explains what Projeckt V: Astra ("Astra", the Discord bot, and this website) collects, why, and the choices you have. Astra is built and run by an independent developer.',
        sections: [
            { h: 'What Astra collects', p: ['Astra only keeps what its features need.'], ul: [
                '**When you log in to the website:** your Discord user ID, username, display name and avatar, plus a temporary access token from Discord. The list of servers you belong to is read live to show the ones you manage and is not stored.',
                '**In servers that use Astra:** the settings an administrator chooses (channel and role IDs, custom messages), and, per member, the data of the features they use: XP and level, coin balance and daily streak, pending verification, open tickets, and moderation cases (member ID, moderator ID, action, reason, date).',
                '**Commission artists:** the profile an artist writes themselves (terms of service, "won\'t do" list, prices, links and banner image link).',
                '**Technical logs:** the hosting provider keeps operational logs (errors and request records) that may include IP addresses and Discord IDs for a limited time.'
            ] },
            { h: 'What Astra does not do', ul: [
                'Astra does not store the content of your messages. She reads messages only to react in the moment (commands, "!verify", replies when she is mentioned or called by name) and then discards them.',
                'Her smart replies run on a small classifier inside the bot itself. Your messages are never sent to an AI company or any other third party for this.',
                'Astra does not sell your data and does not show ads.'
            ] },
            { h: 'Why we use this data', p: ['To run the features a server administrator turns on (verification, anti-scam checks, tickets, levels, economy, moderation, updates), to let administrators manage their server on the website, to keep the service secure, and to fix bugs.'] },
            { h: 'Who else handles data', p: ['Astra runs on third-party services: Discord (the platform itself), Render (hosting and database) and Cloudflare (DNS and network protection). Donations are handled entirely by Ko-fi: Astra never sees your payment details. These providers process data under their own policies and may store it outside Brazil.'] },
            { h: 'How long we keep data', ul: [
                'Server data is kept while Astra is in the server. If Astra is removed, the server\'s data is deleted automatically after 30 days (re-adding her within that time restores it).',
                'Website login sessions expire after 30 days of inactivity or when you log out.',
                'Moderation cases are kept as part of a server\'s moderation record while Astra is in the server.',
                'You can ask for your data to be deleted at any time (see "Your rights").'
            ] },
            { h: 'Your rights', p: ['Under Brazilian law (LGPD) and similar laws, you can ask to confirm that we hold data about you, to access it, correct it, delete it, get a copy, or object to its use. To do this, contact us using the details below. Server administrators and moderators are responsible for how they use Astra\'s tools in their own communities, including moderation decisions.'] },
            { h: 'Children', p: ['Astra is for people who are old enough to use Discord under Discord\'s own rules (13 or older, or the minimum age in your country). It is not directed at children.'] },
            { h: 'Security', p: ['We use HTTPS, restricted access and other reasonable measures to protect data, but no online service can promise perfect security. If we learn of a breach that affects you, we will tell you as required by law.'] },
            { h: 'Changes', p: ['We may update this policy as Astra changes. The date at the top shows the latest version. Significant changes will be announced in Astra\'s updates.'] },
        ],
    },
    terms: {
        title: 'Terms of Service',
        intro: 'By adding Astra to a server, logging in to this website or using her commands, you agree to these terms. If you don\'t agree, please don\'t use Astra.',
        sections: [
            { h: 'The service', p: ['Astra is a Discord bot with a web dashboard that offers verification, anti-scam checks, commission tickets, levels, an economy, moderation tools and more. Astra is still in beta: features can change, break or be removed, and she may be offline at times.'] },
            { h: 'Who can use it', p: ['You must follow Discord\'s Terms of Service and Community Guidelines. Only people with the right permissions on a server (such as Administrator) can configure Astra there.'] },
            { h: 'Acceptable use', ul: [
                'Don\'t abuse, overload, exploit or try to break Astra or the website, or look for ways around her permission checks.',
                'Don\'t use Astra to harass, scam, spam or harm others, or for anything illegal.',
                'Don\'t try to access data that is not yours.',
                'We may block users or servers that break these rules, without notice.'
            ] },
            { h: 'Server administrators and moderators', p: ['Administrators are responsible for how Astra is set up in their server, for informing their members, and for their moderation decisions (bans, kicks, timeouts, warnings, deleted messages). Astra only carries out what server staff tell her to do. The developer is not responsible for staff decisions.'] },
            { h: 'Virtual currency and levels', p: ['Coins, XP, levels, shop items and similar things are virtual, have no real-world value, cannot be exchanged for money, and may be changed or reset at any time.'] },
            { h: 'Donations', p: ['Supporting the project through Ko-fi is voluntary. Donations are not payment for a service, do not give you any extra rights or features, and are handled under Ko-fi\'s own terms.'] },
            { h: 'No warranty', p: ['Astra is provided "as is" and "as available", without guarantees of any kind. Use her at your own risk and keep your own backups of anything important.'] },
            { h: 'Limit of liability', p: ['To the extent allowed by law, the developer is not liable for indirect or consequential losses, lost data or lost access caused by using or being unable to use Astra.'] },
            { h: 'Ending use', p: ['You can stop using Astra at any time by removing her from your server. We can stop providing the service, or block access, at any time.'] },
            { h: 'Changes and law', p: ['We may update these terms; continuing to use Astra after a change means you accept it. These terms are governed by the laws of Brazil.'] },
        ],
    },
};

const pt = {
    privacy: {
        title: 'Política de Privacidade',
        intro: 'Esta política explica o que o Projeckt V: Astra ("Astra", o bot do Discord e este site) coleta, por quê, e as escolhas que você tem. A Astra é criada e mantida por um desenvolvedor independente.',
        sections: [
            { h: 'O que a Astra coleta', p: ['A Astra guarda apenas o que os recursos dela precisam.'], ul: [
                '**Ao entrar no site:** seu ID de usuário do Discord, nome de usuário, nome de exibição e avatar, além de um token de acesso temporário do Discord. A lista de servidores em que você está é lida na hora para mostrar os que você administra e não é armazenada.',
                '**Em servidores que usam a Astra:** as configurações escolhidas pelos administradores (IDs de canais e cargos, mensagens personalizadas) e, por membro, os dados dos recursos que ele usa: XP e nível, saldo de moedas e sequência diária, verificação pendente, tickets abertos e casos de moderação (ID do membro, ID do moderador, ação, motivo, data).',
                '**Artistas de comissão:** o perfil que o próprio artista escreve (termos de serviço, lista do que não faz, preços, links e link da imagem de banner).',
                '**Registros técnicos:** o provedor de hospedagem mantém registros operacionais (erros e requisições) que podem incluir endereços IP e IDs do Discord por tempo limitado.'
            ] },
            { h: 'O que a Astra não faz', ul: [
                'A Astra não armazena o conteúdo das suas mensagens. Ela lê mensagens apenas para reagir na hora (comandos, "!verify", respostas quando é mencionada ou chamada pelo nome) e depois as descarta.',
                'As respostas inteligentes dela funcionam com um pequeno classificador dentro do próprio bot. Suas mensagens nunca são enviadas a uma empresa de IA ou a qualquer terceiro para isso.',
                'A Astra não vende seus dados e não exibe anúncios.'
            ] },
            { h: 'Por que usamos esses dados', p: ['Para executar os recursos que o administrador de um servidor ativa (verificação, anti-golpe, tickets, níveis, economia, moderação, novidades), para permitir que administradores gerenciem o servidor no site, para manter o serviço seguro e para corrigir erros.'] },
            { h: 'Quem mais trata dados', p: ['A Astra roda em serviços de terceiros: Discord (a própria plataforma), Render (hospedagem e banco de dados) e Cloudflare (DNS e proteção de rede). As doações são tratadas inteiramente pelo Ko-fi: a Astra nunca vê seus dados de pagamento. Esses provedores tratam dados conforme as próprias políticas e podem armazená-los fora do Brasil.'] },
            { h: 'Por quanto tempo guardamos', ul: [
                'Os dados de um servidor são mantidos enquanto a Astra estiver nele. Se a Astra for removida, os dados do servidor são apagados automaticamente após 30 dias (adicioná-la de novo nesse prazo os restaura).',
                'As sessões do site expiram após 30 dias sem uso ou quando você sai da conta.',
                'Os casos de moderação são mantidos como registro de moderação do servidor enquanto a Astra estiver nele.',
                'Você pode pedir a exclusão dos seus dados a qualquer momento (veja "Seus direitos").'
            ] },
            { h: 'Seus direitos', p: ['Pela legislação brasileira (LGPD) e leis semelhantes, você pode pedir a confirmação de que tratamos dados sobre você, acessá-los, corrigi-los, excluí-los, receber uma cópia ou se opor ao uso. Para isso, fale conosco pelos dados abaixo. Administradores e moderadores de servidores são responsáveis pelo uso que fazem das ferramentas da Astra em suas comunidades, incluindo decisões de moderação.'] },
            { h: 'Crianças', p: ['A Astra é para pessoas com idade suficiente para usar o Discord conforme as regras do próprio Discord (13 anos ou mais, ou a idade mínima do seu país). Ela não é direcionada a crianças.'] },
            { h: 'Segurança', p: ['Usamos HTTPS, acesso restrito e outras medidas razoáveis para proteger os dados, mas nenhum serviço online pode prometer segurança perfeita. Se soubermos de um incidente que afete você, avisaremos conforme exige a lei.'] },
            { h: 'Mudanças', p: ['Podemos atualizar esta política conforme a Astra mudar. A data no topo mostra a versão mais recente. Mudanças importantes serão anunciadas nas novidades da Astra.'] },
        ],
    },
    terms: {
        title: 'Termos de Serviço',
        intro: 'Ao adicionar a Astra a um servidor, entrar neste site ou usar os comandos dela, você concorda com estes termos. Se não concordar, por favor não use a Astra.',
        sections: [
            { h: 'O serviço', p: ['A Astra é um bot do Discord com painel web que oferece verificação, checagem anti-golpe, tickets de comissão, níveis, economia, ferramentas de moderação e mais. A Astra ainda está em beta: recursos podem mudar, quebrar ou ser removidos, e ela pode ficar fora do ar às vezes.'] },
            { h: 'Quem pode usar', p: ['Você deve seguir os Termos de Serviço e as Diretrizes da Comunidade do Discord. Apenas pessoas com as permissões certas em um servidor (como Administrador) podem configurar a Astra nele.'] },
            { h: 'Uso aceitável', ul: [
                'Não abuse, sobrecarregue, explore nem tente quebrar a Astra ou o site, nem procure formas de burlar as checagens de permissão dela.',
                'Não use a Astra para assediar, aplicar golpes, enviar spam ou prejudicar outras pessoas, nem para qualquer coisa ilegal.',
                'Não tente acessar dados que não são seus.',
                'Podemos bloquear usuários ou servidores que quebrarem estas regras, sem aviso.'
            ] },
            { h: 'Administradores e moderadores de servidores', p: ['Os administradores são responsáveis por como a Astra é configurada no servidor deles, por informar seus membros e por suas decisões de moderação (banimentos, expulsões, silenciamentos, advertências, mensagens apagadas). A Astra apenas executa o que a equipe do servidor manda. O desenvolvedor não é responsável pelas decisões da equipe.'] },
            { h: 'Moeda virtual e níveis', p: ['Moedas, XP, níveis, itens da loja e coisas semelhantes são virtuais, não têm valor no mundo real, não podem ser trocados por dinheiro e podem ser alterados ou zerados a qualquer momento.'] },
            { h: 'Doações', p: ['Apoiar o projeto pelo Ko-fi é voluntário. As doações não são pagamento por um serviço, não dão direitos ou recursos extras e são tratadas pelos termos do próprio Ko-fi.'] },
            { h: 'Sem garantia', p: ['A Astra é oferecida "como está" e "conforme disponível", sem garantias de qualquer tipo. Use por sua conta e risco e mantenha seus próprios backups do que for importante.'] },
            { h: 'Limite de responsabilidade', p: ['Na medida permitida por lei, o desenvolvedor não se responsabiliza por perdas indiretas, perda de dados ou perda de acesso causadas pelo uso ou pela impossibilidade de usar a Astra.'] },
            { h: 'Encerrando o uso', p: ['Você pode parar de usar a Astra a qualquer momento removendo-a do seu servidor. Podemos deixar de oferecer o serviço ou bloquear o acesso a qualquer momento.'] },
            { h: 'Mudanças e lei aplicável', p: ['Podemos atualizar estes termos; continuar usando a Astra após uma mudança significa que você a aceita. Estes termos são regidos pelas leis do Brasil.'] },
        ],
    },
};

const UI = {
    en: { updated: 'Last updated', contact: 'Contact', contactVia: 'You can reach us through the', kofi: 'project\'s Ko-fi page', home: 'Home', privacy: 'Privacy Policy', terms: 'Terms of Service', support: 'Support Astra' },
    'pt-br': { updated: 'Última atualização', contact: 'Contato', contactVia: 'Você pode falar conosco pela', kofi: 'página do projeto no Ko-fi', home: 'Início', privacy: 'Política de Privacidade', terms: 'Termos de Serviço', support: 'Apoie a Astra' },
};

function getDoc(kind, lang) {
    const L = lang === 'pt-br' ? 'pt-br' : 'en';
    const doc = (L === 'pt-br' ? pt : en)[kind];
    return doc ? { ...doc, updated: UPDATED[L], ui: UI[L] } : null;
}

module.exports = { getDoc, UI };