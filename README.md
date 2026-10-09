# 🏴‍☠️ Pirate Raiders

A stylised 3D arcade pirate game for the browser, built with **Three.js + TypeScript + Vite**.

Sail a cartoon pirate sloop around a large ocean, hunt merchant ships and board them. Then dock at a port, **walk ashore** and explore a living 3D town on foot, or row onto wild islands and **fight rival pirates sword-to-sword**. Buy cheap goods at market stalls, sell them for a profit in another port, upgrade your ship at the shipwright, recruit officers in the tavern and take contracts from the mission board.

Every model, texture, animation, sound effect and the music are generated procedurally in code. The project has no asset files.

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

To make a production build, run `npm run build`. It typechecks the code and writes the game to `dist/`. Use `npm run preview` to serve that build.

## Controls

| At sea | | On land | |
| --- | --- | --- | --- |
| **W / S** | Sail / slow down | **W A S D** | Walk (relative to the camera) |
| **A / D** | Turn | **SHIFT** | Run |
| **SPACE** | Fire cannons | **SPACE** | Jump |
| **Q** | Switch ammunition | **E** | Talk · shop · board your ship |
| **SHIFT** | Speed boost | **Mouse drag / wheel** | Look around / zoom |
| **E** | Board a surrendered ship · dock at a port · dig treasure | **M** | Town map |
| **M** | World map | **TAB** (or **I**) | Inventory |
| **Esc** | Pause | **Esc** | Leave a shop · pause |

When you're moored at a berth, **E** goes ashore and **W** sets sail. Near an island without a port, **E** rows you ashore.

**Fighting on foot**

| Key | Action |
| --- | --- |
| **Left click** | Attack (tap three times for a combo; the third hit is a big finisher) |
| **Hold left click** | Charge a heavy attack, release to strike |
| **Right click** | Block with a blade (raise it just as a blow lands to **parry**) · aim with a gun |
| **SPACE** | Dodge-roll (briefly invulnerable) |
| **SHIFT** | Sprint (uses stamina) |
| **TAB** or **Q** | Lock on to the nearest foe · press again to switch target |
| **1 / 2** (or **F**) | Blade / gun |
| **R** | Reload |
| **X** | Draw / put away your weapon |
| **G** | Equip a weapon you just picked up |

While you're fighting, the camera stays behind the captain: he always faces where it looks, **A / D** strafe, **S** backs off, and the mouse turns him. A click captures the mouse so moving it turns the camera. It's released when the fight ends or a menu opens (or press **Esc**). During a fight **TAB** is lock-on, so use **I** for the inventory.

## The loop

1. You start **on foot at Skull Cove**, the pirate port. A short tutorial walks you round the town.
2. **Buy cheap goods** at a market stall. Skull Cove's pepper and cinnamon are cheap, and Port Royal pays double for them.
3. Visit the **shipwright** to upgrade your ship, the **gunsmith** for cannons and ammo, and the **tavern** to recruit officers and take a contract from the mission board.
4. Walk back down the pier and press **E** at the gangplank to board your ship, then sail out.
5. On the way, hunt merchant ships: fire until they surrender, then board them for their cargo and gold.
6. **Dock at another port** (sail close to its berth and press **E**), disembark, find the right stall and **sell high**.
7. Spend the profit on upgrades and better gear, then trade, explore and plunder further afield.
8. Level up and **buy bigger ships**: from the starter dhow to a schooner, brigantine, galleon, paddle-steamer, ironclad and finally a fictional modern super-ship.

Attacking ships raises your **Wanted level** (★1 to ★5) and the navy hunts you. Lawful ports (Port Royal, Goldhaven) won't let you dock at ★2 or above. Docking anywhere clears your wanted level.

- **The navy is slow to notice you.** Quick raids on merchants add only a little heat. A merchant's distress flare takes about 20 seconds to reach the navy. Patrols need a few seconds with you in sight before they give chase. The first pursuer takes a while to arrive.
- **Long firefights are always heard.** After 25 seconds of gunfire you get a warning. At 40 seconds you're at least ★1, and at 80 seconds at least ★2.
- **You can't be fired upon while boarding a ship or docked in a port.** Enemy ships hold fire, and cannonballs already in the air splash harmlessly.
- All the tuning lives in `DETECTION` in `src/game/Wanted.ts`.

## Land combat

Real-time, third-person fights inside the 3D world. There's no separate battle screen: you walk up, draw, and fight.

