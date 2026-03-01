import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "@/config";
import { registerReadyEvent } from "@/events/ready";
import { registerMessageCreateEvent } from "@/events/messageCreate";
import { registerMessageReactionAddEvent } from "@/events/messageReactionAdd";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// Global error handlers — prevent crashes
client.on("error", (error) => {
  console.error("[Client Error]", error.message);
});

process.on("unhandledRejection", (error) => {
  console.error("[Unhandled Rejection]", error);
});

registerReadyEvent(client);
registerMessageCreateEvent(client);
registerMessageReactionAddEvent(client);

client.login(config.discordToken);
