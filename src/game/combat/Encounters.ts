import type { SiteKind } from '../../world/Sites';
import type { EnemyId } from './EnemyTypes';

/**
 * Land encounters: where rival pirates hang about and what kind of fight each place is.
 *
 *   patrol – a small group walking a beat around the site
 *   ambush – nobody in sight until you step into the clearing, then they jump out of cover
 *   camp   – a group guarding their camp / fort / hideout, with a chest to loot
 *   boss   – a powerful captain with minions, guarding a big chest
 *   escort – a castaway asks you to get them safely to your boat; foes waylay you on the way
 */
export type EncKind = 'patrol' | 'ambush' | 'camp' | 'boss' | 'escort';

export interface SiteDef {
  id: string;
  name: string;
  icon: string;
  /** island name (go ashore by rowing) … */
  island?: string;
  /** … or a port id (walk out of town) */
  port?: string;
  site: SiteKind;
  enc: EncKind;
  /** difficulty 1..6 (scales foes and rewards) */
  tier: number;
  foes: EnemyId[];
  boss?: EnemyId;
  /** escort: groups that ambush you on the way back */
  waves?: EnemyId[][];
  /** placement band on an island, as fractions of its radius */
  ring?: [number, number];
  /** port raid: the treasury garrison (only turns out when you raid the port from the sea) */
  raid?: boolean;
  /** days before the site is occupied again after you clear it */
  respawnDays: number;
  blurb: string;
}

