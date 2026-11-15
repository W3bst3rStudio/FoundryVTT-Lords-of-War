// Pure game logic for the Necr "Undead Variability" step. No Foundry globals in this file,
// so it can be unit-tested under plain Node.

export const MODULE_ID = "lords-of-war-necris";
export const SOURCE = "LOWNC";
export const ESSENCE_FEAT = "Necran Essence Empowerment";
export const ARCHETYPES = ["wight", "skeletal", "spectral"];

export const ABILITY_NAMES = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};

// Active effect change builders. Same shape Plutonium itself writes on Foundry v14
// (`type` string + `priority`, stored in `system.changes`).
const PRIORITY_BASE = 4;
const PRIORITY_BONUS = 7;
export const add = (key, value) => ({key, type: "add", value, priority: PRIORITY_BONUS});
export const upgrade = (key, value) => ({key, type: "upgrade", value, priority: PRIORITY_BASE});

const abilityAdd = (ab, v) => add(`system.abilities.${ab}.value`, v);

/** Undead Weakness Table (d6). `choose` = ability the player must pick from. */
export const WEAKNESSES = {
	1: {name: "Sunlight Sensibility", text: "You have disadvantage on attack rolls and on Wisdom (Perception) checks that rely on sight when you, the target of your attack, or whatever you are trying to perceive is in direct sunlight.", changes: () => []},
	2: {name: "Radiant Damage Vulnerability", text: "You are vulnerable to radiant damage.", changes: () => [add("system.traits.dv.value", "radiant")]},
	3: {name: "Bludgeoning Damage Vulnerability", text: "You are vulnerable to bludgeoning damage.", changes: () => [add("system.traits.dv.value", "bludgeoning")]},
	4: {name: "Fragile Body", text: "Your STR, DEX or CON score is permanently decreased by 1.", choose: ["str", "dex", "con"], changes: ({ability}) => [abilityAdd(ability, "-1")]},
	5: {name: "Fragile Memory", text: "Your WIS, INT or CHA score is permanently decreased by 1.", choose: ["wis", "int", "cha"], changes: ({ability}) => [abilityAdd(ability, "-1")]},
	6: {name: "Fragile Soul", text: "Reduce all of your Death Saving Throw results by 1.", changes: () => [add("system.attributes.death.bonuses.save", "-1")]},
};

const INNATE_MAGIC_TEXT = "Choose one cantrip and one 1st-level spell from the necromancy school. You know the cantrip and can cast it at will. The 1st-level spell is known to you and you can cast it once per short rest without expending a spell slot. If you cast these spells through this racial ability instead of a class Spellcasting/Pact Magic feature, use your Wisdom score for these spells. (Add the two spells to your sheet manually.)";

/** Archetype-defined results for d10 = 10. */
export const ARCHETYPE_ABILITIES = {
	wight: {name: "Archetype: Wight Vitality", text: "Increase your HP by 1 per total character level.", changes: () => [add("system.attributes.hp.bonuses.level", "1")]},
	skeletal: {name: "Archetype: Skeletal Death Magic", text: `You gain the benefits of the Innate Death Magic result, even if you have already taken it. Your leveled spell can be of level 2 instead. ${INNATE_MAGIC_TEXT}`, changes: () => []},
	spectral: {name: "Archetype: Spectral Drift", text: "After using your Shadowstalker ability, you can retain the vision boost for the next minute. During this time, you gain 10 ft. flying (hover) movement speed. Switching from regular movement types to this one does not require any kind of action, gesture or environment, effectively allowing you to stay stationary above the ground whenever you wish.", changes: () => []},
};