**Where to fight**
- **Ports.** Each port has trouble on the edge of town: a rival crew's hideout in Skull Cove, smugglers outside Port Royal, bandits in the Saltmarsh ruins, a thieves' ambush in Goldhaven and wreckers on Mermaid Lagoon's far beach. Townsfolk run off when a fight breaks out nearby.
- **Islands.** Sail close to any island without a port and press **E** to row ashore with up to three of your crew (one per four deckhands). Your ship rides at anchor and can't be attacked while you're away. Press **E** at the rowboat to row back.
- **15 island sites**, shown on the world map with their difficulty in skulls: beach patrols, jungle ambushes, pirate camps, two forts, an escort mission and two bosses.

**Encounter types**
- **Patrol:** a small group walking a beat.
- **Ambush:** nobody in sight until you step into the clearing, then they leap out of cover around you.
- **Camp / fort:** a group guarding their base, sitting by the fire or standing watch. Clear it to open its chest.
- **Boss:** **Captain Cinderbeard** in a volcano cave on Ember Peak, and **Admiral Iron Meg** in her fort on Cutlass Isle. Bosses have three phases: they call reinforcements, then get enraged and add whirlwind spins and charges.
- **Escort:** a marooned cartographer on Mango Isle asks you to get him to your boat. Pirates waylay you on the way, and he pays with gold and a treasure map.

Cleared sites fill up again after a few days. Difficulty rises a little as you level up.

**Fighting**
- **Health and stamina.** Your health grows with your level. Swings, blocks, rolls and sprinting use stamina.
- **Blocking** cuts damage sharply. Heavy blows still get partly through, and running out of stamina breaks your guard. A well-timed block **parries** and staggers the attacker.
- **Poise.** Light hits only make you flinch. Enough damage in a burst staggers you, and heavy blows knock you down.
- **Enemies:** **grunts**; **bruisers** (heavy axe swings and shoulder charges); **gunners** (keep their distance and shoot from behind the melee line); **elite corsairs** (fast combos, they block your swings, roll away from your big hits and counter-attack).
- **Pacing.** Only one or two foes attack at a time and their strikes are spaced out. The others circle, reposition and route round obstacles. A red **!** shows an enemy winding up.
- **Your crew** follow you ashore and pile into fights. If they're knocked out they get back up when the fight is over.
- **Feel.** Hit sparks, swing trails, a brief freeze on heavy hits, screen shake, knockback, dust and damage numbers. It stays cartoony: defeated foes see stars and vanish in a puff of smoke.

**Weapons**

| Weapon | Unlocks | Style |
| --- | --- | --- |
| 🗡️ Cutlass | Level 1 | Fast, short reach |
| ⚔️ Broadsword | Level 3 | Balanced |
| 🪓 Heavy Axe | Level 6 | Slow, huge hits and knockback |
| 🤺 Rapier | Level 10 | Lightning thrusts, long reach, frequent criticals |
| ⚓ Ship's Anchor | Level 20 | Enormous sweeping blows |
| 🔫 Flintlock Pistol | Level 1 | One big shot, slow reload |
| 💥 Blunderbuss | Level 12 | Spread of pellets, devastating up close |
| 🤠 Six-Shot Revolver | Level 30 | Six shots per reload |

- Weapons come in five rarities: **Common, Uncommon, Rare, Epic, Legendary**. Better ones hit harder, swing faster and may carry a special effect: Second Wind (heal on hit), Thunderclap (finisher shockwave), Gilded (more gold), Swift, Crushing (guard-breaking), Embers (sets foes alight), Piercing shots or Quickload. Legendaries have their own names.
- The **gunsmith** sells common and uncommon weapons and pistol shot, and its **Forge** upgrades weapons (+1 to +5) with money and **iron scrap**.
- Rare, epic and legendary arms only drop from foes and chests. Beating a boss for the first time guarantees a legendary.
- The inventory's **Arms** tab shows what you carry and your armoury: equip anything, or break spares down into scrap.

**Loot.** Defeated foes drop gold, pistol shot, iron scrap, healing rum, cargo (sent to your ship's hold) and occasionally weapons or treasure maps. Walk over it to pick it up.

**Defeat.** If you're knocked out, choose **Retry** (the fight starts over, nothing lost) or **Return to Port** (a doctor's fee of 10% of your money). Your ship, cargo, weapons and level are never touched.

All the tuning lives in `src/game/combat/`: `Weapons.ts`, `EnemyTypes.ts`, `Moves.ts` (attack timings) and `Encounters.ts` (where every site is).

## Ports

Every port is a fully explorable town with docks, boats, stalls, a tavern with an interior, houses, alleys, props, townsfolk and animals.

