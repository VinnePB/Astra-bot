// ai/corpus_more.js
// Extra intents for Astra's smart replies (merged into ai/corpus.js, same shape
// and same rules; see the header of corpus.js). Kept in its own file so the big
// corpus stays readable. After editing: npm run check-ai, then retrain.
//
// Extra placeholder available here: {site_url}  the dashboard address, filled
// from the server's REDIRECT_URI (e.g. <https://projeckt-v.dev>).

module.exports = {
    invite_info: {
        utterances: {
            en: [
                'how do i add astra to my server', 'how can i invite you to my server', 'can i add you to my own server',
                'where is your invite link', 'how do i get you on my server', 'give me your invite link',
                'can you join my server', 'how do i invite the bot', 'i want you in my server',
                'how do i add this bot to another server', 'is there an invite link for astra', 'can i use you on my discord server',
            ],
            pt: [
                'como eu adiciono a astra no meu servidor', 'como posso te convidar pro meu servidor', 'posso te colocar no meu servidor',
                'cadê o seu link de convite', 'como eu te coloco no meu servidor', 'me passa o seu link de convite',
                'você pode entrar no meu servidor', 'como eu convido o bot', 'quero você no meu servidor',
                'como eu coloco esse bot em outro servidor', 'tem link de convite da astra', 'posso te usar no meu servidor do discord',
            ],
        },
        answers: {
            en: [
                'sure, if you can manage a server. log in on the website {site_url}, pick your server on the server list and use the invite button next to it. then run `/quickstart` there.',
                'you add me from the dashboard: {site_url}. log in with Discord, and any server where I\'m not yet has an invite button. you need the Manage Server permission there.',
            ],
            pt: [
                'claro, se você gerencia um servidor. entre no site {site_url}, escolha o servidor na lista e use o botão de convite ao lado dele. depois rode `/quickstart` lá.',
                'você me adiciona pelo painel: {site_url}. entre com o Discord, e todo servidor onde eu ainda não estou tem um botão de convite. você precisa da permissão Gerenciar Servidor lá.',
            ],
        },
    },

    report_scam: {
        utterances: {
            en: [
                'someone is trying to scam me', 'i think this person is a scammer', 'someone sent me a suspicious link',
                'a user is asking for my password', 'i got a weird dm from someone here', 'is this a scam',
                'someone is pretending to be an artist', 'this commission looks like a scam', 'a fake account is messaging me',
                'someone asked me to pay outside the server', 'i think i was phished', 'there is a scammer in this server',
            ],
            pt: [
                'alguém está tentando me aplicar um golpe', 'acho que essa pessoa é golpista', 'alguém me mandou um link suspeito',
                'um usuário está pedindo minha senha', 'recebi uma dm estranha de alguém daqui', 'isso é golpe',
                'alguém está fingindo ser artista', 'essa comissão parece golpe', 'uma conta falsa está me mandando mensagem',
                'alguém pediu pra eu pagar fora do servidor', 'acho que caí num phishing', 'tem um golpista neste servidor',
            ],
        },
        answers: {
            en: [
                'okay, stop and breathe. don\'t click the link, don\'t send money, and never share your password or login codes. screenshot everything, then tell a moderator right away. you can also right-click the message and use Discord\'s own Report.',
                'that sounds sketchy. don\'t reply, don\'t pay, don\'t open anything they sent. screenshots, then straight to a moderator. real artists take commissions through tickets here, so be wary of anyone pushing you to pay somewhere else.',
            ],
            pt: [
                'ok, para e respira. não clica no link, não manda dinheiro e nunca passe sua senha ou códigos de login. tira print de tudo e avisa um moderador agora. você também pode clicar com o botão direito na mensagem e usar a denúncia do próprio Discord.',
                'isso parece suspeito. não responde, não paga, não abre nada que a pessoa mandou. prints, e direto pra um moderador. artistas de verdade fazem comissão por ticket aqui, então desconfie de quem te empurra pra pagar em outro lugar.',
            ],
        },
    },

    bug_report: {
        utterances: {
            en: [
                'the bot is not working', 'astra is not responding', 'a command is not working', 'something is broken',
                'the bot does not answer my commands', 'i found a bug', 'this command gives an error',
                'why is the bot not replying', 'nothing happens when i use the command', 'the verify button does nothing',
                'the bot seems offline', 'it says the application did not respond',
            ],
            pt: [
                'o bot não está funcionando', 'a astra não está respondendo', 'um comando não está funcionando', 'algo está quebrado',
                'o bot não responde meus comandos', 'achei um bug', 'esse comando dá erro',
                'por que o bot não responde', 'nada acontece quando uso o comando', 'o botão de verificar não faz nada',
                'o bot parece estar offline', 'aparece que o aplicativo não respondeu',
            ],
        },
        answers: {
            en: [
                'ugh, fair. tell an admin and include the command and what happened. admins: check that I have Manage Roles, Manage Channels and Manage Messages, and that my role sits above the roles I hand out. most problems are that.',
                'if I\'m glitching, tell an admin so they can check my permissions and role position (my role has to be above the ones I give). if it keeps happening, tell the bot owner what you typed and when.',
            ],
            pt: [
                'poxa, justo. avise um admin e conte qual comando e o que aconteceu. admins: confiram se eu tenho Gerenciar Cargos, Gerenciar Canais e Gerenciar Mensagens, e se o meu cargo está acima dos cargos que eu entrego. quase todo problema é isso.',
                'se eu estiver bugada, avise um admin pra checar minhas permissões e a posição do meu cargo (ele precisa estar acima dos que eu dou). se continuar, conte pro dono do bot o que você digitou e quando.',
            ],
        },
    },

    commission_price: {
        utterances: {
            en: [
                'how much does a commission cost', 'what are the prices for art', 'how much do artists charge',
                'how much is a drawing', 'what is the price of a commission', 'where can i see the prices',
                'how much would an illustration cost', 'are commissions expensive', 'what do the artists charge for a character',
                'do you know the artist prices', 'how much for a sketch', 'what is the cheapest commission',
            ],
            pt: [
                'quanto custa uma comissão', 'quais são os preços das artes', 'quanto os artistas cobram',
                'quanto custa um desenho', 'qual o preço de uma comissão', 'onde eu vejo os preços',
                'quanto custaria uma ilustração', 'as comissões são caras', 'quanto os artistas cobram por um personagem',
                'você sabe os preços dos artistas', 'quanto custa um sketch', 'qual a comissão mais barata',
            ],
        },
        answers: {
            en: [
                'I don\'t set prices, each artist does. `/artists` shows every artist\'s prices, terms and links. pick one, then click **Open a Ticket** in {ticket_channel} to talk to them privately.',
                'depends entirely on the artist. `/artists` lists each one\'s prices and what they will and won\'t draw. found someone you like? open a ticket in {ticket_channel}.',
            ],
            pt: [
                'eu não defino preços, cada artista define o seu. o `/artists` mostra os preços, termos e links de cada um. escolha alguém e clique em **Open a Ticket** em {ticket_channel} pra conversar em privado.',
                'depende totalmente do artista. o `/artists` lista os preços de cada um e o que fazem ou não. achou alguém que gostou? abra um ticket em {ticket_channel}.',
            ],
        },
    },

    commission_wait: {
        utterances: {
            en: [
                'how long does a commission take', 'my artist has not replied yet', 'when will my art be done',
                'the artist is not answering my ticket', 'how long should i wait for my commission', 'is it normal that my artist is slow',
                'my commission is taking forever', 'how long until the artist responds', 'the artist ignored my ticket',
                'how many days for a drawing', 'when do i get my art', 'my ticket has had no reply for days',
            ],
            pt: [
                'quanto tempo demora uma comissão', 'meu artista ainda não respondeu', 'quando minha arte vai ficar pronta',
                'o artista não está respondendo meu ticket', 'quanto tempo devo esperar pela minha comissão', 'é normal meu artista demorar',
                'minha comissão está demorando demais', 'quanto falta pro artista responder', 'o artista ignorou meu ticket',
                'quantos dias leva um desenho', 'quando eu recebo minha arte', 'meu ticket está sem resposta há dias',
            ],
        },
        answers: {
            en: [
                'that depends on the artist, I can\'t hurry them. their terms in `/artists` usually say how long things take. be patient, a polite nudge in your ticket is fine, and if it\'s been days of silence, ask a moderator.',
                'artists have lives, sadly. check their terms in `/artists` for turnaround times, send one polite reminder in your ticket, and if nothing happens for days, a moderator can step in.',
            ],
            pt: [
                'isso depende do artista, eu não consigo apressar ninguém. os termos dele no `/artists` costumam dizer quanto tempo leva. tenha paciência, um lembrete educado no ticket é ok, e se passaram dias de silêncio, fale com um moderador.',
                'artistas têm vida, infelizmente. veja os termos no `/artists` pra saber os prazos, mande um lembrete educado no ticket, e se não acontecer nada por dias, um moderador pode intervir.',
            ],
        },
    },

    permissions_info: {
        utterances: {
            en: [
                'why can i not use this command', 'it says i do not have permission', 'why am i not allowed to use config',
                'i cannot see the config command', 'who can use the admin commands', 'why does the command say missing permissions',
                'how do i get permission to configure the bot', 'why can i not use the panel command', 'only admins can use this',
                'my command does not show up', 'who is allowed to change the settings', 'how do i become an admin of the bot',
            ],
            pt: [
                'por que eu não posso usar esse comando', 'diz que eu não tenho permissão', 'por que eu não posso usar o config',
                'não consigo ver o comando config', 'quem pode usar os comandos de admin', 'por que o comando diz permissões insuficientes',
                'como eu consigo permissão pra configurar o bot', 'por que eu não posso usar o comando panel', 'só admin pode usar isso',
                'meu comando não aparece', 'quem pode mudar as configurações', 'como eu viro admin do bot',
            ],
        },
        answers: {
            en: [
                'some commands are for admins only (like `/config`) and `/panel` is for registered artists. `/help` shows only what you can use. if you think you should have access, ask a server admin; they can grant roles access with `/config admins`.',
                'probably a permissions thing. `/config` and setup commands are for admins, `/panel` for artists, everything else is for everyone. `/help` lists what you personally can run.',
            ],
            pt: [
                'alguns comandos são só pra admins (como o `/config`) e o `/panel` é pra artistas registrados. o `/help` mostra só o que você pode usar. se acha que deveria ter acesso, fale com um admin do servidor; ele pode liberar cargos com `/config admins`.',
                'provavelmente é permissão. o `/config` e os comandos de configuração são de admin, o `/panel` de artista, o resto é de todo mundo. o `/help` lista o que você pode usar.',
            ],
        },
    },

    xp_tips: {
        utterances: {
            en: [
                'how do i get xp faster', 'how can i level up quickly', 'what is the fastest way to level up',
                'does spamming give xp', 'is there a trick to get more xp', 'how much xp do i get per message',
                'why am i not gaining xp', 'why is my xp not going up', 'how do i level faster than others',
                'do i get xp for every message', 'what gives the most xp', 'tips to rank up',
            ],
            pt: [
                'como eu ganho xp mais rápido', 'como posso subir de nível rápido', 'qual a forma mais rápida de subir de nível',
                'spam dá xp', 'tem algum truque pra ganhar mais xp', 'quanto xp eu ganho por mensagem',
                'por que eu não estou ganhando xp', 'por que meu xp não sobe', 'como eu subo mais rápido que os outros',
                'eu ganho xp em toda mensagem', 'o que dá mais xp', 'dicas pra subir de rank',
            ],
        },
        answers: {
            en: [
                'no secret trick, sorry. you earn a small random amount of XP when you chat, with a cooldown between rewards, so spamming gets you nothing. just talk like a normal person, regularly. `/rank` shows your progress. {leveling_note}',
                'XP comes from chatting, a little per message and not on every message (there\'s a cooldown on purpose). spam doesn\'t help, consistency does. check yourself with `/rank`. {leveling_note}',
            ],
            pt: [
                'sem truque secreto, desculpa. você ganha uma quantia pequena e aleatória de XP quando conversa, com um intervalo entre as recompensas, então spam não rende nada. só converse normalmente, com frequência. o `/rank` mostra seu progresso. {leveling_note}',
                'o XP vem de conversar, um pouco por mensagem e não em toda mensagem (o intervalo é de propósito). spam não ajuda, constância ajuda. veja o seu com `/rank`. {leveling_note}',
            ],
        },
    },

    shop_info: {
        utterances: {
            en: [
                'what can i spend my coins on', 'is there a shop', 'how do i buy something', 'what can i buy here',
                'how do i buy a role', 'can i buy a cosmetic role', 'what is the shop command', 'where do i spend my money',
                'what are the shop items', 'how do i use the shop', 'can i buy colors for my name', 'what does the buy command do',
            ],
            pt: [
                'no que eu posso gastar minhas moedas', 'tem loja', 'como eu compro alguma coisa', 'o que eu posso comprar aqui',
                'como eu compro um cargo', 'posso comprar um cargo cosmético', 'o que faz o comando shop', 'onde eu gasto meu dinheiro',
                'quais são os itens da loja', 'como eu uso a loja', 'posso comprar cor pro meu nome', 'o que o comando buy faz',
            ],
        },
        answers: {
            en: [
                'yes! `/shop` lists everything: cosmetic roles the admins set up, plus silly extras like the Town crier (I announce your message), Get roasted, Get hyped, Fake ban and a Mystery box. buy with `/buy`. {economy_note}',
                'spend {currency} in `/shop`: look at the list, then `/buy` the one you want. there are cosmetic roles and a few dumb extras (I will happily roast you for a price). {economy_note}',
            ],
            pt: [
                'tem sim! o `/shop` lista tudo: cargos cosméticos que os admins configuraram, mais extras bobos como o Arauto (eu anuncio sua mensagem), Ser zoado, Ser exaltado, Banimento falso e uma Caixa misteriosa. compre com `/buy`. {economy_note}',
                'gaste {currency} no `/shop`: veja a lista e use `/buy` no que quiser. tem cargos cosméticos e uns extras bobos (eu zoo você com prazer, por um preço). {economy_note}',
            ],
        },
    },

    events_info: {
        utterances: {
            en: [
                'what are the random coin drops', 'how do i get the coin pouch', 'what is the coin rain', 'why did a pouch appear in chat',
                'when do coin drops happen', 'how do the random events work', 'what is that grab it button', 'how do i catch the coins',
                'are there random events', 'who gets the coin drop', 'how often do events happen', 'how can i find free coins',
            ],
            pt: [
                'o que são as moedas aleatórias', 'como eu pego a bolsa de moedas', 'o que é a chuva de moedas', 'por que apareceu uma bolsa no chat',
                'quando as moedas aparecem', 'como funcionam os eventos aleatórios', 'o que é aquele botão de pegar', 'como eu pego as moedas',
                'tem eventos aleatórios', 'quem fica com a moeda que caiu', 'com que frequência os eventos acontecem', 'como eu acho moedas de graça',
            ],
        },
        answers: {
            en: [
                'if an admin turned events on, now and then something drops in chat while people are talking: click **Grab it!** first and the coins are yours, or in a coin rain everyone gets one catch. they never come too often. {economy_note}',
                'random events: a pouch of {currency} appears out of nowhere and the fastest click wins, or it rains and everybody catches some. just keep chatting and keep an eye out. {economy_note}',
            ],
            pt: [
                'se um admin ligou os eventos, de vez em quando algo cai no chat enquanto o pessoal conversa: clique primeiro em **Pegar!** e as moedas são suas, ou numa chuva de moedas todo mundo pega uma vez. nunca vêm com muita frequência. {economy_note}',
                'eventos aleatórios: uma bolsa de {currency} aparece do nada e vence o clique mais rápido, ou chove e todo mundo pega um pouco. é só continuar conversando e ficar de olho. {economy_note}',
            ],
        },
    },

    gamble_info: {
        utterances: {
            en: [
                'how does gambling work', 'how do i gamble my coins', 'what is the gamble command', 'can i bet my coins',
                'is there a coin flip game', 'what are the odds of winning', 'can i double my money', 'is there a casino here',
                'how do i flip a coin for coins', 'what happens if i lose a bet', 'is gambling rigged', 'how much can i bet',
            ],
            pt: [
                'como funciona a aposta', 'como eu aposto minhas moedas', 'o que é o comando gamble', 'posso apostar minhas moedas',
                'tem jogo de cara ou coroa', 'qual a chance de ganhar', 'posso dobrar meu dinheiro', 'tem cassino aqui',
                'como eu jogo uma moeda valendo moedas', 'o que acontece se eu perder uma aposta', 'a aposta é viciada', 'quanto eu posso apostar',
            ],
        },
        answers: {
            en: [
                '`/gamble amount:` flips a coin: heads doubles your bet, tails and it\'s gone. fair warning, the coin is slightly rigged (45% to win), you can bet up to 1000 at a time and there\'s a few seconds of cooldown. {economy_note}',
                'bet with `/gamble`: win and you get double, lose and the coin keeps it. the odds are a little against you on purpose, so only bet what you can laugh about losing. {economy_note}',
            ],
            pt: [
                '`/gamble amount:` joga uma moeda: cara dobra a aposta, coroa e já era. aviso justo: a moeda é levemente viciada (45% de ganhar), dá pra apostar até 1000 por vez e tem alguns segundos de espera. {economy_note}',
                'aposte com `/gamble`: ganhou, leva o dobro; perdeu, a moeda fica com tudo. as chances são um pouco contra você de propósito, então aposte só o que você ri de perder. {economy_note}',
            ],
        },
    },

    // No fixed answers on purpose: commands/ai.js answers these from what she
    // said last (see "follow-up" there). Without a recent topic she asks what you mean.
    followup_more: {
        utterances: {
            en: [
                'tell me more', 'more', 'explain more', 'can you explain that better', 'what do you mean',
                'go on', 'elaborate', 'i did not understand', 'say that again', 'can you repeat that',
                'explain that again', 'i still do not get it', 'and then', 'can you be more specific', 'what else',
            ],
            pt: [
                'me conta mais', 'mais', 'explica mais', 'pode explicar melhor', 'como assim',
                'continua', 'detalha', 'eu não entendi', 'fala de novo', 'pode repetir isso',
                'explica de novo', 'ainda não entendi', 'e depois', 'pode ser mais específica', 'o que mais',
            ],
        },
        answers: { en: [], pt: [] },
    },
};