/** Undead Variability Ability Table (d10). Result 6 is the only stackable one. */
export const VARIABILITY = {
	1: {name: "Superior Darkvision", text: "Your Darkvision is upgraded to a range of 120 feet.", changes: () => [upgrade("system.attributes.senses.ranges.darkvision", 120)]},
	2: {name: "Death Defiant", text: "You add +2 to your Death Saving Throw results.", changes: () => [add("system.attributes.death.bonuses.save", "+2")]},
	3: {name: "Piercing Damage Resistant", text: "You are resistant to piercing damage.", changes: () => [add("system.traits.dr.value", "piercing")]},
	4: {name: "Necrotic Damage Resistant", text: "You are resistant to necrotic damage.", changes: () => [add("system.traits.dr.value", "necrotic")]},
	5: {name: "Detachable Limbs", text: "As a reaction to receiving any damage from an attack, you can detach one of your arms to let it take the hit. The limb is destroyed, but the damage is negated from the rest of your character. You can attach any limb of a Humanoid of somewhat-fitting size to replace the lost one. Your body will convert the attached limb throughout your next long rest.", changes: () => []},
	6: {name: "Innate Death Magic", stackable: true, text: INNATE_MAGIC_TEXT, changes: () => []},
	7: {name: "Hardened Skeleton", text: "Your AC is increased by 1 for all AC calculations.", changes: () => [add("system.attributes.ac.bonus", "+1")]},
	8: {name: "Ability Score Improvement", text: "Your racial bonus to Ability Score is increased by 1 (maximum of +2 to a single ability score, all features combined).", choose: ["str", "dex", "con", "int", "wis", "cha"], changes: ({ability}) => [abilityAdd(ability, "+1")]},
	9: {name: "Limited Physiology", text: "Unlike other Necris, you no longer need to eat and drink to survive, nor breathe. Your long rest takes 4 hours only and you can hear your surroundings during that time.", changes: () => []},
	10: {archetypeDefined: true},
};

/** Get "wight" | "skeletal" | "spectral" | null out of a race name like "Necr (Wight)". */
export function archetypeFromName (name) {
	const m = /\(([^)]+)\)/.exec(name || "");
	const a = m?.[1]?.trim().toLowerCase();
	return ARCHETYPES.includes(a) ? a : null;
}

/**
 * Roll on the d10 table, rerolling duplicates (except stackable results) and result 10 when
 * no archetype is known.
 * @param {function(string): Promise<number>} rollFn Rolls the given formula, returns the total.
 * @param {Set<number>|number[]} taken Results already owned by this character.
 * @param {?string} archetype
 * @return {Promise<{result:number, rerolls:number[], entry:object}>}
 */
export async function drawVariability (rollFn, taken, archetype) {
	const owned = new Set(taken);
	const rerolls = [];
	for (let i = 0; i < 200; ++i) {
		const result = await rollFn("1d10");
		const base = VARIABILITY[result];
		const isDupe = owned.has(result) && !base.stackable;
		const isNoArchetype = base.archetypeDefined && !archetype;
		if (isDupe || isNoArchetype) { rerolls.push(result); continue; }
		const entry = base.archetypeDefined ? {...ARCHETYPE_ABILITIES[archetype], n: result} : {...base, n: result};
		return {result, rerolls, entry};
	}
	throw new Error("Could not find a valid Undead Variability result.");
}

export async function drawWeakness (rollFn) {
	const result = await rollFn("1d6");
	return {result, entry: {...WEAKNESSES[result], n: result}};
}

/** Build the Item data (a feature with optional transferring effect) for a roll result. */
export function buildFeatureItem (entry, {kind, ability = null, count = 1, img = "icons/svg/skull.svg"}) {
	const abilityNote = ability ? ` (${ABILITY_NAMES[ability]})` : "";
	const prefix = kind === "weakness" ? "Necran Weakness" : "Necran Variability";
	const name = `${prefix}: ${entry.name}${abilityNote}${count > 1 ? ` x${count}` : ""}`;
	const changes = entry.changes ? entry.changes({ability}) : [];
	return {
		name,
		type: "feat",
		img,
		system: {description: {value: `<p>${entry.text}</p>`}, type: {value: "race"}},
		effects: changes.length
			? [{name, img, transfer: true, disabled: false, system: {changes}, flags: {[MODULE_ID]: {kind}}}]
			: [],
		flags: {[MODULE_ID]: {kind, result: entry.n, ability}},
	};
}
