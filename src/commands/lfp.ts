import {
  EmbedBuilder,
  Message,
  MessageReaction,
  PermissionFlagsBits,
  User,
  TextChannel,
} from "discord.js";
import { LFP_MAX_PARTY_SIZE, LFP_JOIN_EMOJI, LFP_LEAVE_EMOJI } from "@/constants/lfp";
import { LfpParty } from "@/types/lfp";

// Key: messageId
const activeParties = new Map<string, LfpParty>();

function buildPartyEmbed(party: LfpParty): EmbedBuilder {
  const isFull = party.members.length >= party.maxSize;

  const slots = Array.from({ length: party.maxSize }, (_, i) => {
    const memberId = party.members[i];
    return `${i + 1}. ${memberId ? `<@${memberId}>` : "Waiting..."}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${party.creatorName}'s Party (${party.members.length}/${party.maxSize})`)
    .setDescription(slots.join("\n"))
    .setColor(isFull ? 0x00ff00 : 0x5865f2);

  if (isFull) {
    embed.setFooter({ text: "Party is full!" });
  } else {
    embed.setFooter({ text: `${LFP_JOIN_EMOJI} Join  |  ${LFP_LEAVE_EMOJI} Leave` });
  }

  return embed;
}

function buildClosedEmbed(party: LfpParty): EmbedBuilder {
  const slots = party.members.map((id, i) => `${i + 1}. <@${id}>`);

  return new EmbedBuilder()
    .setTitle(`${party.creatorName}'s Party (Closed)`)
    .setDescription(slots.join("\n"))
    .setColor(0xed4245)
    .setFooter({ text: "This party has been closed." });
}

async function closeParty(party: LfpParty, message: Message): Promise<void> {
  activeParties.delete(party.messageId);

  const channel = message.channel as TextChannel;
  try {
    const original = await channel.messages.fetch(party.messageId);
    const embed = buildClosedEmbed(party);
    await original.edit({ embeds: [embed] });
  } catch {
    // Original message may have been deleted
  }

  const mentions = party.members.map((id) => `<@${id}>`).join(" ");
  await channel.send(`Party closed early! ${mentions}`);
}

export async function handleLfpCommand(message: Message): Promise<boolean> {
  const content = message.content.toLowerCase();

  if (!content.startsWith("!lfp")) return false;
  if (!message.guild) return true;

  // Check if bot has permission to send messages in this channel
  const botPermissions = message.channel.isTextBased() && "permissionsFor" in message.channel
    ? message.channel.permissionsFor(message.guild.members.me!)
    : null;
  if (botPermissions && !botPermissions.has(PermissionFlagsBits.SendMessages)) {
    return true; // Silently skip — can't send here
  }

  const args = message.content.split(/\s+/);

  // Handle !lfp close
  if (args[1]?.toLowerCase() === "close") {
    const party = [...activeParties.values()].find(
      (p) => p.creatorId === message.author.id && p.guildId === message.guild!.id,
    );
    if (!party) {
      await message.reply("You don't have an active party to close.");
      return true;
    }
    await closeParty(party, message);
    return true;
  }

  const count = parseInt(args[1], 10);

  if (isNaN(count) || count < 1 || count > LFP_MAX_PARTY_SIZE - 1) {
    await message.reply(
      `Usage: \`!LFP <1-${LFP_MAX_PARTY_SIZE - 1}>\` — number of extra members needed.\nUse \`!LFP close\` to close your party early.`,
    );
    return true;
  }

  const party: LfpParty = {
    messageId: "",
    channelId: message.channel.id,
    guildId: message.guild.id,
    creatorId: message.author.id,
    creatorName: message.member?.displayName ?? message.author.username,
    members: [message.author.id],
    maxSize: count + 1, // +1 for creator
  };

  const embed = buildPartyEmbed(party);
  const channel = message.channel as TextChannel;
  const reply = await channel.send({ embeds: [embed] });

  party.messageId = reply.id;
  activeParties.set(reply.id, party);

  await reply.react(LFP_JOIN_EMOJI);
  await reply.react(LFP_LEAVE_EMOJI);

  return true;
}

export async function handleLfpReaction(
  reaction: MessageReaction,
  user: User,
): Promise<void> {
  const party = activeParties.get(reaction.message.id);
  if (!party) return;

  const emoji = reaction.emoji.name;

  if (emoji === LFP_JOIN_EMOJI) {
    await handleJoin(reaction, user, party);
  } else if (emoji === LFP_LEAVE_EMOJI) {
    await handleLeave(reaction, user, party);
  }
}

async function handleJoin(
  reaction: MessageReaction,
  user: User,
  party: LfpParty,
): Promise<void> {
  // Remove the user's reaction so it resets for next use
  await reaction.users.remove(user.id);

  if (user.id === party.creatorId) return;
  if (party.members.includes(user.id)) return;
  if (party.members.length >= party.maxSize) return;

  party.members.push(user.id);

  const embed = buildPartyEmbed(party);
  await reaction.message.edit({ embeds: [embed] });

  // Party is now full — announce
  if (party.members.length >= party.maxSize) {
    const mentions = party.members.map((id) => `<@${id}>`).join(" ");
    const channel = reaction.message.channel as TextChannel;
    await channel.send(`Party is ready! ${mentions}`);
    activeParties.delete(party.messageId);
  }
}

async function handleLeave(
  reaction: MessageReaction,
  user: User,
  party: LfpParty,
): Promise<void> {
  // Remove the user's reaction so it resets for next use
  await reaction.users.remove(user.id);

  // Creator cannot leave their own party
  if (user.id === party.creatorId) return;

  // Only remove if they're actually in the party
  const index = party.members.indexOf(user.id);
  if (index === -1) return;

  // Party is already full (locked in)
  if (party.members.length >= party.maxSize) return;

  party.members.splice(index, 1);

  const embed = buildPartyEmbed(party);
  await reaction.message.edit({ embeds: [embed] });
}
