export const ATTENDANCE_MIN_SLOTS = 1;
export const ATTENDANCE_MAX_SLOTS = 100;

export const ATTENDANCE_ROLES = [
  { name: "Mainball", emoji: "⚔️" }, // ⚔️
  { name: "Shotcaller", emoji: "📢" }, // 📢
  { name: "Shai", emoji: "💚" }, // 💚
  { name: "Def Team", emoji: "🏰" }, // 🏰
  { name: "ELE", emoji: "🐘" }, // 🐘
  { name: "Flex", emoji: "🔀" }, // 🔀
] as const;

/** Attendance role whose members also pick a Def duty. */
export const DEF_TEAM_ROLE_NAME = "Def Team";

/** Self-reported playstyle category, used for the composition summary. */
export const PLAYER_CATEGORIES = [
  { key: "tank", name: "Tank", emoji: "🛡️" }, // 🛡️
  { key: "melee", name: "Melee", emoji: "🗡️" }, // 🗡️
  { key: "mage", name: "Mage", emoji: "🔮" }, // 🔮
  { key: "range", name: "Range", emoji: "🏹" }, // 🏹
  { key: "healer", name: "Healer", emoji: "💚" }, // 💚
] as const;

/** Def Team duties — informational only, no limits. */
export const DEF_DUTIES = [
  { key: "hwacha", name: "Hwacha", emoji: "🚀" }, // 🚀
  { key: "ft", name: "Flame Tower", emoji: "🔥" }, // 🔥
  { key: "cannon", name: "Cannon", emoji: "💣" }, // 💣
] as const;

export const UNSET_EMOJI = "❔"; // ❔

/** Platoon rules: balanced fighting platoons + one unbalanced Def/Flex platoon. */
export const MAIN_PLATOON_COUNT = 2;
export const PLATOON_RULES = { shaiMin: 2, mageMin: 2 } as const;
export const PLATOON_MAIN_ROLES = ["Mainball", "Shotcaller", "Shai", "ELE"] as const;
export const PLATOON_SUPPORT_ROLES = ["Def Team", "Flex"] as const;
export const SHOTCALLER_ROLE_NAME = "Shotcaller";
export const SHAI_CLASS_NAME = "Shai";

/** All BDO classes (32 as of Agent, July 2026), alphabetical. */
export const BDO_CLASSES = [
  "Agent", "Archer", "Berserker", "Corsair", "Dark Knight", "Deadeye",
  "Dosa", "Drakania", "Guardian", "Hashashin", "Kunoichi", "Lahn",
  "Maegu", "Maehwa", "Musa", "Mystic", "Ninja", "Nova", "Ranger", "Sage",
  "Scholar", "Seraph", "Shai", "Sorceress", "Striker", "Tamer", "Valkyrie",
  "Warrior", "Witch", "Wizard", "Woosa", "Wukong",
] as const;

// Discord select menus allow max 25 options — split classes into two menus
export const CLASS_SELECT_SPLIT = 16;

/** Templates available in every guild. A saved template with the same name overrides these. */
export const BUILTIN_TEMPLATES: { name: string; counts: Record<string, number> }[] = [
  {
    name: "T2 40-man",
    counts: { Mainball: 25, Shotcaller: 1, Shai: 4, "Def Team": 4, ELE: 1, Flex: 5 },
  },
  {
    name: "T2 50-man",
    counts: { Mainball: 34, Shotcaller: 1, Shai: 5, "Def Team": 4, ELE: 1, Flex: 5 },
  },
];

// Custom ID prefixes for interaction routing (scoped by message ID for concurrency)
// "att_" keeps these separate from the live /attendance command ("att_")
export const ATT_ID = {
  SETUP_ROLE: "att_setup_role",
  SETUP_PING: "att_setup_ping",
  SETUP_TITLE: "att_setup_title",
  SETUP_CONFIRM: "att_setup_confirm",
  SETUP_CANCEL: "att_setup_cancel",
  SETUP_SAVE_TPL: "att_setup_save_tpl",
  MODAL_ROLE: "att_modal_role",
  MODAL_TITLE: "att_modal_title",
  MODAL_SAVE_TPL: "att_modal_save_tpl",
  SIGNUP: "att_signup",
  LEAVE: "att_leave",
  CLOSE: "att_close",
  EDIT_ROSTER: "att_edit_roster",
  MODAL_EDIT_ROSTER: "att_modal_edit_roster",
  DETAILS: "att_details",
  CATEGORY: "att_category",
  CLASS_A: "att_class_a",
  CLASS_B: "att_class_b",
  DUTY: "att_duty",
  PLATOONS: "att_platoons",
  PLATOON_SHUFFLE: "att_platoon_shuffle",
  PLATOON_PING: "att_platoon_ping",
  PLATOON_POST: "att_platoon_post",
  PLATOON_CANCEL: "att_platoon_cancel",
} as const;
