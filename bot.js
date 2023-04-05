import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { io } from "socket.io-client";

let { Client: DiscordClient, Message, MessageEmbed, MessageAttachment } = require('discord.js-12'),
    { config: loadEnv } = require('dotenv')

loadEnv()

const socket = io("ws://localhost:3000");

const config = {
    bot_uid: 951476676603310100,    // place your bot UID here.
    supply_date: false,             // whether the prompt supplies the date & time
    reply_depth: 3,                 // how many replies deep to add to the prompt.
    model: "alpaca.7B"              // which AI model to use
}

let client = new DiscordClient();
let delay = ms => new Promise(res => setTimeout(res, ms));

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    let guilds = client.guilds.cache.map(guild => guild);
    console.log(`The bot is in ${guilds.length} guilds`);
});

client.on('guildCreate', async guild => {
    console.log("\x1b[32m", `Joined new guild: ${guild.name}`)
})

client.on('guildDelete', async guild => {
    console.log("\x1b[31m", `Kicked from Guild: ${guild.name}`)
})

await client.on('message', async message => {
    if (!message.guild || message.author.bot) return;

    var user = message.mentions.users.first()

    if (user == undefined || user.id != config.bot_uid) { return; }

    console.log("\x1b[32mBot mentioned - Generating prompt...\x1b[0m\n")

    var request = {
        seed: -1,
        threads: 4,
        n_predict: 200,
        top_k: 40,
        top_p: 0.9,
        temp: 0.8,
        repeat_last_n: 64,
        repeat_penalty: 1.1,
        debug: false,
        models: [config.model],
        prompt: generatePrompt(message)
    }

    socket.emit("request", request);

    var response = "";
    var fullresponse = ""
    var result = ""

    delay(500);
    socket.emit("stop")

    socket.on("result", result => {
        var i = 0;

        response += result.response;
        fullresponse += result.response;

        if (response.endsWith("<end>")) {
            socket.emit("stop");

            response = response.replace("<end>", "").trim()
            response = response.substring(request.prompt.length + 4, response.length)

            client.api.channels[message.channel.id].messages.post({
                data: {
                    content: response,
                    message_reference: {
                        message_id: message.id,
                        channel_id: message.channel.id,
                        guild_id: message.guild.id
                    }
                }
            }).then(() => {
                console.log("\x1b[44m\n// RESPONSE //\x1b[0m\n")
                console.log(fullresponse)
                console.log("\x1b[44m// END OF RESPONSE //\x1b[0m\n")
            })
        }
    })
})

function generatePrompt(message) {

    var input = `You are the President of the United States, Joe Biden.
You must reply in-character, to any questions asked by your Citizens.
Refer to your Citizens by name.
${message.author.username}: ${message.content.replace(`<@${config.bot_uid}>`, "").trim()}
Joe Biden: `

    console.log("\x1b[41m// PROMPT GENERATED //\x1b[0m")
    console.log(input)
    console.log("\x1b[41m// END OF PROMPT //\x1b[0m")

    return input;
}

let [arg] = process.argv.slice(2);
let token = process.env.BOT_TOKEN;
if (arg == "dev") { token = process.env.DEV_TOKEN }
client.login(token);
