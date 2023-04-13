# Joe Biden.

A discord bot dalai API (for entertainment purposes.)
Uses the LLAMA / ALPACA LLM AI model to generate responses to your questions in discord (as joe biden)

Tested working under Linux.

Please DM me on discord if you have any issues (birb#9998)

## setup:

### install:

- node
- npm
- python

if on windows: 
- visual studio
- "desktop development with C++"

### setup:
put your token in a new file named .env:

```
BOT_TOKEN=XXXXXXXX
```

```
npm i

npx dalai alpaca install 7B
```
### config:
open config.json

```
supply_date:    // whether or not to provide the current date & time to the LLM
reply_depth:    // how many replies deep to feed to the LLM
model:          // which model to use (alpaca.7B provides good results)
bot_name:       // who the bot thinks they are
prompt:         // provide some context and instructions
threads:        // how many threads to use. set this to your number of P cores
```

### run:

```
npx dalai serve

node bot.js
```

## todo:

- fingerprint requests
- msg queue
- image gen
- fix docker interface shenanigans
- message length
- add admin commands
