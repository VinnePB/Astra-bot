ASTRA — EXPERIMENTAL SMART REPLIES (PROTOTYPE, v2)
==================================================
What it is: a small LOCAL intent classifier (node-nlp / nlp.js), trained for ONE
purpose: helping members understand the server. No LLM, no API, no cost. She matches
what someone says to one of 40 intents in English and Portuguese and replies with a
pre-written line in a chaotic, deadpan personality. Anything she isn't sure about, or
that is off-topic, falls back to the normal /config fun lines. OFF by default.

WHAT SHE UNDERSTANDS
  greeting, farewell, thanks, how_are_you, who_are_you, what_can_you_do,
  economy_info, rank_info, verify_info, tickets_info, compliment, insult,
  joke, random_chaos, sentient, creator, bored, daily_info, pay_info, level_roles_info,
  become_artist, close_ticket, language_info, contact_mods, rules_info, message_deleted,
  favorite_things, age, sleep, sad, date_me, cmd_rank, cmd_balance, cmd_help, cmd_artists,
  admin_setup, admin_toggles, command_generic, ai_info, + "offtopic" (teaches her what NOT
  to answer: weather, football, homework...)
  Answers fill in real server data: currency name, whether economy/levels are on,
  and the verify/rules/ticket channels.

FILES (inside Dsc-DEV/src/)
  ai/corpus.js      what she understands + what she answers (the file you edit)
  ai/augment.js     makes slang/typo/no-accent training variants (used by train.js)
  ai/validate.js    checks the corpus for mistakes (npm run check-ai, no node-nlp needed)
  ai/classifier.js  loads the model + classifies (no Discord/DB code)
  ai/train.js       validates + trains  ->  ai/model.nlp
  ai/test.js        prints what the trained model gets right/wrong (npm run test-ai)
  ai/model.nlp      the trained model (generated; the bot only LOADS it)
  commands/ai.js    handles messages: cooldown, "busy", placeholders, fallback
  commands/fun.js   the normal canned lines (26 per language)
  package.json      adds node-nlp + scripts train-ai / test-ai / check-ai

SETUP WITHOUT A TERMINAL (Render does the work)
  1. Upload the files to GitHub, same folders as above (package.json replaces the old one).
  2. Render > your service > Settings > Build Command:
         npm install && (npm run train-ai || echo "AI training skipped")
     The "|| echo" part means: if training ever fails, the deploy still goes live and
     Astra just keeps using her canned lines. (Root Directory must be Dsc-DEV.)
  3. Deploy, then check the build log for "✅ Saved ... model.nlp".
  NOTE: if your Build Command is `npm ci`, change it to `npm install` (the lock file
  doesn't know node-nlp yet).

SETUP ON YOUR COMPUTER (alternative; lets you test before deploying)
  cd Dsc-DEV && npm install && npm run train-ai && npm run test-ai
  then commit src/ai/model.nlp (and package-lock.json) and deploy.

TURN ON
  /config ai enabled:True     (or Dashboard > Fun > Smart Replies)

TUNING (the loop to improve her)
  1. npm run test-ai   -> shows hits and misses on phrases NOT in the corpus
  2. add similar phrases for each miss to the right intent in ai/corpus.js
     (or to "offtopic" if she answered something she shouldn't)
  3. npm run check-ai, retrain, redeploy
  MIN_SCORE (ai/classifier.js, now 0.6) is a guess: higher = fewer wrong answers but
  more "I don't know"; lower = the opposite. Pick it using test-ai results.
  NOTE: none of this has been run against the real node-nlp yet.

BEHAVIOR
  - Triggers: @Astra or her name in a message, AND a question she recognizes.
  - Runs both languages and keeps the more confident result.
  - One smart reply per channel per 6s. Inside that window: the same person gets
    silence; a DIFFERENT person gets "I'm busy" (at most once per 20s per channel).
  - Never repeats the same answer twice in a row for an intent.
  - A question she doesn't understand -> "try /help"; an off-topic question -> "not my
    job, I only know this server". Non-questions still go to /config fun lines.
  - {user_name} in an answer = the person's server nickname (no pings, no markdown).
  - Not built: auto-moderation, memory, free conversation. See astra-todo.txt.

CLASSIFIER vs. A REAL AI (ChatGPT-style) — WHY THIS DESIGN
  This (node-nlp): classifies a message into one of the intents in corpus.js and
  picks a pre-written answer. Predictable (never says anything you didn't write,
  can't hallucinate or break character), instant, free, runs inside the bot, light
  enough for Render's free tier, and messages never leave the bot. Weakness: it
  doesn't understand; anything outside the intents falls back to /config fun.
  A language model (ChatGPT-style): writes a new reply each time on any topic and
  remembers the conversation. Too big to run on the free tier, so it means calling a
  provider's API: cost per message (grows with server activity), an API key to
  protect, a few seconds of latency, unpredictable or off-character replies the
  server is responsible for, and message text sent to a third party (members should
  be told). Decision for now: stay with the classifier (no budget for an API).
  Possible hybrid someday (NOT built): the classifier answers what it knows, an API
  covers the rest, with per-server and per-user limits.