export const SITES: SiteDef[] = [
  // ---------------- ports: trouble on the edge of town ----------------
  { id: 'skull-hideout', name: "Rival Crew's Hideout", icon: '⚔️', port: 'skull', site: 'hideout', enc: 'camp', tier: 1, foes: ['grunt', 'grunt', 'gunner'], respawnDays: 2, blurb: 'A rival crew drinks behind the town. They don’t like newcomers.' },
  { id: 'royal-den', name: "Smugglers' Den", icon: '⚔️', port: 'royal', site: 'hideout', enc: 'camp', tier: 2, foes: ['grunt', 'gunner', 'bruiser', 'grunt'], respawnDays: 3, blurb: 'Smugglers stash their contraband outside Port Royal.' },
  { id: 'salt-bandits', name: 'Marsh Bandits', icon: '⚔️', port: 'salt', site: 'ruins', enc: 'patrol', tier: 1, foes: ['grunt', 'grunt', 'grunt'], respawnDays: 2, blurb: 'Bandits prowl the old ruins above the fishing village.' },
  { id: 'gold-thieves', name: "Thieves' Ambush", icon: '⚠️', port: 'gold', site: 'ruins', enc: 'ambush', tier: 3, foes: ['elite', 'grunt', 'grunt', 'gunner'], respawnDays: 3, blurb: 'The Goldhaven thieves’ guild waits for rich captains.' },
  { id: 'lagoon-wreckers', name: "Wreckers' Beach", icon: '⚔️', port: 'lagoon', site: 'beach', enc: 'camp', tier: 3, foes: ['grunt', 'gunner', 'gunner', 'bruiser'], respawnDays: 3, blurb: 'Wreckers lure ships onto the rocks, then loot them.' },
  // ---------------- port raids: treasuries behind stockades (waves[0] meets you at the pier) ----------------
  { id: 'salt-raid', name: 'Saltmarsh Tithe Barn', icon: '💰', port: 'salt', raid: true, site: 'fort', enc: 'camp', tier: 2, foes: ['officer', 'guard', 'guard', 'musketeer'], waves: [['guard', 'guard'], ['guard', 'musketeer']], respawnDays: 5, blurb: 'The village tithes, kept under lock and key.' },
  { id: 'lagoon-raid', name: 'Pearl Vault', icon: '💰', port: 'lagoon', raid: true, site: 'fort', enc: 'camp', tier: 3, foes: ['officer', 'marine', 'guard', 'musketeer', 'guard'], waves: [['guard', 'guard', 'musketeer'], ['marine', 'guard']], respawnDays: 5, blurb: 'Mermaid Lagoon keeps its pearls behind a stockade.' },
  { id: 'royal-raid', name: 'Royal Treasury', icon: '💰', port: 'royal', raid: true, site: 'fort', enc: 'camp', tier: 4, foes: ['officer', 'marine', 'marine', 'musketeer', 'musketeer', 'guard'], waves: [['marine', 'marine', 'musketeer'], ['guard', 'marine', 'musketeer']], respawnDays: 5, blurb: 'The governor’s gold, guarded by marines.' },
  { id: 'gold-raid', name: 'Bullion Vault', icon: '💰', port: 'gold', raid: true, site: 'fort', enc: 'camp', tier: 5, foes: ['officer', 'officer', 'marine', 'musketeer', 'musketeer', 'marine'], waves: [['marine', 'marine', 'musketeer', 'guard'], ['officer', 'marine', 'musketeer']], respawnDays: 5, blurb: 'Goldhaven’s bullion. The richest prize on the sea.' },
  // ---------------- islands: row ashore ----------------
  { id: 'coconut-patrol', name: 'Beachcombers', icon: '⚔️', island: 'Coconut Key', site: 'beach', enc: 'patrol', tier: 1, foes: ['grunt', 'grunt'], ring: [0.45, 0.7], respawnDays: 2, blurb: 'A couple of rough beachcombers.' },
  { id: 'turtle-patrol', name: 'Shoal Lookouts', icon: '⚔️', island: 'Turtle Shoal', site: 'beach', enc: 'patrol', tier: 1, foes: ['grunt', 'gunner'], ring: [0.3, 0.6], respawnDays: 2, blurb: 'Lookouts watching for passing merchants.' },
  { id: 'gull-camp', name: 'Gull Island Camp', icon: '⛺', island: 'Gull Island', site: 'camp', enc: 'camp', tier: 1, foes: ['grunt', 'grunt', 'grunt'], ring: [0.2, 0.55], respawnDays: 3, blurb: 'Castoffs from a mutiny have set up camp.' },
  { id: 'parrot-ambush', name: 'Parrot Isle Ambush', icon: '⚠️', island: 'Parrot Isle', site: 'clearing', enc: 'ambush', tier: 2, foes: ['grunt', 'grunt', 'gunner', 'grunt'], ring: [0.25, 0.55], respawnDays: 3, blurb: 'Something rustles in the jungle…' },
  { id: 'smuggler-camp', name: "Smugglers' Camp", icon: '⛺', island: 'Smuggler Isle', site: 'camp', enc: 'camp', tier: 2, foes: ['grunt', 'grunt', 'gunner', 'bruiser'], ring: [0.2, 0.55], respawnDays: 3, blurb: 'Rum runners guard their stash.' },
  { id: 'mango-escort', name: 'Stranded Cartographer', icon: '🧭', island: 'Mango Isle', site: 'clearing', enc: 'escort', tier: 2, foes: [], waves: [['grunt', 'grunt'], ['gunner', 'grunt', 'grunt']], ring: [0.25, 0.5], respawnDays: 5, blurb: 'A map-maker marooned by pirates needs a lift.' },
  { id: 'crab-camp', name: 'Crab Island Camp', icon: '⛺', island: 'Crab Island', site: 'camp', enc: 'camp', tier: 2, foes: ['grunt', 'gunner', 'grunt', 'grunt'], ring: [0.2, 0.55], respawnDays: 3, blurb: 'Pirates hiding out among the crabs.' },
  { id: 'rum-camp', name: 'Rum Runners', icon: '⛺', island: 'Rumrunner Key', site: 'beach', enc: 'camp', tier: 2, foes: ['grunt', 'gunner', 'grunt'], ring: [0.4, 0.65], respawnDays: 3, blurb: 'Barrels of untaxed rum – and the people who smuggle them.' },
  { id: 'fiddler-patrol', name: 'Fiddler Key Patrol', icon: '⚔️', island: 'Fiddler Key', site: 'beach', enc: 'patrol', tier: 2, foes: ['grunt', 'gunner', 'grunt'], ring: [0.3, 0.6], respawnDays: 2, blurb: 'A patrol from a pirate stronghold.' },
  { id: 'lonely-duel', name: 'The Lonely Duellist', icon: '🤺', island: 'Lonely Palm', site: 'beach', enc: 'camp', tier: 3, foes: ['elite'], ring: [0.3, 0.6], respawnDays: 4, blurb: 'A master swordsman waits under the palm for a worthy opponent.' },
  { id: 'barnacle-fort', name: 'Barnacle Fort', icon: '🏰', island: 'Barnacle Rock', site: 'fort', enc: 'camp', tier: 3, foes: ['elite', 'bruiser', 'gunner', 'gunner', 'grunt'], ring: [0.15, 0.45], respawnDays: 4, blurb: 'An old fort taken over by a corsair band.' },
  { id: 'shipwreck-camp', name: "Wreckers' Camp", icon: '⛺', island: 'Shipwreck Bay', site: 'camp', enc: 'camp', tier: 3, foes: ['bruiser', 'bruiser', 'grunt', 'gunner'], ring: [0.2, 0.55], respawnDays: 3, blurb: 'Big wreckers with bigger axes.' },
  { id: 'bones-ambush', name: 'Bones Atoll Ambush', icon: '⚠️', island: 'Bones Atoll', site: 'ruins', enc: 'ambush', tier: 3, foes: ['grunt', 'grunt', 'elite', 'gunner'], ring: [0.2, 0.5], respawnDays: 3, blurb: 'Old ruins, fresh footprints.' },
  { id: 'ember-boss', name: "Cinderbeard's Lair", icon: '🔥', island: 'Ember Peak', site: 'cave', enc: 'boss', tier: 4, boss: 'cinder', foes: ['grunt', 'gunner'], ring: [0.35, 0.6], respawnDays: 7, blurb: 'A volcanic grotto where Captain Cinderbeard hoards his gold.' },
  { id: 'cutlass-boss', name: "Iron Meg's Stronghold", icon: '💀', island: 'Cutlass Isle', site: 'fort', enc: 'boss', tier: 5, boss: 'ironMeg', foes: ['gunner', 'grunt', 'grunt'], ring: [0.15, 0.45], respawnDays: 7, blurb: 'A disgraced admiral rules this fort with sword and six-gun.' },
];

export const siteById = (id: string) => SITES.find((s) => s.id === id);
