// ai/test-spell.js
// Checks the typo fixer (ai/spell.js) on its own. Needs NO node-nlp and no
// trained model:   node src/ai/test-spell.js   (= npm run test-spell)
//
// Part 1: misspellings that should be repaired.
// Part 2: correct sentences (not copied from the corpus) that must be left alone.

const corpus = require('./corpus');
const { knownWords, cleanText } = require('./classifier');
const { buildSpeller } = require('./spell');

const speller = buildSpeller(corpus, knownWords());

const FIX = [
    ['how do i verfy', 'how do i verify'],
    ['how does the levle system work', 'how does the level system work'],
    ['wat is the dailly', 'wat is the daily'],
    ['how do i comission someone', 'how do i commission someone'],
    ['where is the leaderbord', 'where is the leaderboard'],
    ['how do i chek my balence', 'how do i check my balance'],
    ['what is the econmy', 'what is the economy'],
    ['how do i open a ticet', 'how do i open a ticket'],
    ['como eu me verifco', 'como eu me verifico'],
    ['como funcioan o rank', 'como funciona o rank'],
    ['como eu pego minha recompnsa diaria', 'como eu pego minha recompensa diaria'],
    ['como eu abro um tickte', 'como eu abro um ticket'],
    ['quero uma comisão', 'quero uma comissao'],
    ['onde ficam as reglas', 'onde ficam as regras'],
    ['como eu vejo meu salod', 'como eu vejo meu saldo'],
];

const KEEP = [
    'how do i get to a higher level', 'what is the weather like in tokyo', 'purple banana helicopter', 'hello there friend', 'good night everyone',
    'i can\'t see the channels, how do i verify', 'you are really cool astra',
    'banana roxa helicóptero', 'quem programou você',
    'não consigo ver os canais, como verifico', 'tive um dia muito ruim',
    'quando o artista vai me responder', 'my friend wants a new avatar',
];

let bad = 0;
console.log(`vocabulary: ${speller.vocabSize} words\n`);
for (const [typo, want] of FIX) {
    const got = speller.fix(cleanText(typo)) || cleanText(typo);
    const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ok = norm(got) === norm(want);
    if (!ok) bad++;
    console.log(`${ok ? '✅' : '❌'} ${typo.padEnd(42)} -> ${got}`);
}
console.log('');
for (const phrase of KEEP) {
    const got = speller.fix(cleanText(phrase));
    const ok = got === null;
    if (!ok) bad++;
    console.log(`${ok ? '✅' : '❌'} keep: ${phrase.padEnd(40)}${ok ? '' : ' -> ' + got}`);
}
// Known limitation: an ordinary word that is not in the vocabulary but is one
// edit away from one that is can be "fixed" wrongly. That is why the classifier
// only uses the fixed text when the ORIGINAL wasn't confident, and only when
// the fixed text is clearly a better match. Shown for information, never fails.
console.log('\nInformation only (possible false fixes, guarded in classifier.js):');
for (const phrase of ['who won the world cup', 'como está o clima em são paulo', 'what time does the stream start']) {
    console.log(`   ${phrase.padEnd(42)} -> ${speller.fix(cleanText(phrase)) || '(unchanged)'}`);
}
console.log(bad ? `\n${bad} problem(s)` : '\nAll good.');
process.exit(bad ? 1 : 0);