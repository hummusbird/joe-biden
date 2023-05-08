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
	admin_only: false,				// only allow admins to interact with the bot
	prompt: "You are the President of the United States, Joe Biden.\nYou must reply in-character, to any questions asked by your Citizens.\nRefer to your Citizens by name, with concise answers.",
	threads: 4						// how many threads to use
}

let client = new DiscordClient();

client.on('ready', async () => {
	console.log(`Logged in as ${client.user.tag}!`);

	bot_uid = client.user.id;

	let guilds = client.guilds.cache.map(guild => guild);
	console.log(`The bot is in ${guilds.length} guilds`);
});

await LoadConfig();

client.on('guildCreate', async guild => {
	console.log("\x1b[32m", `Joined new guild: ${guild.name}`);
})

client.on('guildDelete', async guild => {
	console.log("\x1b[31m", `Kicked from Guild: ${guild.name}`);
})

await client.on('message', async message => {
	if (!message.guild || message.author.bot) { return; } // ignore messages from dms or other bots
	if (lock) { return; } // ignore message if currently generating
	if (config.admin_only == true && !message.member.hasPermission("ADMINISTRATOR")) { return; }

	var users = message.mentions.users // get mentioned users
	if (users == undefined || users == null) { return; } // return if no mentions - works for reply and ping

	if (message.content.startsWith(">>") && message.member.hasPermission("ADMINISTRATOR")) { // admin commands
		let commands = message.content.substring(2, message.content.length).split(" ");

		switch (commands[0]) {
			case "set":
				if (commands[2] == null || commands[2] == undefined) { break; } // nothing after "set"

				switch (commands[1]) {
					case "name":
						commands.splice(0, 2)
						config.bot_name = commands.toString().replaceAll(",", " ").replaceAll(/  +/g, " ");
						message.channel.send('```diff\n+ set bot_name```')
						return;
					case "prompt":
						commands.splice(0, 2)
						config.prompt = commands.toString().replaceAll(",", " ").replaceAll(/  +/g, " ");
						message.channel.send('```diff\n+ set prompt```')
						return;
					case "admin":
						config.admin_only = commands[2]
						message.channel.send('```diff\n+ set admin_only```')
						return;
					case "date":
						config.supply_date = commands[2]
						message.channel.send('```diff\n+ set supply_date```')
						return;
					case "depth":
						config.reply_depth = commands[2]
						message.channel.send('```diff\n+ set reply_depth```')
						return;
					default:
						break;
				}
			case "reload":
				await LoadConfig();
				message.channel.send('```diff\n+ reloaded config```')
				return;
			default:
				break;
		}

		message.channel.send('```diff\n- invalid command```')
	}

	var bot_mentioned = false

	users.forEach(user => { if (user.id == bot_uid) { bot_mentioned = true; } })  // bot explicitly pinged
	if (message.content.toLowerCase().includes(config.bot_name.toLowerCase())) { bot_mentioned = true; } // bot implicitly mentioned

	if (!bot_mentioned) { return; }

	console.log("\x1b[32mBot mentioned - Generating prompt...\x1b[0m\n");

	lock = true // lock input until LLM has returned

	var imageregex = /\b(take|post|paint|generate|make|draw|create|show|give|snap|capture|send|display|share|shoot|see|provide|another)\b.*(\S\s{0,10})?(image|picture|screenshot|screenie|painting|pic|photo|photograph|portrait|selfie)/gm

	if (message.content.toLowerCase().match(imageregex)) {
		await SendSDImage(message); // image requested from bot
	}
	else {
		await SendLLMText(message); // text requested from bot
	}
})

async function SendSDImage(message) {
	console.log("\x1b[32mImage requested - Generating prompt...\x1b[0m");

	var SDPrompt = await GenerateSDPrompt(message);

	const payload = JSON.stringify({
		prompt: SDPrompt,
		steps: 15,
		width: 512,
		height: 768
	});

	console.log("\x1b[32mGenerating image based on prompt...\x1b[0m");

	fetch(`http://localhost:7860/sdapi/v1/txt2img`, {
		body: payload,
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		}
	}).then(res => res.json())
		.then(data => {
			let b64buffer = new Buffer.from(data.images[0], "base64");
			const attachment = new MessageAttachment(b64buffer);
			message.channel.send(attachment);
		})
		.then(() => {
			message.channel.stopTyping();
			lock = false;
		})
}

