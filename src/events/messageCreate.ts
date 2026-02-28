import { AttachmentBuilder, Client, Events, Message } from "discord.js";
import { assets } from "../asset";

const TRIGGER_WORDS: Record<string, string> = {
  anjing: assets.bonkExplosion,
};

export function registerMessageCreateEvent(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore messages from bots (including ourselves)
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    for (const [word, filePath] of Object.entries(TRIGGER_WORDS)) {
      if (content.includes(word)) {
        const attachment = new AttachmentBuilder(filePath);
        await message.reply({ files: [attachment] });
        break;
      }
    }
  });
}