| Port | Type | Highlights |
| --- | --- | --- |
| **Skull Cove** | Pirate port | Cheap spices, metal, rope and rum · black market hidden behind the Salty Skull · fair shipwright prices |
| **Port Royal** | Merchant port | Six market stalls round a fountain · cheap cloth and grain · guards · black market that only opens at night |
| **Saltmarsh** | Fishing village | Very cheap fish and meat · nets, drying racks and fishermen · basic upgrades only |
| **Goldhaven** | Rich port | Cheap jewellery and gold objects · marble boulevard, golden statue, fancy stalls · expensive upgrades |
| **Mermaid Lagoon** | Remote island | Cheap spices and fruit · tiki huts, torches and a campfire · a hermit selling unique items |

## Trading

- Each port has its own prices for 19 goods. **Food**: fish, fruit, meat, grain. **Spices**: pepper, cinnamon, exotic. **Textiles**: cloth, silk, clothing. **Materials**: wood, metal, rope. **Luxury**: jewellery, gold objects, rare curios. **Contraband**: rum, mermaid pearls, kraken ink.
- Stalls show the price per crate, the average across all ports, and the best price elsewhere (your potential profit). When selling, they show what you paid and your profit per crate.
- Prices drift over time, and every crate you buy or sell nudges the local price.
- Each stall sells its own kind of goods. The **general trader** stocks a changing mix and buys almost anything, at a lower rate.
- **Warehouses** let you store cargo in each port separately.
- Cargo is limited by your hold size (upgrade it at the shipwright).

## Ship classes

Your player level (from captures, contracts, treasure and trading profit) unlocks seven ship classes. Each has its own 3D model and stats.

| Class | Ship | Unlocks at | Price | Health | Speed | Cargo | Crew | Guns | Boarding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I | ⛵ Starter Dhow | Level 1 | starter | 100 | 21 kn | 24 | 6 | 2 a side + 2 bow | ×1.0 |
| II | 🚤 Fast Schooner | Level 5 | $5,500 | 170 | 25.5 kn | 40 | 12 | 3 a side + 1 bow | ×1.15 |
| III | 🛳️ Brigantine | Level 10 | $16,000 | 320 | 26.5 kn | 64 | 20 | 4 a side + 2 bow | ×1.3 |
| IV | 🏰 Galleon | Level 20 | $45,000 | 620 | 25 kn | 110 | 36 | 6 a side + 2 bow | ×1.6 |
| V | 🚂 Steam Corvette | Level 30 | $95,000 | 850 | 31 kn | 140 | 50 | 5 a side + 2 bow | ×1.8 |
| VI | 🛡️ Armoured Steamship | Level 40 | $200,000 | 1,300 | 33 kn | 180 | 66 | 5 a side + 1 bow | ×2.1 |
| VII | 🚀 Advanced Modern Ship | Level 50 | $380,000 | 1,850 | 36 kn | 240 | 85 | 2 twin turrets | ×2.5 |

- The **Ship** tab in the inventory (**TAB**) shows your current ship, the next class, what it costs and how far off it is. Locked classes say "🔒 Reach Level N to unlock".
- At any **shipyard**, the **SHIPS** tab lets you browse every class in a 3D preview you can drag to rotate. It shows health, speed, cargo, crew, cannon power and boarding strength, compared with your current ship.
- Buying a ship makes it your active ship straight away, and it appears at the dock. Your old ship stays in your **fleet**: switch back for free at any shipyard, or sell it. The sale price includes 30% of what you spent on its refits.
- **Upgrades** belong to each ship and add a percentage to the class's base stats. They cost more on bigger classes. On steamships "Sails" becomes "Engines" and "Hull" becomes "Armour". Cannon level 3 adds a gun on each broadside.
- **The world modernises as you level up.** Steam freighters join the trade lanes from level 25. Navy ironclads appear from level 32 and fast navy interceptors from level 45.
- All the numbers live in `src/game/ShipClasses.ts`, including level requirements, prices and stats. The XP curve is `XP_CURVE` in `src/game/Data.ts`.

## Boarding

Boarding is a tug-of-war over a **capture bar**:

- **Power** is √crew × your ship's boarding strength × boarder-officer bonuses, against √crew × how hard their ship is to take. Ships range from small merchant ×0.8 (easy) to navy interceptor ×2.8 (extremely hard). The square root means each extra pirate helps less than the last.
- The bar fills at a speed set by the power advantage. That speed has a floor (an even fight still moves) and a **hard cap**, so even 1,000 pirates against 20 need about 5 seconds.
- A stronger enemy **pushes the bar back** and costs you pirates. You fail if the bar drops to zero.
- Hitting **SPACE** in the green zone gives your crew a burst of momentum, and gold is a PERFECT. Misses give it to them.
- The panel shows both crews, both power bars, the animated capture bar and who has the advantage.

