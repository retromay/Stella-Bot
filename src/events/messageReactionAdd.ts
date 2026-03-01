import { Client, Events, MessageReaction, User } from "discord.js";
import { handleLfpReaction } from "@/commands/lfp";

export function registerMessageReactionAddEvent(client: Client): void {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;

    try {
      // Fetch partials if needed (for uncached messages/reactions)
      if (reaction.partial) {
        await reaction.fetch();
      }

      await handleLfpReaction(
        reaction as MessageReaction,
        user as User,
      );
    } catch (error) {
      console.error("[ReactionAdd Error]", error);
    }
  });
}
