import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { io } from "socket.io-client";

let { Client: DiscordClient, Message, MessageEmbed, MessageAttachment } = require('discord.js-12'),
    { config: loadEnv } = require('dotenv')

loadEnv()

const socket = io("ws://localhost:3000");

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

    if (user == undefined || user.id != 951476676603310100) { return; }

    console.log("bot mentioned")

    var input = `You are the President of the United States, Joe Biden.
You must reply in-character, to any questions asked by your Citizens.
Refer to your Citizens by name.
${message.author.username}: ${message.content.replace("<@951476676603310100>", "").trim()}
Joe Biden: `

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
        models: ["alpaca.7B", "llama.13B"],
        model: "llama.13B",
        prompt: input
    }

    socket.emit("request", request);

    var response = "";
    var result = ""

    socket.on("result", result => {
        var i = 0;

        while (i < 1) {
            response += result.response;
            i++;
        }

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
            })
            response = ""
            return;
        }
    })
})

let [arg] = process.argv.slice(2);
let token = process.env.BOT_TOKEN;
if (arg == "dev") { token = process.env.DEV_TOKEN }
client.login(token);