All the tuning lives in `src/game/BoardingBalance.ts`.

## In town

- **Market stalls** (food, spice, textile, materials, luxury, general trader). Walk up and press **E**; the vendor greets you and the shop opens beside them.
- **Shipwright**: buy, switch and sell ship classes; hull, sails, cannons, steering, cargo hold and crew quarters upgrades with a live 3D preview of your ship; repairs; paint, sail colours and flags.
- **Gunsmith**: cannon models and longer barrels, five ammo types (round, chain, grape, fire, heavy) and cannon skins. Every item lists damage, range, reload and a description. The **Hand Weapons** and **Forge** tabs sell blades, guns and pistol shot, and upgrade your weapons.
- **Tavern**:
  - The bartender hires deckhands, rents a room (skip to morning or evening) and sells rounds (rumours and trade tips).
  - **Recruits** sit around the room. Each has a name, role (gunner, navigator, engineer, boarder, trader), skill level, cost and special ability.
  - The **mission board** offers delivery, sealed-cargo, capture, treasure-map, rival-pirate and exploration contracts.
- **Black markets** have to be found first. They sell rare goods and special items: dragon cannons, storm-silk sails, ghost paint, treasure maps, grappling hooks, cursed cutlasses and more.
- **Townsfolk** follow daily schedules:
  - By day, vendors run the stalls, workers carry crates and fishermen fish off the jetties, while guards patrol and gossips chat.
  - In the evening the tavern fills up with drinkers, a fiddler and dancers.
  - At night the lanterns glow and some stalls close.
  - Talk to anyone for jokes and hints.

## Features

- **Ocean.** Gerstner-wave water with matching CPU buoyancy, sky and planar reflections, foam, shallow lagoons and boat wakes.
- **World.** About 3 km × 3 km with 24 islands, five explorable ports, a volcano, sea stacks and hidden treasure isles.
- **Environment.** A day/night cycle and dynamic weather: clear, cloudy, rain, storms with lightning, and fog.
- **On foot.** A third-person controller: walk, run, jump, step onto decks and ramps, and collide with buildings, stalls, trees and people. Building interiors use cut-away walls and roofs. The camera frames conversations over your shoulder.
- **Characters.** Cartoon characters built as single skinned meshes, with about 45 procedural animations: everyday ones (walk, run, jump, talk, fish, hammer, drink, dance, sweep) and combat ones (guard, sprint, three combo slashes, thrust, charge, heavy, block, roll, stagger, knockdown, defeat, aim, shoot, reload, whirlwind and charge). The legs keep walking while the upper body swings. There are 30+ character types and their faces change expression.
- **Ships.** Seven player ship classes, each its own procedural model:
  - sail ships use square, gaff and jib rigs, raked masts and a lower gun deck;
  - steamships add smokestacks, animated paddle wheels and an armoured casemate;
  - the modern ship has rotating gun turrets, a radar mast and a helipad.

  There are also eleven NPC designs, including steam freighters, navy ironclads and interceptors. Your upgrades and cosmetics change your ship's model.
- **Sea combat.** Ballistic cannonballs, five ammo types with special effects, turrets that swing to the firing side, tug-of-war boarding, and officer and item bonuses.
- **Land combat.** Real-time sword-and-pistol fights in ports and on islands: combos, blocks, parries, rolls, lock-on, enemy group tactics, bosses, loot and weapon rarities (see above).
- **Progression.** Story goals, board contracts, XP and levels, seven ship classes and a fleet, wanted levels, upgrades, officers, special items and autosave (to `localStorage`).
- **Audio.** Procedural Web Audio: ambience, footsteps, voices and an original sea shanty that changes at sea, in port, in combat and in the tavern.
- **Rendering.** Bloom, colour grading, MSAA or FXAA, and soft shadows that sharpen while you're on foot.

## Graphics quality

The game picks **Medium** automatically on integrated GPUs and **High** on dedicated ones. If the frame rate drops early on, it steps down one level by itself. You can change it any time in the pause menu (**Esc**).

| Preset | What it does |
| --- | --- |
| High | Planar water reflections, 4× MSAA, bloom, 2048 px shadows |
| Medium | FXAA, bloom, 1024 px shadows, no planar reflections |
| Low | Lower resolution, FXAA, no bloom |

