import {
	MODULE_ID, SOURCE, ESSENCE_FEAT, ABILITY_NAMES,
	archetypeFromName, drawVariability, drawWeakness, buildFeatureItem,
} from "./logic.mjs";

const START_UVP = 3;

/* -------------------------------------------- */
/* Foundry glue                                 */
/* -------------------------------------------- */

async function rollTotal (actor, formula, flavor) {
	const roll = new Roll(formula);
	await roll.evaluate();
	await roll.toMessage({speaker: ChatMessage.getSpeaker({actor}), flavor});
	return roll.total;
}

function getState (actor) {
	return foundry.utils.deepClone(actor.getFlag(MODULE_ID, "state") ?? {uvp: 0, weaknessAvailable: false});
}
const setState = (actor, state) => actor.setFlag(MODULE_ID, "state", state);

function getOwnedVariability (actor) {
	return actor.items
		.filter(it => it.getFlag(MODULE_ID, "kind") === "variability")
		.map(it => it.getFlag(MODULE_ID, "result"));
}

function getArchetype (actor) {
	const race = actor.items.find(it => it.type === "race" && /^Necr\b/.test(it.name));
	return archetypeFromName(race?.name) ?? actor.getFlag(MODULE_ID, "archetype") ?? null;
}

const DialogV2 = () => foundry.applications.api.DialogV2;

async function askAbility (title, options) {
	const picked = await DialogV2().wait({
		window: {title},
		content: `<p>Choose the ability score that is affected:</p>`,
		buttons: options.map((ab, i) => ({action: ab, label: ABILITY_NAMES[ab], default: i === 0})),
		rejectClose: false,
	});
	return options.includes(picked) ? picked : options[0];
}

async function applyEntry (actor, entry, kind) {
	let ability = null;
	if (entry.choose) ability = await askAbility(entry.name, entry.choose);

	let count = 1;
	if (entry.stackable) count = actor.items.filter(it => it.getFlag(MODULE_ID, "kind") === "variability" && it.getFlag(MODULE_ID, "result") === entry.n).length + 1;

	const itemData = buildFeatureItem(entry, {kind, ability, count});
	await actor.createEmbeddedDocuments("Item", [itemData]);
	return itemData.name;
}

/**
 * Run the Undead Variability step for an actor.
 * @param actor
 * @param {object} [opts]
 * @param {number} [opts.grant] UVP to add before starting (3 for a fresh Necr, 1 for the Essence feat, 0 to resume).
 */
async function runVariabilityStep (actor, {grant = 0} = {}) {
	const state = getState(actor);
	if (grant) {
		state.uvp += grant;
		state.weaknessAvailable = true; // once per creation process / once more per Essence feat
	}
	await setState(actor, state);

	const log = [];

	while (state.uvp > 0 || state.weaknessAvailable) {
		const buttons = [];
		if (state.uvp > 0) buttons.push({action: "variability", label: "Roll Variability d10 (1 UVP)", default: true});
		if (state.weaknessAvailable) buttons.push({action: "weakness", label: "Roll Weakness d6 (+1 UVP)", default: state.uvp === 0});
		buttons.push({action: "done", label: state.uvp > 0 ? "Stop for now" : "Finish"});

		const action = await DialogV2().wait({
			window: {title: `Undead Variability - ${actor.name}`},
			content: `<p><strong>UVP remaining: ${state.uvp}</strong></p>
				<p>Each Variability roll costs 1 UVP. The Weakness roll is optional, can be used once, and grants 1 extra UVP.</p>`,
			buttons,
			rejectClose: false,
		});

		if (action === "variability" && state.uvp > 0) {
			const {entry, rerolls} = await drawVariability(
				(formula) => rollTotal(actor, formula, "Undead Variability Ability Table"),
				getOwnedVariability(actor),
				getArchetype(actor),
			);
			state.uvp -= 1;
			const name = await applyEntry(actor, entry, "variability");
			log.push(`${name}${rerolls.length ? ` (rerolled: ${rerolls.join(", ")})` : ""}`);
		} else if (action === "weakness" && state.weaknessAvailable) {
			const {entry} = await drawWeakness((formula) => rollTotal(actor, formula, "Undead Weakness Table"));
			state.weaknessAvailable = false;
			state.uvp += 1;
			const name = await applyEntry(actor, entry, "weakness");
			log.push(`${name} (+1 UVP)`);
		} else {
			break;
		}
		await setState(actor, state);
	}

	await setState(actor, state);

	if (log.length) {
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({actor}),
			content: `<h3>Undead Variability</h3><ul>${log.map(l => `<li>${l}</li>`).join("")}</ul>${state.uvp > 0 ? `<p><em>${state.uvp} UVP unspent.</em></p>` : ""}`,
		});
	}
}

/* -------------------------------------------- */
/* Plutonium hook                               */
/* -------------------------------------------- */

async function onImportComplete (summary) {
	try {
		const imported = summary?.imported?.[0];
		const actor = imported?.actor;
		if (!actor || summary.isFailed?.()) return;

		const name = summary.entity?.name ?? imported?.name ?? imported?.embeddedDocument?.name ?? "";
		const source = summary.entity?.source;
		const isNecrRace = (source === SOURCE || source == null) && /^Necr( \(|$)/.test(name);
		const isEssenceFeat = (source === SOURCE || source == null) && name === ESSENCE_FEAT;

		if (isNecrRace) {
			// Only auto-run once per actor; use the API to resume or re-run
			if (actor.getFlag(MODULE_ID, "raceStepStarted")) return;
			await actor.setFlag(MODULE_ID, "raceStepStarted", true);
			await actor.setFlag(MODULE_ID, "archetype", archetypeFromName(name));
			await runVariabilityStep(actor, {grant: START_UVP});
		} else if (isEssenceFeat) {
			await runVariabilityStep(actor, {grant: 1});
		}
	} catch (e) {
		console.error(`${MODULE_ID} | Undead Variability step failed`, e);
		ui.notifications.error("Necris roll step failed; see console (F12).");
	}
}

Hooks.once("ready", () => {
	const on = game.plutonium?.hooks?.on
		? (fn) => game.plutonium.hooks.on("importComplete", fn)
		: (fn) => Hooks.on("srd5e.importComplete", fn);
	on(onImportComplete);

	game.modules.get(MODULE_ID).api = {
		/** Resume (or re-run with a fresh grant) the step: api.start(actor) / api.start(actor, {grant: 3}) */
		start: (actor, opts) => runVariabilityStep(actor, opts),
	};
	console.log(`${MODULE_ID} | ready`);
});
