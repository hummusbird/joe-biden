import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');

var lock = false; // lock input until LLM is finished, stops crosstalk.
var bot_uid = 0; // bot UID will be assigned on login

import { io } from "socket.io-client";

let { Client: DiscordClient, MessageManager, Message, MessageEmbed, MessageAttachment } = require('discord.js-12'),
	{ config: loadEnv } = require('dotenv')

loadEnv();

// default configuration

let config = {
	supply_date: false,             // whether the prompt supplies the date & time
	reply_depth: 5,                 // how many replies deep to add to the prompt - higher = slower
	model: "alpaca.7B",             // which AI model to use
	bot_name: "Joe Biden",          // who the bot thinks it is
	prompt: "You are the President of the United States, Joe Biden.\nYou must reply in-character, to any questions asked by your Citizens.\nRefer to your Citizens by name, with concise answers.",
	threads: 4						// how many threads to use
}

fs.readFile('./config.json', 'utf8', (error, data) => {
	if (error) {
		console.log(error);
		return;
	}
	config = JSON.parse(data);
})

let client = new DiscordClient();
let delay = ms => new Promise(res => setTimeout(res, ms));

client.on('ready', async () => {
	console.log(`Logged in as ${client.user.tag}!`);

	bot_uid = client.user.id;

	let guilds = client.guilds.cache.map(guild => guild);
	console.log(`The bot is in ${guilds.length} guilds`);
});

client.on('guildCreate', async guild => {
	console.log("\x1b[32m", `Joined new guild: ${guild.name}`);
})

client.on('guildDelete', async guild => {
	console.log("\x1b[31m", `Kicked from Guild: ${guild.name}`);
})

await client.on('message', async message => {
	if (!message.guild || message.author.bot) { return; }

	if (lock) { return; } // ignore message if currently generating

	var users = message.mentions.users // get mentioned users

	if (users == undefined || users == null) { return; } // return if no mentions - works for reply and ping

	var bot_mentioned = false

	users.forEach(user => {
		if (user.id == bot_uid) { bot_mentioned = true; }
	})

	if (message.content.toLowerCase().includes(config.bot_name.toLowerCase())) { bot_mentioned = true; }

	if (!bot_mentioned) { return; }

	console.log("\x1b[32mBot mentioned - Generating prompt...\x1b[0m\n");

	lock = true // lock input until LLM has returned

	var request = {
		seed: -1,
		threads: config.threads,
		n_predict: 200,
		top_k: 40,
		top_p: 0.9,
		temp: 0.8,
		repeat_last_n: 64,
		repeat_penalty: 1.1,
		debug: false,
		models: [config.model],
		prompt: await generatePrompt(message)
	}

	var socket = io("ws://127.0.0.1:3000"); // connect to LLM

	message.channel.startTyping();
	socket.emit("request", request);

	var response = "";
	var fullresponse = "";

	console.log("\n\x1b[32mGenerating response...\x1b[0m");

	console.log("\n\x1b[44m// RESPONSE //\x1b[0m");

	socket.on("result", result => {

		response += result.response;
		process.stdout.write(result.response)

		if (response.length > request.prompt.length) {
			let trimmedresponse = response.substring(response.length, request.prompt.length).trim();
			if (trimmedresponse.includes("\n[")) {
				console.log("\n\x1b[43m\x1b[30mBot tried to rant\x1b[0m");

				response = response.substring(0, response.length - 3)
				response += "\n<end>"

				var stoprequest = {
					prompt: "/stop"
				}

				socket.emit("request", stoprequest);
			}
		}

		if (!message.deletable) // stops bot from crashing if the message was deleted
		{
			console.log("\x1b[41mOriginal message was deleted.\x1b[0m");

			var stoprequest = {
				prompt: "/stop"
			}

			socket.emit("request", stoprequest);
			message.channel.stopTyping();
			socket.disconnect();
			lock = false;
		}

		else if (response.endsWith("<end>")) {
			response = response.replace(/[\r]/gm, "");
			response = response.replace("\$", "\\$");
			response = response.substring(response.length, request.prompt.length).trim();
			response = response.replace("<end>", "").trim();
			response = response.replace("[end of text]", "").trim(); // sometimes the model says this for no reason

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
				console.log("\n\x1b[44m// END OF RESPONSE //\x1b[0m\n");
				message.channel.stopTyping();
				socket.disconnect();
				lock = false;
			})
		}
	})
})

async function GetReplyStack(message, stack, depth) {
	var ref = message.reference;

	if (ref == undefined || ref == null || depth >= config.reply_depth) { return stack }

	var repliedTo = await message.channel.messages.fetch(ref.messageID);

	var name = repliedTo.author.id == bot_uid ? config.bot_name : repliedTo.author.username;
	var content = repliedTo.content;

	stack = `[${name}]: ${content}\n` + stack;
	depth++;

	return GetReplyStack(repliedTo, stack, depth);
}

async function replaceUsernames(input) {
	var regex = /<@[0-9]+>/g;
	var matches = input.match(regex);

	if (matches == undefined || matches == null) { return input; }

	matches.forEach(uid => {
		var id = uid.replace(/[^0-9.]/g, '');
		var user = client.users.cache.find(user => user.id == id);

		if (user == undefined || user == null) { return; }

		var name = id === bot_uid ? "" : user.username; // only replace mentions of users, and strip the bot

		input = input.replaceAll(uid, name).trim();
	})

	return input;
}

async function generatePrompt(message) {

	let stack = "";
	stack = await GetReplyStack(message, stack, 1);						// add all replies in thread
	stack += `[${message.author.username}]: ${message.content}\n`;		// add username and message
	stack = await replaceUsernames(stack);								// replace all mentions with usernames
	stack = stack.replaceAll(`<@${bot_uid}>`, "").trim();		// replace bot UID with nothing
	stack = stack.replaceAll(/  +/g, " ");								// strip double space   
	//stack = stack.replaceAll("`", "").trim();
	//stack = stack.replaceAll("$", `\\$`);
	//stack = stack.replaceAll("{", "(").replaceAll("}", ")");

	var datetime = "";

	if (config.supply_date) {
		let date_ob = new Date();
		var date = date_ob.toLocaleDateString('en-GB');
		var time = date_ob.toLocaleTimeString();

		datetime = "The date is " + date + " " + time + "\n";
	}

	var input = datetime + config.prompt + "\n" + stack + "\n[" + config.bot_name + "]:";

	console.log("\x1b[41m// PROMPT GENERATED //\x1b[0m");
	console.log(input);
	console.log("\x1b[41m// END OF PROMPT //\x1b[0m");

	return input;
}

let [arg] = process.argv.slice(2);
let token = process.env.BOT_TOKEN;
if (arg == "dev") { token = process.env.DEV_TOKEN; }
client.login(token);
