import { read } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

var lock = false; // lock input until LLM is finished, stops crosstalk.

import { io } from "socket.io-client";

let { Client: DiscordClient, MessageManager, Message, MessageEmbed, MessageAttachment } = require('discord.js-12'),
    { config: loadEnv } = require('dotenv')

loadEnv()

let config = {
    bot_uid: 0,    // bot UID will be added on login
    supply_date: false,             // whether the prompt supplies the date & time
    reply_depth: 3,                 // how many replies deep to add to the prompt.
    model: "alpaca.7B"              // which AI model to use
}

let client = new DiscordClient();
let delay = ms => new Promise(res => setTimeout(res, ms));

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    config.bot_uid = client.user.id;

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
    if (!message.guild || message.author.bot) { return };

    if (lock) { return }

    var user = message.mentions.users.first() // get mentioned users

    if (user == undefined || user.id != config.bot_uid) { return; } // return if bot isn't mentioned - works for reply and ping

    console.log("\x1b[32mBot mentioned - Generating prompt...\x1b[0m\n")

    lock = true // lock input until LLM has returned

    var request = {
        seed: -1,
        threads: 10,
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

    var socket = io("ws://127.0.0.1:3000"); // connect to LLM

    message.channel.startTyping();
    socket.emit("request", request);

    var response = "";
    var fullresponse = ""

    console.log("\n\x1b[32mGenerating response...\x1b[0m")

    socket.on("result", result => {
        response += result.response;
        fullresponse += result.response;

        if (!message.deletable) // stops bot from crashing if the message was deleted
        {
            console.log("\x1b[41m Original message was deleted.\x1b[0m")
            message.channel.stopTyping()
            socket.disconnect()
            lock = false
        }

        else if (response.endsWith("<end>")) {
            response = response.replace(/[\r]/gm, "")
            response = response.replace("\$", "\\$")
            response = response.substring(response.length, request.prompt.length).trim()
            response = response.replace("<end>", "").trim()
            response = response.replace("[end of text", "").trim()

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
                console.log("\n\x1b[44m// RESPONSE //\x1b[0m")
                console.log(response)
                console.log("\x1b[44m// END OF RESPONSE //\x1b[0m\n")
                message.channel.stopTyping()
                socket.disconnect()
                lock = false
            })
        }
    })
})

function generatePrompt(message) {

    var userinput = message.content.trim()
    userinput = userinput.replaceAll(`<@${config.bot_uid}>`, "").trim()
    //userinput = userinput.replaceAll("`", "").trim()
    //userinput = userinput.replaceAll("$", `\\$`)
    //userinput = userinput.replaceAll("{", "(").replaceAll("}", ")")

    var input = `You are the President of the United States, Joe Biden.
You must reply in-character, to any questions asked by your Citizens.
Refer to your Citizens by name.
${message.author.username}: ${userinput}
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
