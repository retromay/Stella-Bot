import { AttachmentBuilder, Message, PermissionFlagsBits } from "discord.js";
import { assets } from "@/asset";

const JAIL_LIMIT = 50;
const WARN_INTERVAL = 10;

const jailedUsers = new Map<string, number>(); // userId -> remaining characters

export async function handleJailCommand(message: Message): Promise<boolean> {
  if (!message.content.toLowerCase().startsWith("!jail")) return false;

  const member = message.member;
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("You need Administrator permission to use this.");
    return true;
  }

  const target = message.mentions.users.first();
  if (!target) {
    await message.reply("Usage: `!jail @user`");
    return true;
  }

  if (jailedUsers.has(target.id)) {
    await message.reply(`${target} is already under the eyes of judgement.`);
    return true;
  }

  jailedUsers.set(target.id, JAIL_LIMIT);
  await message.reply(
    `${target} has been jailed! ${JAIL_LIMIT} characters remaining. Choose your words wisely.`,
  );
  return true;
}

export async function handleJailTracking(message: Message): Promise<void> {
  const remaining = jailedUsers.get(message.author.id);
  if (remaining === undefined) return;

  const previousBucket = Math.floor(remaining / WARN_INTERVAL);
  const newRemaining = remaining - message.content.length;

  if (newRemaining <= 0) {
    jailedUsers.delete(message.author.id);
    const attachment = new AttachmentBuilder(assets.spongebobJail);
    await message.reply({
      content: "You are jailed now!",
      files: [attachment],
    });
    return;
  }

  jailedUsers.set(message.author.id, newRemaining);

  const currentBucket = Math.floor(newRemaining / WARN_INTERVAL);
  if (currentBucket < previousBucket) {
    const rounded = currentBucket * WARN_INTERVAL;
    await message.reply(`${rounded} characters remaining, be careful!`);
  }
}
