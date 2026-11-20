import { Client, Events, Interaction } from "discord.js";
import {
  handleAttendanceInteraction,
  handleAttendanceSlashCommand,
} from "@/commands/attendance";
import {
  handleAttendanceTemplateSlashCommand,
  handleTemplateAutocomplete,
} from "@/commands/attendanceTemplate";
import { handleLfpSlashCommand } from "@/commands/lfp";

export function registerInteractionCreateEvent(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      // Autocomplete (template names)
      if (interaction.isAutocomplete()) {
        if (
          interaction.commandName === "attendance" ||
          interaction.commandName === "attendance-template"
        ) {
          await handleTemplateAutocomplete(interaction);
        }
        return;
      }

      // Slash commands
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "attendance") {
          await handleAttendanceSlashCommand(interaction);
        } else if (interaction.commandName === "attendance-template") {
          await handleAttendanceTemplateSlashCommand(interaction);
        } else if (interaction.commandName === "lfp") {
          await handleLfpSlashCommand(interaction);
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
