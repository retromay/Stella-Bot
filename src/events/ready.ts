import { Client, Events } from "discord.js";

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Stella Bot is online! Logged in as ${readyClient.user.tag}`);
  });
}
