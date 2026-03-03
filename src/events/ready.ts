import { Client, Events } from "discord.js";
import { attendanceCommand } from "@/commands/attendance";
import { lfpCommand } from "@/commands/lfp";

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Stella Bot is online! Logged in as ${readyClient.user.tag}`);

    // Register slash commands
    await readyClient.application.commands.set([attendanceCommand, lfpCommand]);
    console.log("Slash commands registered.");
  });
}
