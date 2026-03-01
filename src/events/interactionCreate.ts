import { Client, Events, Interaction } from "discord.js";
import {
  handleAttendanceInteraction,
  handleAttendanceSlashCommand,
} from "@/commands/attendance";

export function registerInteractionCreateEvent(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      // Slash commands
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "attendance") {
          await handleAttendanceSlashCommand(interaction);
        }
        return;
      }

      // Buttons, select menus, modals
      await handleAttendanceInteraction(interaction);
    } catch (error) {
      console.error("[InteractionCreate Error]", error);

      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content: "An error occurred while processing this interaction.",
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
  });
}
