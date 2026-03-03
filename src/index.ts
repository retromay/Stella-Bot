import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "@/config";
import { initDatabase } from "@/services/database";
import { loadLfpPartiesFromDb } from "@/commands/lfp";
import { loadAttendanceSessionsFromDb } from "@/commands/attendance";
import { registerReadyEvent } from "@/events/ready";
import { registerMessageCreateEvent } from "@/events/messageCreate";
import { registerMessageReactionAddEvent } from "@/events/messageReactionAdd";
import { registerInteractionCreateEvent } from "@/events/interactionCreate";

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

// Initialize database and load persisted state
initDatabase();
loadLfpPartiesFromDb();
loadAttendanceSessionsFromDb();

registerReadyEvent(client);
registerMessageCreateEvent(client);
registerMessageReactionAddEvent(client);
registerInteractionCreateEvent(client);

client.login(config.discordToken);
