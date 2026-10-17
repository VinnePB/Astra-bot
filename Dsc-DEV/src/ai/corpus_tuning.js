// ai/corpus_tuning.js
// Extra example phrases added after measuring the real model with
// `npm run test-ai`. Each list is ADDED to that intent's phrases in corpus.js
// (nothing is replaced). On purpose these are similar to the misses, never the
// exact test sentences, so the test keeps measuring real understanding.

module.exports = {
    rank_info: {
        // "como eu faço pra ..." was being read as "o que eu faço" (bored)
        en: ['how do u rank up', 'how do you level up here', 'how do i go up a level', 'how can i reach the next level', 'how do i get a higher rank', 'how to lvl up'],
        pt: ['como q sobe de lvl', 'como q eu upo', 'como eu subo de lvl', 'como eu faço pra subir de level', 'como faço pra subir de nível', 'como eu faço pra ganhar nível', 'como q sobe de nível', 'como eu passo de nível', 'como faz pra upar de nível', 'como eu upo de nível aqui', 'como se sobe de nivel'],
    },
    xp_tips: {
        en: ['how do i earn xp fast', 'how can i earn more xp', 'quickest way to earn xp', 'how do i get xp quickly', 'fastest way to earn xp', 'how can i gain xp quicker', 'how do i level up faster', 'tips to get more xp', 'how to farm xp fast'],
        pt: ['como eu ganho xp rapidinho', 'como upar mais rápido', 'dicas pra ganhar xp mais rápido', 'como subo de nível mais rápido', 'jeito mais rápido de ganhar xp', 'como farmar xp rápido'],
    },
    admin_toggles: {
        en: ['how do i turn levels on in my server', 'how do i activate leveling', 'how can i enable xp here', 'how do i switch on the economy in my server', 'how to enable leveling on my server', 'where do i turn on levels'],
        pt: ['como eu ativo os níveis no meu servidor', 'como liga o sistema de nível', 'como eu habilito o xp aqui', 'como eu ligo a economia no meu servidor', 'onde eu ligo os níveis', 'como ativar o leveling no servidor'],
    },
    sleep: {
        en: ['do you ever sleep at night', 'do you go to bed', 'do you need sleep', 'when do you sleep', 'do you sleep at all', 'are you ever offline'],
        pt: ['você dorme de noite', 'você vai dormir', 'você precisa dormir', 'quando você dorme', 'você chega a dormir', 'você fica offline'],
    },
    what_can_you_do: {
        en: ['wat can you do', 'what can u do', 'wat do u do', 'what do u even do', 'what r your commands', 'what can this bot do'],
        pt: ['oq vc faz aqui', 'o que vc sabe fazer', 'o q vc faz', 'quais os seus comandos', 'o que esse bot faz', 'o que você sabe fazer'],
    },
    invite_info: {
        en: ['how do i get astra in my own server', 'can i have astra on my discord', 'how do i put astra in my server', 'i want astra on my server', 'how do i bring you to my discord', 'invite astra to my server'],
        pt: ['como eu ponho a astra no meu servidor', 'quero a astra no meu discord', 'como eu levo a astra pro meu servidor', 'convidar a astra pro meu servidor', 'dá pra ter a astra no meu discord', 'como eu adiciono você no meu discord'],
    },
    report_scam: {
        en: ['someone keeps asking for my login', 'a guy wants my verification code', 'someone asked for my 2fa code', 'this user wants my account password', 'someone is asking for my discord login', 'a person wants my email code'],
        pt: ['um cara fica pedindo meu login', 'alguém quer meu código de verificação', 'pediram meu código de dois fatores', 'esse usuário quer a senha da minha conta', 'tão pedindo meu login do discord', 'uma pessoa quer o código do meu email'],
    },
    bug_report: {
        en: ['the bot stopped responding to me', 'astra stopped answering', 'the bot does not reply anymore', 'astra is ignoring me', 'the bot stopped working for me', 'her commands stopped working'],
        pt: ['o bot parou de me responder', 'a astra parou de responder', 'o bot não responde mais', 'a astra tá me ignorando', 'o bot parou de funcionar pra mim', 'os comandos dela pararam de funcionar'],
    },
    commission_price: {
        en: ['what do artists charge here', 'how much do the artists usually ask', 'what does art usually cost here', 'how expensive are commissions', 'average price of a commission', 'what do commissions usually cost'],
        pt: ['quanto os artistas cobram aqui', 'quanto costuma custar uma arte', 'as comissões são caras', 'preço médio de uma comissão', 'quanto custa normalmente uma comissão', 'qual o valor de uma arte aqui'],
    },
    commission_wait: {
        en: ['how many days until my commission is done', 'how long until my art is finished', 'when is my commission going to be ready', 'how many weeks does a commission take', 'how long do i wait for art', 'when do i get my art'],
        pt: ['quantos dias até minha arte ficar pronta', 'quanto tempo até minha comissão ficar pronta', 'quando vou receber minha arte', 'quantas semanas demora uma comissão', 'quanto tempo eu espero pela arte', 'quando minha comissão fica pronta'],
    },
    followup_more: {
        en: ['explain it again', 'one more time please', 'can you say it again', 'explain once more', 'again please', 'repeat that please'],
        pt: ['explica de novo por favor', 'mais uma vez', 'fala de novo por favor', 'repete por favor', 'de novo', 'explica outra vez'],
    },
    cmd_rank: {
        en: ['what is the leaderboard command', 'how do i see the leaderboard', 'whats the rank command', 'which command shows the leaderboard', 'where is the leaderboard', 'how do i use leaderboard'],
        pt: ['qual o comando do leaderboard', 'como eu vejo o leaderboard', 'qual é o comando de rank', 'qual comando mostra o ranking', 'onde fica o leaderboard', 'como uso o leaderboard'],
    },
    thanks: {
        en: ['thank you so much', 'thanks for the help', 'thanks a bunch', 'thank you astra', 'appreciate the help', 'thanks for helping'],
        pt: ['muito obrigada', 'obrigado pela ajuda', 'valeu pela ajuda', 'obrigado astra', 'brigadão', 'muito obrigado mesmo'],
    },
    insult: {
        en: ['worst bot ever', 'you are a terrible bot', 'you are the dumbest bot', 'this bot is trash', 'you are so bad', 'you are horrible'],
        pt: ['pior bot', 'você é a pior', 'você é um bot horrível', 'esse bot é um lixo', 'você é muito ruim', 'bot horrível'],
    },
    tickets_info: {
        en: ['i want to order some art', 'i would like to request a drawing', 'how do i order an illustration', 'can i buy art from someone here', 'i want to get a drawing made', 'where do i order a commission'],
        pt: ['quero pedir uma arte', 'quero encomendar um desenho', 'como eu peço uma ilustração', 'quero pedir um desenho pra alguém', 'como eu compro uma arte aqui', 'onde eu encomendo uma ilustração'],
    },
    cmd_artists: {
        en: ['how do i look at the artists here', 'where can i find the artists', 'show me the artists', 'who are the artists here', 'how do i check the artists', 'list the artists'],
        pt: ['como eu vejo os artistas daqui', 'onde eu acho os artistas', 'me mostra os artistas', 'quem são os artistas daqui', 'como eu olho a lista de artistas', 'lista os artistas'],
    },
    message_deleted: {
        en: ['why did my message get removed', 'who removed what i wrote', 'my text got deleted', 'why was what i wrote erased', 'why are my messages disappearing', 'why did my message vanish'],
        pt: ['por que apagaram minha mensagem', 'quem apagou o que eu escrevi', 'por que meu texto sumiu', 'apagaram o que eu mandei', 'por que minhas mensagens somem', 'por que removeram minha mensagem'],
    },
    verify_info: {
        // "como eu me verfico aqui" was going to become_artist
        en: ['how do i verify myself here', 'how do i get verified here', 'where do i verify', 'how do i verify on this server', 'verify me', 'how do i unlock the server'],
        pt: ['como eu me verifico aqui', 'como me verifico neste servidor', 'onde eu me verifico', 'como faço a verificação', 'como eu faço pra me verificar', 'como libero o servidor'],
    },
    // Round 2. "quem ganhou ..." was landing on "who made you" (creator).
    offtopic: {
        en: ['who won the last election', 'who is winning the game', 'who won the championship', 'who scored the goal', 'who is the champion this year', 'which team won yesterday'],
        pt: ['quem ganhou o jogo', 'quem venceu a eleição', 'quem é o campeão desse ano', 'quem fez o gol', 'qual time ganhou ontem', 'quem ganhou o campeonato', 'quem venceu a copa', 'quem ganhou o brasileirão'],
    },
    close_ticket: {
        en: ['how can i close my ticket', 'how do i close the ticket i made', 'close the ticket i opened', 'how do i shut my ticket', 'can i close my own ticket', 'how to close an open ticket'],
        pt: ['como posso fechar meu ticket', 'como fecho o ticket que eu abri', 'fechar o ticket que abri', 'posso fechar meu próprio ticket', 'como encerro meu ticket', 'como fechar um ticket aberto'],
    },
    events_info: {
        en: ['what is the button that pops up in chat', 'what is the grab button', 'what is that thing with the grab it button', 'something popped up with a button what is it', 'what is the pouch with the button', 'what are those button drops'],
        pt: ['o que é o botão que aparece no chat', 'o que é o botão de pegar', 'apareceu um botão no chat o que é', 'o que é aquela bolsa com botão', 'o que são essas coisas com botão que aparecem', 'o que é o botão pegar'],
    },
};