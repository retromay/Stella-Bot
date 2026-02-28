import { AttachmentBuilder, Client, Events, Message } from "discord.js";
import { assets } from "../asset";

type TriggerResponse =
  | { type: "file"; path: string }
  | { type: "text"; content: string };

const TRIGGERS: Record<string, TriggerResponse> = {
  anjing: { type: "file", path: assets.bonkExplosion },
  anomali: { type: "text", content: "yoshirawa" },
};

export function registerMessageCreateEvent(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    for (const [word, response] of Object.entries(TRIGGERS)) {
      if (content.includes(word)) {
        if (response.type === "file") {
          const attachment = new AttachmentBuilder(response.path);
          await message.reply({ files: [attachment] });
        } else {
          await message.reply(response.content);
        }
      }
    }
  });
}