**How the game stays fast:**
- **Distant scenery is lighter.** Islands switch to simple low-detail vegetation beyond about 280 m. Building interiors are only drawn when you're on foot nearby, and town signs are hidden on far-away towns.
- **Characters cost nothing when you can't see them.** Far-away crews and townsfolk are detached from the scene, and the seagull flock is drawn instanced.
- **Static scenery is cheaper to update.** Island and town matrices are computed once at load instead of every frame.
- **Common checks take shortcuts.** Ships far from land use a baked distance grid, and distant ships and wakes use a cheaper wave sample.
- **No memory build-up.** Particles are pooled, and ship models free their GPU memory when replaced.
- **Fights stay cheap.** Combat effects are compiled during loading, weapon models are shared, far-away foes think less often, enemies only path-find when the straight line is blocked, and encounter sites are hidden beyond 260 m.

## Project structure

```
src/
  main.ts               entry point (fonts, styles, boot)
  style.css, land.css   HUD, menus, shops, inventory
  core/                 maths helpers, input, procedural audio engine
  render/               geometry builder, materials, camera rig (sea, walk, cinematic), post-processing
  world/                world data, ocean, sky/weather, islands (+ terrain sampler)
    Town.ts             town builder: colliders, decks, cut-away interiors, NPC spots, nav grid
    TownKit.ts          stalls, furniture, shipyard, boats, nets, fountains, signs…
    TownPlans.ts        the five port layouts, residents, schedules and dialogue
    LandArea.ts         walkable surfaces + collision for people on foot
  models/               procedural characters (+ animation), ships, props, flags
  entities/             Ship base class, PlayerShip, AIShip (merchants, navy, rival pirates)
  systems/              particles, cannonballs, wakes, seagulls
  game/                 Game (states & glue), economy, contracts, town life (NPCs + animals),
                        walker (on-foot controller), boarding, missions, wanted level, data
    combat/             land combat: Combat (glue), Fighter, Moves, Enemy (+ crew AI), Nav (A*),
                        EnemyTypes, Weapons, Encounters, Loot, Trails
  world/Sites.ts        camps, forts, caves, hideouts and ruins for encounter sites
  ui/                   HUD, combat HUD, minimap + town maps, shops, inventory, screens
  dev/                  model viewers and scripted test scenarios (dev only)
```

## Dev tools

- `/?viewer=chars`: the character line-up. Add `&spec=captain&anim=dance&expr=happy` to look at one character.
- `/?viewer=ships`: every NPC ship design on the water. Add `&set=classes` to see the seven player classes side by side, or `&set=npc` for the steam and modern NPC ships.
- `/?autoplay=1&scenario=…`: scripted scenarios used for testing.
  - On land: `land`, `tutorial`, `market`, `shipwright`, `gunsmith`, `gunsmith:royal`, `tavern`, `tavern:night`, `board`, `recruit`, `warehouse`, `black`, `talk`, `night`, `townmap`, `inventory`, `trade`, `hop`, `port:royal|salt|gold|lagoon`.
  - At sea: `sail`, `combat`, `capture`, `storm`, `wanted`, `rival`, `sink`, `upgraded`, `map`, `bot`.
  - Ship classes: `ship:<class>[:side|close[:fire]]`, `dock:<class>:<port>`, `shipyard:<class>`, `buyship:<class>[:look]`, `progress`. Class ids are `dhow`, `schooner`, `brigantine`, `galleon`, `steamCorvette`, `ironclad` and `modern`.
  - Boarding balance: `boardtest:<crew>:<enemyCrew>`. A bot plays the timing game and logs to `window.boardLog`.
  - World edge: `treasure:<0-3>` sails out to a hidden treasure island and logs whether you can dig, to `window.treasureLog`.
  - Navy: `firefight` simulates a long exchange of fire and logs the wanted level to `window.fightLog`. `protect:board|dock|sea` drops navy shots on you while boarding, docked or sailing, and logs to `window.protectLog`.
  - Land combat:
    - `fight:<foe,foe…>[:<port>[:<tier>]]` spawns foes around you in town (`grunt`, `bruiser`, `gunner`, `elite`, `cinder`, `ironMeg`).
    - `fightbot:<foes>[:<tier>]` and `gunbot:<foes>[:<tier>]`: a bot fights with the blade or the pistol and logs to `window.botLog`.
    - `site:<siteId>[:<distance>]` takes you to an encounter site (ids are in `src/game/combat/Encounters.ts`). `sitebot:<siteId>:<level>:<weapon>:<rarity>` has a levelled-up bot clear it.
    - `ashore:<island name>` rows onto an island. `arms:<weapon>:<rarity>` gives you a weapon and opens the Arms tab.
    - `poses:<prop>:<states>:<k>[:<turn>]` freezes characters in combat poses for checking animations.
- `/?debug`: turns on WebGL shader error checking.