async function SendLLMText(message) {
	var out = await GetLLMReply(await GenerateLLMPrompt(message), message)

	if (out != null && out != undefined) {
		client.api.channels[message.channel.id].messages.post({
			data: {
				content: out,
				message_reference: {
					message_id: message.id,
					channel_id: message.channel.id,
					guild_id: message.guild.id
				}
			}
		})
	}

	message.channel.stopTyping();
	lock = false;
}

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

async function ReplaceUsernames(input) {
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

async function GenerateLLMPrompt(message) {
	let stack = "";
	stack = await GetReplyStack(message, stack, 1);						// add all replies in thread
	stack += `[${message.author.username}]: ${message.content}\n`;		// add username and message
	stack = await ReplaceUsernames(stack);								// replace all mentions with usernames
	stack = stack.replaceAll(`<@${bot_uid}>`, "").trim();				// replace bot UID with nothing
	stack = stack.replaceAll(/  +/g, " ");								// strip double space   
	//stack = stack.replaceAll("`", "").trim();
	//stack = stack.replaceAll("$", `\\$`);
	//stack = stack.replaceAll("{", "(").replaceAll("}", ")");

	var datetime = "";

	if (config.supply_date == true) {
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

async function GenerateSDPrompt(message) {
	let stack = "";
	stack = await GetReplyStack(message, stack, 1);						// add all replies in thread
	stack += `[${message.author.username}]: ${message.content}\n`;		// add username and message
	stack = await ReplaceUsernames(stack);								// replace all mentions with usernames
	stack = stack.replaceAll(`<@${bot_uid}>`, "").trim();				// replace bot UID with nothing
	stack = stack.replaceAll(/  +/g, " ");								// strip double space
	stack = stack.replaceAll(' you ', ` ${config.bot_name} `);			// replace "you" with the bot's name
	stack = stack.replaceAll(' your ', ` ${config.bot_name}s `)			// replace "your" with the bot's name
	stack = stack.replaceAll(' yourself ', ` ${config.bot_name}s `)		// replace "yourself" with the bot's name

	let instruction = "### Instruction: Create descriptive nouns and image tags to describe an image that the user requests. Maintain accuracy to the user's prompt.\n";

	let input = instruction + stack + "\n### Description of the requested image:";

	console.log("\x1b[41m// PROMPT GENERATED //\x1b[0m");
	console.log(input);
	console.log("\x1b[41m// END OF PROMPT //\x1b[0m");

	return await GetLLMReply(input, message)
}

async function GetLLMReply(input, message) {
	return new Promise(function (resolve) {
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
			prompt: input
		}

		var socket = io("ws://127.0.0.1:3000"); // connect to LLM

		message.channel.startTyping();
		socket.emit("request", request);

		var response = "";

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

					socket.emit("request", { prompt: "/stop" });
				}
			}

			if (!message.deletable) // stops bot from crashing if the message was deleted
			{
				console.log("\n\x1b[43m\x1b[30mOriginal message was deleted\x1b[0m");

				socket.emit("request", { prompt: "/stop" });

				message.channel.stopTyping();
				setTimeout(() => socket.disconnect(), 100)
				lock = false;
				resolve(null)
			}

			else if (response.endsWith("<end>")) {
				response = response.replace(/[\r]/gm, "");
				response = response.replace("\$", "\\$");
				response = response.substring(response.length, request.prompt.length).trim();
				response = response.replace("<end>", "").trim();
				response = response.replace("[end of text]", "").trim(); // sometimes the model says this for no reason

				socket.disconnect();
				console.log("\n\x1b[44m// END OF RESPONSE //\x1b[0m\n");

				resolve(response)
			}
		})
	})
}

async function LoadConfig() {
	fs.readFile('./config.json', 'utf8', (error, data) => {
		if (error) {
			console.log(error);
			return;
		}
		config = JSON.parse(data);
	})
}

let [arg] = process.argv.slice(2);
let token = process.env.BOT_TOKEN;
if (arg == "dev") { token = process.env.DEV_TOKEN; }
client.login(token);
