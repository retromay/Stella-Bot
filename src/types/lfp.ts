export interface LfpParty {
  messageId: string;
  channelId: string;
  guildId: string;
  creatorId: string;
  creatorName: string;
  members: string[]; // user IDs (includes creator)
  maxSize: number;
  title?: string;
}
