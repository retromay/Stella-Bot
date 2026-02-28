import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config";
import { registerReadyEvent } from "./events/ready";
import { registerMessageCreateEvent } from "./events/messageCreate";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

registerReadyEvent(client);
registerMessageCreateEvent(client);

client.login(config.discordToken);
