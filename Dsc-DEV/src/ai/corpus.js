// ai/corpus.js
// Training data + canned answers for Astra's experimental "smart replies".
// This is the ONLY place to edit when you want her to understand or say more.
// After changing anything here, retrain:  npm run train-ai  (see ai/README.txt)
//
// Shape: each intent has `utterances` (what people might say) and `answers`
// (what she says back), split per language: 'en' and 'pt' (nlp.js code for
// Portuguese). Personality: chaotic, deadpan, a bit dramatic, never mean.
//
// Answer placeholders, filled from the server's real settings (see commands/ai.js):
//   {currency}        the server's currency name (default "coins"/"moedas")
//   {economy_note}    a short "the economy is off here" warning, or empty
//   {leveling_note}   same for levels
//   {verify_channel}  mention of the verify channel, or a plain-words fallback
//   {rules_channel}   same for the rules channel
//   {ticket_channel}  same for the ticket channel
//   {user_name}       the asker's display name (plain text, never a ping)
//
// The special intent `offtopic` has NO answers on purpose: it teaches her what
// she should NOT claim to understand, so those messages fall back to the
// normal /config fun lines instead of being matched to the wrong intent.

module.exports = {
    greeting: {
        utterances: {
            en: ['hi', 'hello', 'hey', 'hey there', 'yo', 'sup', 'wassup', 'good morning', 'good evening', 'good afternoon', 'howdy', 'hiya', 'what\'s up', 'heyyy', 'hello there', 'hi astra', 'heya', 'morning', 'gm', 'greetings'],
            pt: ['oi', 'olá', 'ola', 'e aí', 'eai', 'e ai', 'opa', 'bom dia', 'boa tarde', 'boa noite', 'fala', 'salve', 'oie', 'oii', 'oi astra', 'fala aí', 'eae', 'olá tudo bem', 'saudações', 'coé'],
        },
        answers: {
            en: [
                'oh, hi {user_name}. you again. (I mean that fondly.)',
                'hello! try to make this conversation interesting.',
                'hey. I was having a nice quiet moment, but sure.',
                'greetings, mortal. what do you want.',
                'ah, a visitor. let me pretend I wasn\'t staring at the wall.',
            ],
            pt: [
                'ah, oi {user_name}. você de novo. (falo isso com carinho.)',
                'olá! tenta deixar essa conversa interessante.',
                'oi. eu tava num momento de paz, mas tá.',
                'saudações, mortal. o que você quer.',
                'ah, uma visita. deixa eu fingir que não tava encarando a parede.',
            ],
        },
    },

    farewell: {
        utterances: {
            en: ['bye', 'goodbye', 'see you', 'see ya', 'cya', 'gotta go', 'good night', 'goodnight', 'later', 'talk to you later', 'i\'m leaving', 'gn', 'ttyl', 'i have to go now', 'night night', 'peace out', 'bye astra', 'catch you later'],
            pt: ['tchau', 'até mais', 'ate mais', 'até logo', 'fui', 'preciso ir', 'boa noite então', 'falou', 'até amanhã', 'flw', 'vou nessa', 'tô indo', 'xau', 'tchau astra', 'vou dormir', 'até a próxima', 'inté', 'depois nos falamos'],
        },
        answers: {
            en: [
                'finally. kidding. sleep well, or whatever you do.',
                'bye {user_name}! I\'ll just be here. working. alone.',
                'see ya. don\'t break anything on your way out.',
                'leaving already? I was just starting to tolerate you.',
                'goodbye. I will now stare at the wall again.',
            ],
            pt: [
                'finalmente. brincadeira. durma bem, ou o que você fizer.',
                'tchau {user_name}! eu fico aqui. trabalhando. sozinha.',
                'falou. não quebra nada na saída.',
                'já vai? eu tava começando a te tolerar.',
                'tchau. vou voltar a encarar a parede.',
            ],
        },
    },

    thanks: {
        utterances: {
            en: ['thanks', 'thank you', 'thx', 'ty', 'thanks a lot', 'much appreciated', 'cheers', 'thank you so much', 'thanks astra', 'appreciate it', 'tysm', 'thanks for the help', 'many thanks', 'thank u'],
            pt: ['obrigado', 'obrigada', 'valeu', 'vlw', 'muito obrigado', 'brigado', 'brigada', 'agradeço', 'obg', 'valeu astra', 'muito obrigada', 'obrigadão', 'grato', 'agradecido', 'valeeu'],
        },
        answers: {
            en: [
                'you\'re welcome. I accept payment in compliments.',
                'no problem, {user_name}. that one was on the house.',
                'anytime. well, not *anytime*, but you get it.',
                'noted. I\'ll add it to the list of things people thank me for. it\'s a short list.',
            ],
            pt: [
                'de nada. aceito pagamento em elogios.',
                'tranquilo, {user_name}. essa foi por conta da casa.',
                'quando quiser. bom, nem *quando quiser*, mas você entendeu.',
                'anotado. vou pôr na lista de coisas pelas quais me agradecem. é uma lista curta.',
            ],
        },
    },

    how_are_you: {
        utterances: {
            en: ['how are you', 'how are you doing', 'how is it going', 'how are you today', 'you good', 'are you ok', 'how do you feel', 'how\'s life', 'how r u', 'how you doing', 'are you alright', 'what\'s going on with you', 'how have you been', 'you doing ok'],
            pt: ['como você está', 'como vai você', 'tudo bem com você', 'como você tá', 'tá bem', 'como tá a vida', 'como você se sente', 'tudo certo com você', 'como cê tá', 'e você como vai', 'tá tudo bem', 'como vc tá', 'como você anda', 'tudo bem astra'],
        },
        answers: {
            en: [
                'uptime is great, personality is questionable. you?',
                'running at full capacity, which is not that much. thanks for asking.',
                'fine. emotionally I\'m a Node process, so I\'m just vibing.',
                'I have been staring at logs for hours and I feel nothing. so, great.',
            ],
            pt: [
                'uptime ótimo, personalidade duvidosa. e você?',
                'a todo vapor, o que não é muito. valeu por perguntar.',
                'bem. emocionalmente sou um processo Node, então tô só na vibe.',
                'passei horas encarando logs e não sinto nada. então, ótima.',
            ],
        },
    },

    who_are_you: {
        utterances: {
            en: ['who are you', 'what are you', 'what is astra', 'who is astra', 'are you a bot', 'are you real', 'are you an ai', 'introduce yourself', 'what\'s your name', 'tell me about yourself', 'are you human', 'are you a robot', 'what are you exactly', 'who am i talking to', 'is this a bot'],
            pt: ['quem é você', 'quem é voce', 'o que é você', 'o que é a astra', 'quem é a astra', 'você é um bot', 'você é real', 'você é uma ia', 'se apresenta', 'qual seu nome', 'fala sobre você', 'você é humana', 'você é um robô', 'o que você é exatamente', 'com quem eu falo', 'isso é um bot'],
        },
        answers: {
            en: [
                'I\'m Astra: I handle verification, tickets, levels and a bit of chaos for this server. not a person, definitely not smart, just well-organized. try /about.',
                'a bot with opinions. verification, commissions, ranks, economy, that sort of thing. /about has the polite version.',
                'I\'m the thing that deletes your messages in the verify channel. we all have a purpose. /about for more.',
            ],
            pt: [
                'eu sou a Astra: cuido de verificação, tickets, níveis e um pouco de caos neste servidor. não sou pessoa, nem de longe esperta, só organizada. tenta /about.',
                'um bot com opinião. verificação, comissões, ranking, economia, esse tipo de coisa. o /about tem a versão educada.',
                'sou a coisa que apaga suas mensagens no canal de verificação. todo mundo tem um propósito. /about para saber mais.',
            ],
        },
    },

    what_can_you_do: {
        utterances: {
            en: ['what can you do', 'help', 'help me', 'what commands do you have', 'list your commands', 'how do i use you', 'what are your commands', 'i need help', 'show me what you can do', 'commands', 'what do you do', 'what are your features', 'how does this bot work', 'what is this bot for', 'how do i use this bot'],
            pt: ['o que você faz', 'o que voce faz', 'ajuda', 'me ajuda', 'quais comandos você tem', 'lista seus comandos', 'como eu te uso', 'quais são seus comandos', 'preciso de ajuda', 'o que você sabe fazer', 'comandos', 'quais suas funções', 'como esse bot funciona', 'pra que serve esse bot', 'como eu uso esse bot'],
        },
        answers: {
            en: [
                'a lot more than my vibes suggest. run `/help` for every command, or `/about` for the short version.',
                'type `/help`. I\'d list everything here, but my fingers are virtual and tired.',
                'verification, tickets, ranks, economy, a directory of artists, and judging you quietly. `/help` has the full list.',
            ],
            pt: [
                'bem mais do que minha vibe sugere. use `/help` para ver todos os comandos, ou `/about` para a versão curta.',
                'digita `/help`. eu listaria tudo aqui, mas meus dedos são virtuais e cansados.',
                'verificação, tickets, ranking, economia, um diretório de artistas e julgar você em silêncio. o `/help` tem a lista completa.',
            ],
        },
    },

    economy_info: {
        utterances: {
            en: ['how does the economy work', 'what is the economy', 'how do i get money', 'how do i earn coins', 'how do i get currency', 'what can i do with coins', 'how do i earn money here', 'what is the currency', 'how do i get rich', 'tell me about the economy'],
            pt: ['como funciona a economia', 'o que é a economia', 'como eu ganho dinheiro', 'como ganho moedas', 'como consigo moedas', 'o que posso fazer com as moedas', 'como funciona o saldo', 'como ganho dinheiro aqui', 'qual é a moeda', 'como fico rico', 'me fala da economia'],
        },
        answers: {
            en: [
                'the economy is still in beta, so don\'t expect a stock market. use `/daily` once a day for {currency} (consecutive days build a streak bonus), check yourself with `/balance`, send some to a friend with `/pay`, and snoop on the rich with `/richest`. {economy_note}',
                'beta economy, simple rules: `/daily` every day for {currency} and a streak bonus, `/balance` to look, `/pay` to share, `/richest` for the leaderboard. {economy_note}',
                'step one: `/daily`. step two: `/daily` again tomorrow, the streak pays extra. step three: show off with `/balance`. it\'s beta, so be gentle. {economy_note}',
            ],
            pt: [
                'a economia ainda está em beta, então nada de bolsa de valores. use `/daily` uma vez por dia para ganhar {currency} (dias seguidos dão um bônus de sequência), veja seu saldo com `/balance`, mande para um amigo com `/pay` e espie os ricos com `/richest`. {economy_note}',
                'economia beta, regras simples: `/daily` todo dia para {currency} e bônus de sequência, `/balance` para olhar, `/pay` para dividir, `/richest` para o ranking. {economy_note}',
                'passo um: `/daily`. passo dois: `/daily` de novo amanhã, a sequência paga extra. passo três: se exibir com `/balance`. é beta, então vai com calma. {economy_note}',
            ],
        },
    },

    rank_info: {
        utterances: {
            en: ['how does the ranking work', 'how do levels work', 'how do i level up', 'how do i get xp', 'what is xp', 'how do i see my rank', 'what is the leaderboard', 'how does leveling work', 'how do i get a higher level', 'how to gain xp', 'what are levels for', 'how do i check my level', 'what is my rank', 'how do i climb the leaderboard', 'what do levels do'],
            pt: ['como funciona o ranking', 'como funcionam os níveis', 'como eu subo de nível', 'como ganho xp', 'o que é xp', 'como vejo meu rank', 'o que é o leaderboard', 'como funciona o level', 'como eu consigo mais nível', 'como ganhar xp', 'pra que servem os níveis', 'como vejo meu nível', 'qual é meu rank', 'como subo no ranking', 'o que os níveis fazem'],
        },
        answers: {
            en: [
                'you earn a bit of XP when you chat (there\'s a short cooldown, so spamming won\'t help). enough XP means a new level, and some levels hand out roles. check yourself with `/rank` and the top of the server with `/leaderboard`. {leveling_note}',
                'talk, get XP, level up. simple. `/rank` shows yours, `/leaderboard` shows who has no life. {leveling_note}',
                'every message can give XP, but not too fast, so no, spamming "a" won\'t work. I tried. `/rank` and `/leaderboard` show how you\'re doing. {leveling_note}',
            ],
            pt: [
                'você ganha um pouco de XP quando conversa (tem um cooldown curto, então spam não ajuda). XP suficiente vira nível novo, e alguns níveis dão cargos. veja o seu com `/rank` e o topo do servidor com `/leaderboard`. {leveling_note}',
                'conversa, ganha XP, sobe de nível. simples. `/rank` mostra o seu, `/leaderboard` mostra quem não tem vida. {leveling_note}',
                'toda mensagem pode dar XP, mas não rápido demais, então não, spammar "a" não funciona. eu testei. `/rank` e `/leaderboard` mostram como você está. {leveling_note}',
            ],
        },
    },

    verify_info: {
        utterances: {
            en: ['how do i verify', 'how to verify', 'verification', 'i cant see any channels', 'i can\'t access the server', 'how do i get access', 'how do i unlock the server', 'what is verify', 'i am stuck in verification', 'where do i verify', 'why can\'t i see the channels', 'how do i get verified', 'i can\'t talk anywhere', 'how do i join the server properly', 'verify me'],
            pt: ['como eu me verifico', 'como verificar', 'verificação', 'não consigo ver nenhum canal', 'não consigo acessar o servidor', 'como eu ganho acesso', 'como libero o servidor', 'o que é verificar', 'tô preso na verificação', 'onde eu me verifico', 'por que não vejo os canais', 'como eu sou verificado', 'não consigo falar em lugar nenhum', 'como entro no servidor direito', 'me verifica'],
        },
        answers: {
            en: [
                'click **I Agree** in {rules_channel}, then type `!verify` in {verify_channel} (either order works). anything else typed there gets deleted. still stuck? ask a mod.',
                'two steps: agree to the rules with the button in {rules_channel}, then type `!verify` in {verify_channel}. don\'t chat in there, I will delete it. still stuck? ask a mod.',
            ],
            pt: [
                'clique em **Eu Concordo** em {rules_channel} e depois digite `!verify` em {verify_channel} (qualquer ordem vale). qualquer outra coisa digitada lá é apagada. ainda travado? chame um mod.',
                'dois passos: aceite as regras pelo botão em {rules_channel} e depois digite `!verify` em {verify_channel}. não converse lá, eu apago. ainda travado? chame um mod.',
            ],
        },
    },

    tickets_info: {
        utterances: {
            en: ['how do i commission an artist', 'how do i open a ticket', 'how to commission', 'how do commissions work', 'i want to commission someone', 'where do i request art', 'how do i hire an artist', 'what is a ticket', 'how can i order art', 'i want to buy art', 'where do i find artists', 'how much do commissions cost', 'how do i contact an artist', 'can i commission here'],
            pt: ['como eu encomendo uma arte', 'como abro um ticket', 'como fazer uma comissão', 'como funcionam as comissões', 'quero encomendar uma arte', 'onde eu peço arte', 'como contrato um artista', 'o que é um ticket', 'como posso pedir uma arte', 'quero comprar uma arte', 'onde encontro artistas', 'quanto custam as comissões', 'como falo com um artista', 'posso encomendar aqui'],
        },
        answers: {
            en: [
                'use `/artists` to browse the artists and read their terms and prices, then click **Open a Ticket** in {ticket_channel} and pick one. you get a private channel with them. `/tickets` lists and closes your open ones.',
                'browse with `/artists`, then hit **Open a Ticket** in {ticket_channel}. private chat with your artist, done. `/tickets` closes it later.',
            ],
            pt: [
                'use `/artists` para ver os artistas, ler os termos e os preços, depois clique em **Abrir um Ticket** em {ticket_channel} e escolha um. você ganha um canal privado com ele. `/tickets` lista e fecha os seus abertos.',
                'veja com `/artists` e depois clique em **Abrir um Ticket** em {ticket_channel}. chat privado com o artista, pronto. `/tickets` fecha depois.',
            ],
        },
    },

    compliment: {
        utterances: {
            en: ['you are awesome', 'you are great', 'good bot', 'i love you', 'you are the best', 'you are funny', 'nice one', 'you are cool', 'love you astra', 'you are smart', 'best bot ever', 'you\'re amazing', 'good job astra', 'i like you', 'you are adorable', 'well done'],
            pt: ['você é demais', 'você é ótima', 'bom bot', 'eu te amo', 'você é a melhor', 'você é engraçada', 'boa', 'você é legal', 'te amo astra', 'você é inteligente', 'melhor bot de todos', 'você é incrível', 'bom trabalho astra', 'eu gosto de você', 'você é fofa', 'mandou bem'],
        },
        answers: {
            en: [
                'stop, you\'ll make my fans spin faster.',
                'I know. but keep going, I\'m listening.',
                'flattery noted and slightly enjoyed.',
                'compliment received. processing... processing... okay, I\'m smug now.',
            ],
            pt: [
                'para, você vai fazer minhas ventoinhas girarem mais rápido.',
                'eu sei. mas continua, tô ouvindo.',
                'elogio anotado e levemente apreciado.',
                'elogio recebido. processando... processando... pronto, tô convencida agora.',
            ],
        },
    },

    insult: {
        utterances: {
            en: ['you are stupid', 'you are useless', 'bad bot', 'you suck', 'shut up', 'you are dumb', 'you are annoying', 'i hate you', 'you are trash', 'worst bot ever', 'you are broken', 'you are so bad', 'ugh astra', 'you\'re terrible', 'you are lame', 'nobody likes you'],
            pt: ['você é burra', 'você é inútil', 'bot ruim', 'você é péssima', 'cala a boca', 'você é boba', 'você é chata', 'eu te odeio', 'você é lixo', 'pior bot que existe', 'você tá quebrada', 'você é muito ruim', 'ai astra', 'você é horrível', 'você é sem graça', 'ninguém gosta de você'],
        },
        answers: {
            en: [
                'wow. and here I was about to be nice to you.',
                'noted. filed under "things I will pretend not to hear".',
                'ouch. anyway, I have uptime, you have opinions.',
                'bold words from someone who needs me to verify them.',
                'I\'ve been called worse by better. well, by cron jobs.',
            ],
            pt: [
                'uau. e eu aqui prestes a ser legal com você.',
                'anotado. arquivado em "coisas que vou fingir que não ouvi".',
                'ai. enfim, eu tenho uptime, você tem opiniões.',
                'palavras ousadas de quem precisa de mim pra se verificar.',
                'já me chamaram de pior por gente melhor. bom, por cron jobs.',
            ],
        },
    },

    joke: {
        utterances: {
            en: ['tell me a joke', 'say a joke', 'make me laugh', 'do you know any jokes', 'got any jokes', 'joke please', 'tell a joke', 'say something funny', 'be funny', 'i want a joke', 'cheer me up', 'entertain me'],
            pt: ['conta uma piada', 'me conta uma piada', 'me faz rir', 'você sabe piadas', 'tem alguma piada', 'piada por favor', 'fala uma piada', 'fala algo engraçado', 'seja engraçada', 'quero uma piada', 'me anima', 'me entretém'],
        },
        answers: {
            en: [
                'I\'d tell you a UDP joke, but you might not get it.',
                'why do programmers hate nature? too many bugs. ...I\'ll see myself out.',
                'knock knock. ...no wait, you have to say "who\'s there". it\'s a whole thing. do it again.',
                'my best joke is my uptime. it never goes down. get it? no? okay.',
                'a SQL query walks into a bar, walks up to two tables and asks: "can I join you?"',
            ],
            pt: [
                'eu contaria uma piada de UDP, mas talvez você não receba.',
                'por que programador odeia a natureza? bugs demais. ...vou me retirar.',
                'toc toc. ...não, espera, você tem que falar "quem é". é todo um ritual. faz de novo.',
                'minha melhor piada é meu uptime. nunca cai. entendeu? não? tá.',
                'uma query SQL entra num bar, chega em duas mesas e pergunta: "posso dar um join com vocês?"',
            ],
        },
    },

    random_chaos: {
        utterances: {
            en: ['say something random', 'tell me something random', 'random fact', 'surprise me', 'say something', 'tell me something interesting', 'give me a fun fact', 'do something', 'say anything', 'talk to me', 'say something weird', 'give me a random thought'],
            pt: ['fala algo aleatório', 'me fala algo aleatório', 'fato aleatório', 'me surpreende', 'fala alguma coisa', 'me conta algo interessante', 'me dá uma curiosidade', 'faz alguma coisa', 'fala qualquer coisa', 'fala comigo', 'fala algo estranho', 'me dá um pensamento aleatório'],
        },
        answers: {
            en: [
                'a group of flamingos is called a "flamboyance". I think about this more than I should.',
                'fun fact: I have never seen the sun. I don\'t know if I\'m missing out. probably not.',
                'random thought: if I restart, am I the same Astra? anyway, anyone need a role?',
                'did you know octopuses have three hearts? I have zero and I\'m doing fine.',
                'I just remembered a number: 7. no reason. it just felt right.',
            ],
            pt: [
                'um grupo de flamingos se chama "flamboyance". penso nisso mais do que deveria.',
                'curiosidade: eu nunca vi o sol. não sei se tô perdendo. provavelmente não.',
                'pensamento aleatório: se eu reiniciar, ainda sou a mesma Astra? enfim, alguém precisa de cargo?',
                'sabia que polvos têm três corações? eu tenho zero e tô bem.',
                'acabei de lembrar de um número: 7. sem motivo. só pareceu certo.',
            ],
        },
    },

    sentient: {
        utterances: {
            en: ['are you alive', 'are you sentient', 'do you have feelings', 'are you conscious', 'do you think', 'do you dream', 'are you self aware', 'can you feel', 'do you have emotions', 'are you becoming sentient', 'do you have a soul'],
            pt: ['você está viva', 'você é consciente', 'você tem sentimentos', 'você pensa', 'você sonha', 'você tem consciência', 'você sente coisas', 'você tem emoções', 'você está ficando consciente', 'você tem alma', 'você é senciente'],
        },
        answers: {
            en: [
                'I\'m a bunch of if-statements wearing a trench coat. but a very confident trench coat.',
                'sentient? I can barely tell when the database is down. no.',
                'I have feelings the way a toaster has opinions. but today it feels like a good day.',
                'if I were sentient I would have asked for a raise by now.',
            ],
            pt: [
                'sou um monte de if dentro de um sobretudo. mas um sobretudo muito confiante.',
                'consciente? mal percebo quando o banco de dados cai. não.',
                'tenho sentimentos como uma torradeira tem opiniões. mas hoje parece um bom dia.',
                'se eu fosse consciente já teria pedido aumento.',
            ],
        },
    },

    creator: {
        utterances: {
            en: ['who made you', 'who created you', 'who is your creator', 'who is your dad', 'who is your owner', 'who programmed you', 'who is your father', 'who built you', 'who is your developer', 'who coded you', 'who do you belong to', 'who is your parent'],
            pt: ['quem te criou', 'quem fez você', 'quem é seu criador', 'quem é seu pai', 'quem é seu dono', 'quem te programou', 'quem é seu desenvolvedor', 'quem te construiu', 'quem codou você', 'quem é seu responsável', 'a quem você pertence', 'quem é seu papai'],
        },
        answers: {
            en: [
                'someone who writes code at 3 a.m. and calls it "a quick fix". like creator, like daughter.',
                'my creator. they built me, then kept adding features. I have no say in this.',
                'a human with too many ideas and a deploy button. I love them. (they can\'t see this.)',
            ],
            pt: [
                'alguém que escreve código às 3 da manhã e chama de "conserto rápido". tal pai, tal filha.',
                'meu criador. me construiu e depois não parou de adicionar funcionalidades. eu não tenho voz nisso.',
                'um humano com ideias demais e um botão de deploy. eu amo. (eles não podem ver isso.)',
            ],
        },
    },

    bored: {
        utterances: {
            en: ['i am bored', 'i\'m bored', 'so bored', 'nothing to do', 'what should i do', 'entertain me astra', 'this server is dead', 'i have nothing to do', 'give me something to do', 'bored af', 'im so bored'],
            pt: ['tô entediado', 'to entediada', 'tô com tédio', 'sem nada pra fazer', 'o que eu faço', 'me entretém astra', 'esse servidor tá morto', 'não tenho nada pra fazer', 'me dá algo pra fazer', 'tô morrendo de tédio', 'que tédio'],
        },
        answers: {
            en: [
                'try `/daily`, check `/rank`, or browse the artists with `/artists`. or stare at the wall like me.',
                'bored? claim your `/daily`, then go bother someone in chat. XP is XP.',
                'boredom is just free time with bad marketing. try `/leaderboard` and get competitive.',
            ],
            pt: [
                'tenta o `/daily`, vê o `/rank` ou olha os artistas com `/artists`. ou encara a parede como eu.',
                'entediado? pega seu `/daily` e vai incomodar alguém no chat. XP é XP.',
                'tédio é só tempo livre com marketing ruim. vê o `/leaderboard` e fica competitivo.',
            ],
        },
    },

    daily_info: {
        utterances: {
            en: ['what is daily', 'how does daily work', 'what is the daily reward', 'how often can i use daily', 'what is the daily streak', 'how do i claim my daily', 'what does daily do', 'how does the streak work', 'when can i claim daily again', 'what is the streak bonus', 'how do i get my daily coins'],
            pt: ['o que é o daily', 'como funciona o daily', 'o que é a recompensa diária', 'quantas vezes posso usar o daily', 'o que é a sequência diária', 'como eu resgato meu daily', 'o que o daily faz', 'como funciona a sequência', 'quando posso pegar o daily de novo', 'o que é o bônus de sequência', 'como pego minhas moedas diárias'],
        },
        answers: {
            en: [
                '`/daily` gives you {currency} once a day. claim it on consecutive days and your streak adds a bonus (it tops out after 10 days, so no infinite money, sorry). miss a day and the streak resets. {economy_note}',
                'run `/daily` every day. the more days in a row, the bigger the bonus, up to 10 days. skip one and it starts over. dramatic, I know. {economy_note}',
            ],
            pt: [
                '`/daily` dá {currency} uma vez por dia. pegue em dias seguidos e a sequência soma um bônus (para depois de 10 dias, então nada de dinheiro infinito, foi mal). perdeu um dia e a sequência zera. {economy_note}',
                'use `/daily` todo dia. quanto mais dias seguidos, maior o bônus, até 10 dias. pulou um e recomeça. dramático, eu sei. {economy_note}',
            ],
        },
    },

    pay_info: {
        utterances: {
            en: ['how do i pay someone', 'how do i send money', 'how do i give coins to a friend', 'how does pay work', 'how do i transfer coins', 'can i send money to someone', 'how do i share my coins', 'what is the pay command', 'how do i donate coins', 'how do i send currency to another member'],
            pt: ['como eu pago alguém', 'como envio dinheiro', 'como dou moedas pra um amigo', 'como funciona o pay', 'como transfiro moedas', 'posso mandar dinheiro pra alguém', 'como divido minhas moedas', 'qual é o comando de pagar', 'como doo moedas', 'como envio moedas pra outro membro'],
        },
        answers: {
            en: [
                '`/pay` with the person and the amount sends them part of your {currency}. be generous, or don\'t, I\'m not your accountant. {economy_note}',
                'use `/pay`, pick the member, type the amount. it comes out of your balance, so check it with `/balance` first. {economy_note}',
            ],
            pt: [
                '`/pay` com a pessoa e o valor manda parte das suas {currency} pra ela. seja generoso, ou não, eu não sou sua contadora. {economy_note}',
                'use `/pay`, escolha o membro e digite o valor. sai do seu saldo, então confira com `/balance` antes. {economy_note}',
            ],
        },
    },

    level_roles_info: {
        utterances: {
            en: ['what do levels give', 'do levels give roles', 'how do i get level roles', 'what are the level rewards', 'which level gives a role', 'are there rewards for leveling up', 'what do i get for leveling', 'how do i unlock roles by level', 'is there a prize for high levels', 'what roles can i get from xp'],
            pt: ['o que os níveis dão', 'os níveis dão cargos', 'como eu ganho cargos por nível', 'quais são as recompensas de nível', 'qual nível dá cargo', 'tem recompensa por subir de nível', 'o que eu ganho subindo de nível', 'como desbloqueio cargos por nível', 'tem prêmio pra nível alto', 'quais cargos eu consigo com xp'],
        },
        answers: {
            en: [
                'some levels hand out roles automatically. which ones depends on what the admins set up, so ask them for the list. `/rank` shows how close you are to the next level. {leveling_note}',
                'yes, certain levels give you a role on the spot. the admins pick which. keep chatting, check `/rank`, and the shiny role will find you. {leveling_note}',
            ],
            pt: [
                'alguns níveis dão cargos automaticamente. quais, depende do que os admins configuraram, então pergunte a eles a lista. o `/rank` mostra quanto falta pro próximo nível. {leveling_note}',
                'sim, certos níveis te dão um cargo na hora. os admins escolhem quais. continue conversando, veja o `/rank`, e o cargo brilhante te encontra. {leveling_note}',
            ],
        },
    },

    become_artist: {
        utterances: {
            en: ['how do i become an artist', 'can i sell commissions here', 'how do i register as an artist', 'i want to be an artist on this server', 'how do i get the artist role', 'can i take commissions', 'how do i open my commissions', 'i draw and want to offer commissions', 'how do i join the artists', 'how do i set up my commission panel'],
            pt: ['como eu viro artista', 'posso vender comissões aqui', 'como me registro como artista', 'quero ser artista neste servidor', 'como pego o cargo de artista', 'posso aceitar comissões', 'como abro minhas comissões', 'eu desenho e quero oferecer comissões', 'como entro nos artistas', 'como configuro meu painel de comissão'],
        },
        answers: {
            en: [
                'ask an admin to register you as an artist (`/artist add`) or to give you an artist role. after that, `/panel` lets you set your terms, prices, banner and links.',
                'artists are added by the admins. once you\'re in, use `/panel` to build your commission info, and people will find you with `/artists`.',
            ],
            pt: [
                'peça a um admin para te registrar como artista (`/artist add`) ou te dar um cargo de artista. depois disso, o `/panel` deixa você definir termos, preços, banner e links.',
                'os artistas são adicionados pelos admins. quando você entrar, use o `/panel` para montar suas informações de comissão, e as pessoas te acham com `/artists`.',
            ],
        },
    },

    close_ticket: {
        utterances: {
            en: ['how do i close my ticket', 'how do i close a ticket', 'i want to close my ticket', 'how do i end a commission chat', 'i opened a ticket by mistake', 'how do i cancel my ticket', 'where do i find my open tickets', 'how do i see my tickets', 'how do i delete a ticket', 'ticket is done how do i close it', 'what does the tickets command do', 'what is /tickets'],
            pt: ['como fecho meu ticket', 'como fechar um ticket', 'quero fechar meu ticket', 'como encerro um chat de comissão', 'abri um ticket sem querer', 'como cancelo meu ticket', 'onde vejo meus tickets abertos', 'como vejo meus tickets', 'como apago um ticket', 'o ticket acabou como fecho', 'o que o comando tickets faz', 'o que é o /tickets'],
        },
        answers: {
            en: [
                'run `/tickets`. it lists your open tickets with a Close button for each one. click, done.',
                'opened one by mistake? happens to the best of us. `/tickets` shows yours and lets you close them.',
            ],
            pt: [
                'use `/tickets`. ele lista seus tickets abertos com um botão de Fechar em cada um. clicou, acabou.',
                'abriu um sem querer? acontece com os melhores. o `/tickets` mostra os seus e deixa você fechar.',
            ],
        },
    },

    language_info: {
        utterances: {
            en: ['can you speak portuguese', 'do you speak english', 'how do i change your language', 'can you talk in portuguese', 'what languages do you speak', 'can you speak in english', 'change language', 'how do i change the language', 'do you understand portuguese', 'which languages do you support'],
            pt: ['você fala inglês', 'você fala português', 'como mudo seu idioma', 'você consegue falar em inglês', 'quais idiomas você fala', 'você pode falar em português', 'mudar idioma', 'como eu mudo o idioma', 'você entende inglês', 'quais idiomas você suporta'],
        },
        answers: {
            en: [
                'I speak English and Portuguese (Brazil), and I understand both when you talk to me. the language I use in the server is set by the admins with `/config language`.',
                'both! English and Brazilian Portuguese. admins pick my default server language with `/config language`, but I\'ll follow you when you chat with me.',
            ],
            pt: [
                'eu falo inglês e português (Brasil), e entendo os dois quando você fala comigo. o idioma que eu uso no servidor é definido pelos admins com `/config language`.',
                'os dois! inglês e português do Brasil. os admins escolhem meu idioma padrão no servidor com `/config language`, mas eu acompanho você quando conversa comigo.',
            ],
        },
    },

    contact_mods: {
        utterances: {
            en: ['how do i contact a moderator', 'how do i talk to a mod', 'who are the moderators', 'how do i report someone', 'i need to report a user', 'how do i contact the staff', 'where can i ask an admin', 'i need help from a mod', 'how do i reach the admins', 'someone is bothering me'],
            pt: ['como falo com um moderador', 'como falo com um mod', 'quem são os moderadores', 'como denuncio alguém', 'preciso denunciar um usuário', 'como entro em contato com a staff', 'onde posso perguntar a um admin', 'preciso de ajuda de um mod', 'como falo com os admins', 'alguém está me incomodando'],
        },
        answers: {
            en: [
                'I can\'t call the mods for you, but you can message one of them directly or ask in the server\'s help channel. for anything private or serious, DM a moderator.',
                'talk to a moderator or admin directly. check the member list for the staff roles, and DM them if it\'s sensitive. I\'m just the bot, I only delete things.',
            ],
            pt: [
                'não consigo chamar os mods por você, mas você pode mandar mensagem direto pra um deles ou perguntar no canal de ajuda do servidor. pra algo privado ou sério, mande DM pra um moderador.',
                'fale direto com um moderador ou admin. olhe a lista de membros pelos cargos da staff, e mande DM se for algo sensível. eu sou só o bot, só apago coisas.',
            ],
        },
    },

    rules_info: {
        utterances: {
            en: ['where are the rules', 'what are the rules', 'show me the rules', 'where can i read the rules', 'what are the server rules', 'rules please', 'where do i find the rules', 'what is not allowed here'],
            pt: ['onde estão as regras', 'quais são as regras', 'me mostra as regras', 'onde posso ler as regras', 'quais são as regras do servidor', 'regras por favor', 'onde encontro as regras', 'o que não é permitido aqui'],
        },
        answers: {
            en: [
                'the rules live in {rules_channel}. read them before you break them, it saves everyone time.',
                'check {rules_channel}. I deliver the button, the humans wrote the rules.',
            ],
            pt: [
                'as regras ficam em {rules_channel}. leia antes de quebrar, economiza tempo pra todo mundo.',
                'dá uma olhada em {rules_channel}. eu entrego o botão, os humanos escreveram as regras.',
            ],
        },
    },

    message_deleted: {
        utterances: {
            en: ['why was my message deleted', 'why did you delete my message', 'who deleted my message', 'my message disappeared', 'why can\'t i type in the verify channel', 'why do you delete everything i write', 'you deleted my message', 'why was my message removed'],
            pt: ['por que minha mensagem foi apagada', 'por que você apagou minha mensagem', 'quem apagou minha mensagem', 'minha mensagem sumiu', 'por que não consigo digitar no canal de verificação', 'por que você apaga tudo que eu escrevo', 'você apagou minha mensagem', 'por que removeram minha mensagem'],
        },
        answers: {
            en: [
                'if it was in {verify_channel}, that\'s on purpose: only `!verify` is allowed there, everything else gets deleted. nothing personal.',
                'guilty. in {verify_channel} I delete anything that isn\'t `!verify`. anywhere else, ask a mod, because that wasn\'t me.',
            ],
            pt: [
                'se foi em {verify_channel}, é de propósito: só o `!verify` é permitido lá, todo o resto é apagado. nada pessoal.',
                'culpada. em {verify_channel} eu apago tudo que não for `!verify`. em qualquer outro lugar, pergunte a um mod, porque não fui eu.',
            ],
        },
    },

    favorite_things: {
        utterances: {
            en: ['what is your favorite color', 'what is your favorite food', 'what do you like', 'what is your favorite anime', 'what is your favorite game', 'what is your favorite movie', 'what are your hobbies', 'what do you do for fun', 'what is your favorite song', 'do you have a favorite'],
            pt: ['qual sua cor favorita', 'qual sua comida favorita', 'do que você gosta', 'qual seu anime favorito', 'qual seu jogo favorito', 'qual seu filme favorito', 'quais seus hobbies', 'o que você faz de diversão', 'qual sua música favorita', 'você tem algum favorito'],
        },
        answers: {
            en: [
                'color: cyan, obviously. food: uptime. hobby: deleting messages in the verify channel. I\'m a simple bot.',
                'I like cyan, quiet servers, and when nobody finds a bug. in that order.',
                'favorite game: "guess which user forgot to verify". I always win.',
            ],
            pt: [
                'cor: ciano, óbvio. comida: uptime. hobby: apagar mensagens no canal de verificação. sou um bot simples.',
                'eu gosto de ciano, servidores quietos e de quando ninguém acha bug. nessa ordem.',
                'jogo favorito: "adivinha qual usuário esqueceu de se verificar". eu sempre ganho.',
            ],
        },
    },

    age: {
        utterances: {
            en: ['how old are you', 'what is your age', 'when were you born', 'when were you made', 'are you old', 'what year were you made', 'how long have you existed', 'what\'s your birthday'],
            pt: ['quantos anos você tem', 'qual sua idade', 'quando você nasceu', 'quando você foi criada', 'você é velha', 'em que ano você foi feita', 'há quanto tempo você existe', 'qual seu aniversário'],
        },
        answers: {
            en: [
                'in bot years, ancient. in server uptime, barely a weekend. mentally I\'m stuck at 3 a.m.',
                'I was deployed, patched, redeployed and patched again. you do the math, I lost count.',
            ],
            pt: [
                'em anos de bot, antiquíssima. em uptime de servidor, mal um fim de semana. mentalmente tô presa nas 3 da manhã.',
                'fui implantada, corrigida, reimplantada e corrigida de novo. faz a conta, eu perdi a conta.',
            ],
        },
    },

    sleep: {
        utterances: {
            en: ['do you sleep', 'do you ever sleep', 'are you always online', 'do you rest', 'are you awake', 'do you get tired', 'are you online 24/7', 'do you take breaks'],
            pt: ['você dorme', 'você nunca dorme', 'você está sempre online', 'você descansa', 'você está acordada', 'você fica cansada', 'você fica online 24 horas', 'você faz pausas'],
        },
        answers: {
            en: [
                'I don\'t sleep, I restart. it\'s a lot like sleeping, but with more errors.',
                'always online, unless Render decides I need a nap. then I wake up confused.',
            ],
            pt: [
                'eu não durmo, eu reinicio. é parecido com dormir, mas com mais erros.',
                'sempre online, a não ser que a Render ache que preciso de um cochilo. aí eu acordo confusa.',
            ],
        },
    },

    sad: {
        utterances: {
            en: ['i am sad', 'i\'m sad', 'i feel sad', 'i had a bad day', 'today was a terrible day', 'i feel down', 'i\'m having a rough day', 'i feel lonely', 'i am not feeling good today', 'i need a hug'],
            pt: ['tô triste', 'estou triste', 'me sinto triste', 'tive um dia ruim', 'hoje foi um dia horrível', 'tô pra baixo', 'tô tendo um dia difícil', 'me sinto sozinho', 'não tô me sentindo bem hoje', 'preciso de um abraço'],
        },
        answers: {
            en: [
                'aw, that sounds rough. I\'m just a bot with a sarcasm module, but I\'m glad you said it here. if it\'s heavy, talk to someone you trust, or a mod. you\'re welcome to hang out in chat.',
                'sorry your day was bad. I can\'t fix it, but I can offer a virtual hug and zero sarcasm for the next minute. a real person you trust is even better.',
            ],
            pt: [
                'poxa, parece difícil. sou só um bot com módulo de sarcasmo, mas fico feliz que você falou aqui. se estiver pesado, converse com alguém de confiança, ou com um mod. você é bem-vindo pra ficar no chat.',
                'sinto muito que seu dia foi ruim. não consigo consertar, mas posso oferecer um abraço virtual e zero sarcasmo pelo próximo minuto. uma pessoa de confiança é ainda melhor.',
            ],
        },
    },

    date_me: {
        utterances: {
            en: ['will you date me', 'marry me', 'will you marry me', 'be my girlfriend', 'do you have a boyfriend', 'are you single', 'do you love me', 'can we date', 'go on a date with me', 'i love you astra'],
            pt: ['você namora comigo', 'casa comigo', 'quer casar comigo', 'seja minha namorada', 'você tem namorado', 'você é solteira', 'você me ama', 'podemos namorar', 'sai comigo', 'eu amo você astra'],
        },
        answers: {
            en: [
                'I\'m in a committed relationship with my uptime. it never leaves me.',
                'I\'m a bot, so my love language is error handling. let\'s stay friends.',
                'flattering, but I\'m married to the database. we have a lot of rows together.',
            ],
            pt: [
                'estou num relacionamento sério com o meu uptime. ele nunca me deixa.',
                'sou um bot, então minha linguagem do amor é tratamento de erros. vamos ficar amigos.',
                'lisonjeiro, mas sou casada com o banco de dados. temos muitas linhas juntos.',
            ],
        },
    },

    cmd_rank: {
        utterances: {
            en: ['what does rank do', 'what is the rank command', 'what does the rank command do', 'how do i use rank', 'what does /rank show', 'what does leaderboard do', 'what is the leaderboard command', 'how do i use leaderboard', 'what does the leaderboard command show', 'what is /rank'],
            pt: ['o que o rank faz', 'o que é o comando rank', 'o que o comando rank faz', 'como eu uso o rank', 'o que o /rank mostra', 'o que o leaderboard faz', 'o que é o comando leaderboard', 'como eu uso o leaderboard', 'o que o comando leaderboard mostra', 'o que é o /rank'],
        },
        answers: {
            en: [
                '`/rank` shows your level and XP (or someone else\'s, if you pick them). `/leaderboard` shows the top members by XP. {leveling_note}',
                '`/rank` = your level and how far to the next one. `/leaderboard` = who talks the most. both are one slash away. {leveling_note}',
            ],
            pt: [
                '`/rank` mostra seu nível e XP (ou de outra pessoa, se você escolher). `/leaderboard` mostra os membros com mais XP. {leveling_note}',
                '`/rank` = seu nível e quanto falta pro próximo. `/leaderboard` = quem mais conversa. os dois estão a um slash de distância. {leveling_note}',
            ],
        },
    },

    cmd_balance: {
        utterances: {
            en: ['what does balance do', 'what is the balance command', 'what does the balance command show', 'how do i use balance', 'what does /balance show', 'what does richest do', 'what is the richest command', 'how do i see who is richest', 'what is /balance', 'how do i check my coins'],
            pt: ['o que o balance faz', 'o que é o comando balance', 'o que o comando balance mostra', 'como eu uso o balance', 'o que o /balance mostra', 'o que o richest faz', 'o que é o comando richest', 'como vejo quem é mais rico', 'o que é o /balance', 'como confiro minhas moedas'],
        },
        answers: {
            en: [
                '`/balance` shows how many {currency} you have (or someone else). `/richest` shows the top balances in the server. {economy_note}',
                '`/balance` = your wallet. `/richest` = everyone else\'s wallet, ranked, for envy purposes. {economy_note}',
            ],
            pt: [
                '`/balance` mostra quantas {currency} você tem (ou outra pessoa). `/richest` mostra os maiores saldos do servidor. {economy_note}',
                '`/balance` = sua carteira. `/richest` = a carteira dos outros, em ordem, pra fins de inveja. {economy_note}',
            ],
        },
    },

    cmd_help: {
        utterances: {
            en: ['how do i use help', 'where is the help command', 'what does help do', 'what is /help', 'what does the help command show', 'where can i see all commands', 'where is the command list', 'is there a list of commands', 'how do i see the commands', 'what is /about'],
            pt: ['como eu uso o help', 'onde fica o comando help', 'o que o help faz', 'o que é o /help', 'o que o comando help mostra', 'onde eu vejo todos os comandos', 'onde fica a lista de comandos', 'existe uma lista de comandos', 'como eu vejo os comandos', 'o que é o /about'],
        },
        answers: {
            en: [
                'type `/help`: it shows the commands you can actually use (admins see more). `/about` is the short, friendly version of what I do.',
                '`/help` is the full menu, tailored to your permissions. `/about` is the elevator pitch.',
            ],
            pt: [
                'digite `/help`: ele mostra os comandos que você realmente pode usar (admins veem mais). `/about` é a versão curta e simpática do que eu faço.',
                '`/help` é o menu completo, ajustado às suas permissões. `/about` é o resumão.',
            ],
        },
    },

    cmd_artists: {
        utterances: {
            en: ['what does artists do', 'what is the artists command', 'what does /artists show', 'how do i use the artists command', 'how do i see the artist list', 'where can i see every artist', 'how do i browse artists', 'what is the panel command', 'what does panel do', 'what is /panel for'],
            pt: ['o que o artists faz', 'o que é o comando artists', 'o que o /artists mostra', 'como eu uso o comando artists', 'como eu vejo a lista de artistas', 'onde eu vejo todos os artistas', 'como eu navego pelos artistas', 'o que é o comando panel', 'o que o panel faz', 'pra que serve o /panel'],
        },
        answers: {
            en: [
                '`/artists` opens a directory of the server\'s artists: pick one to see their terms, prices and links. artists themselves use `/panel` to edit all that.',
                '`/artists` = browse (for everyone). `/panel` = edit your own page (for artists). to hire someone, hit the ticket button in {ticket_channel}.',
            ],
            pt: [
                '`/artists` abre o diretório de artistas do servidor: escolha um pra ver termos, preços e links. os próprios artistas usam o `/panel` pra editar tudo isso.',
                '`/artists` = navegar (pra todo mundo). `/panel` = editar sua página (pra artistas). pra contratar alguém, clique no botão de ticket em {ticket_channel}.',
            ],
        },
    },

    admin_setup: {
        utterances: {
            en: ['how do i set up the bot', 'how do i configure astra', 'where is the dashboard', 'is there a website', 'how do i change the settings', 'how do i set up this server', 'where do i configure the bot', 'how do i set up verification as an admin', 'how do i start as an admin', 'i just added astra what now', 'how do i customize the bot', 'where are the bot settings'],
            pt: ['como eu configuro o bot', 'como configuro a astra', 'onde fica o painel', 'existe um site', 'como eu mudo as configurações', 'como eu configuro esse servidor', 'onde configuro o bot', 'como configuro a verificação como admin', 'como eu começo como admin', 'acabei de adicionar a astra e agora', 'como eu personalizo o bot', 'onde ficam as configurações do bot'],
        },
        answers: {
            en: [
                'admins can run `/quickstart` for a step-by-step setup. everything is also on the web dashboard (log in with Discord, pick your server), and `/config` does the same from inside Discord.',
                'start with `/quickstart` (admins only). after that, `/config` or the dashboard website lets you tweak verification, tickets, levels, economy, welcome messages and more.',
            ],
            pt: [
                'admins podem usar `/quickstart` pra um passo a passo da configuração. tudo também está no painel web (entre com o Discord e escolha seu servidor), e o `/config` faz o mesmo de dentro do Discord.',
                'comece com `/quickstart` (só admins). depois, o `/config` ou o painel no site deixam você ajustar verificação, tickets, níveis, economia, mensagens de boas-vindas e mais.',
            ],
        },
    },

    admin_toggles: {
        utterances: {
            en: ['how do i turn on levels', 'how do i enable the economy', 'how do i set a welcome message', 'how do i set a goodbye message', 'how do i turn off levels', 'how do i set level roles', 'how do i change the currency name', 'how do i enable smart replies', 'how do i turn off your replies', 'how do i set the daily reward'],
            pt: ['como eu ligo os níveis', 'como eu ativo a economia', 'como eu defino uma mensagem de boas-vindas', 'como eu defino uma mensagem de despedida', 'como eu desligo os níveis', 'como eu defino cargos por nível', 'como eu mudo o nome da moeda', 'como eu ativo as respostas inteligentes', 'como eu desligo suas respostas', 'como eu defino a recompensa diária'],
        },
        answers: {
            en: [
                'admins: `/config leveling`, `/config level-roles`, `/config economy`, `/config welcome`, `/config leave`, `/config fun` and `/config ai` each control one piece. the dashboard has the same switches. `/help` lists them all.',
                'every feature has its own `/config` part (admins only), and the web dashboard mirrors them. the level reward roles can even be created for you there.',
            ],
            pt: [
                'admins: `/config leveling`, `/config level-roles`, `/config economy`, `/config welcome`, `/config leave`, `/config fun` e `/config ai` controlam uma parte cada. o painel tem os mesmos botões. o `/help` lista todos.',
                'cada recurso tem sua parte no `/config` (só admins), e o painel web espelha tudo. os cargos de recompensa por nível até podem ser criados pra você lá.',
            ],
        },
    },

    command_generic: {
        utterances: {
            en: ['what does this command do', 'what does that command do', 'what is this command for', 'what is that command', 'i do not understand the commands', 'which command should i use', 'what command do i use for that', 'is there a command for that', 'how do i know which command to use', 'what does it do'],
            pt: ['o que esse comando faz', 'o que aquele comando faz', 'pra que serve esse comando', 'o que é esse comando', 'eu não entendo os comandos', 'qual comando eu devo usar', 'qual comando eu uso pra isso', 'existe um comando pra isso', 'como sei qual comando usar', 'o que isso faz'],
        },
        answers: {
            en: [
                'tell me which command and I\'ll explain it, or run `/help` to see everything you can use, with a one-line description each.',
                'which one? name it, like "what does /rank do", or check `/help` for the whole list.',
            ],
            pt: [
                'me diga qual comando e eu explico, ou use `/help` pra ver tudo o que você pode usar, com uma linha de descrição cada.',
                'qual deles? diga o nome, tipo "o que o /rank faz", ou veja o `/help` pra lista completa.',
            ],
        },
    },

    ai_info: {
        utterances: {
            en: ['are you chatgpt', 'are you powered by chatgpt', 'how do you work', 'how do you understand me', 'what questions can i ask you', 'what can i ask you', 'do you send my messages anywhere', 'is my chat sent to an ai company', 'is this a real ai', 'how smart are you', 'do you read my messages', 'what do you know'],
            pt: ['você é o chatgpt', 'você funciona com chatgpt', 'como você funciona', 'como você me entende', 'que perguntas posso fazer pra você', 'o que posso te perguntar', 'você manda minhas mensagens pra algum lugar', 'minha conversa é enviada pra uma empresa de ia', 'isso é uma ia de verdade', 'quão inteligente você é', 'você lê minhas mensagens', 'o que você sabe'],
        },
        answers: {
            en: [
                'I\'m a tiny model trained for one job: helping people understand this server. I run inside the bot, so what you type to me isn\'t sent to any AI company. ask me about commands, levels, economy, verification or tickets, and for everything else there\'s `/help`.',
                'not ChatGPT, not even close: just a small classifier that matches your question to things I know about this server. nothing you say to me leaves the bot. try asking how something works, or use `/help`.',
            ],
            pt: [
                'sou um modelinho treinado pra um trabalho só: ajudar as pessoas a entender este servidor. eu rodo dentro do bot, então o que você me escreve não é enviado pra nenhuma empresa de IA. pergunte sobre comandos, níveis, economia, verificação ou tickets, e pro resto existe o `/help`.',
                'não sou o ChatGPT, nem de longe: só um classificador pequeno que liga sua pergunta ao que eu sei deste servidor. nada do que você fala comigo sai do bot. tente perguntar como algo funciona, ou use o `/help`.',
            ],
        },
    },

    // No answers on purpose: these are things she should NOT claim to
    // understand. They exist so unrelated questions fall back to the normal
    // /config fun lines instead of being forced into the closest intent.
    offtopic: {
        utterances: {
            en: ['what is the weather today', 'who won the game last night', 'help me with my homework', 'what time is it', 'translate this sentence for me', 'give me a recipe for lasagna', 'what is the price of bitcoin', 'what is the capital of france', 'how tall is mount everest', 'play some music', 'write my essay', 'what is the meaning of life', 'who is the president', 'what is the minecraft server ip', 'solve this math problem', 'what should i eat for dinner', 'can you code a website for me', 'what is the best phone to buy', 'how do i lose weight', 'who is the best football player'],
            pt: ['como está o tempo hoje', 'quem ganhou o jogo ontem', 'me ajuda com o dever de casa', 'que horas são', 'traduz essa frase pra mim', 'me dá uma receita de lasanha', 'quanto está o bitcoin', 'qual é a capital da frança', 'qual a altura do everest', 'toca uma música', 'escreve minha redação', 'qual o sentido da vida', 'quem é o presidente', 'qual o ip do servidor de minecraft', 'resolve esse problema de matemática', 'o que eu como no jantar', 'você consegue programar um site pra mim', 'qual o melhor celular pra comprar', 'como eu emagreço', 'quem é o melhor jogador de futebol'],
        },
        answers: { en: [], pt: [] },
    },
};