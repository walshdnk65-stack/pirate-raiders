/**
 * Player preferences (saved in this browser, separate from the game save so a new game keeps them).
 * Graphics quality has its own key (see Game.applyQuality); everything else lives here.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BoardingStyle = 'fight' | 'quick';

/** Rebindable actions. The id is the key's default code, which the rest of the game listens for. */
export const ACTIONS: { code: string; label: string; group: 'Move' | 'Sea' | 'Land' | 'Menus' }[] = [
  { code: 'KeyW', label: 'Forward / sail', group: 'Move' },
  { code: 'KeyS', label: 'Back / slow down', group: 'Move' },
  { code: 'KeyA', label: 'Left', group: 'Move' },
  { code: 'KeyD', label: 'Right', group: 'Move' },
  { code: 'ShiftLeft', label: 'Run · sprint · speed boost', group: 'Move' },
  { code: 'Space', label: 'Fire cannons · jump · dodge-roll', group: 'Move' },
  { code: 'KeyE', label: 'Interact · board · dock', group: 'Move' },
  { code: 'KeyQ', label: 'Switch ammo · lock on', group: 'Sea' },
  { code: 'KeyR', label: 'Reload · raid a port', group: 'Sea' },
  { code: 'KeyX', label: 'Draw / put away weapon', group: 'Land' },
  { code: 'Digit1', label: 'Blade', group: 'Land' },
  { code: 'Digit2', label: 'Gun', group: 'Land' },
  { code: 'KeyF', label: 'Swap blade / gun', group: 'Land' },
  { code: 'KeyG', label: 'Equip picked-up weapon', group: 'Land' },
  { code: 'KeyM', label: 'Map', group: 'Menus' },
  { code: 'KeyI', label: 'Inventory', group: 'Menus' },
];

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  /** mouse look speed multiplier (0.3 .. 2.5) */
  mouseSens: number;
  invertY: boolean;
  /** screen shake multiplier (0 = off) */
  shake: number;
  damageNumbers: boolean;
  difficulty: Difficulty;
  boarding: BoardingStyle;
  /** default code → the key the player pressed instead */
  keys: Record<string, string>;
}

const KEY = 'pirate-raiders-settings';

const DEFAULTS: Settings = {
  master: 0.8,
  music: 0.55,
  sfx: 0.9,
  mouseSens: 1,
  invertY: false,
  shake: 1,
  damageNumbers: true,
  difficulty: 'normal',
  boarding: 'fight',
  keys: {},
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULTS, ...s, keys: { ...(s.keys ?? {}) } };
    }
  } catch {
    /* private window or blocked storage: defaults */
  }
  return { ...DEFAULTS, keys: {} };
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function resetSettings() {
  const q = { ...DEFAULTS, keys: {} };
  Object.assign(settings, q);
  saveSettings();
}

/** Damage you take (on land and at sea) and how tough foes are, per difficulty. */
export function difficultyMul() {
  const d = settings.difficulty;
  return {
    taken: d === 'easy' ? 0.65 : d === 'hard' ? 1.3 : 1,
    foeHp: d === 'easy' ? 0.85 : d === 'hard' ? 1.2 : 1,
  };
}

/** The key currently bound to an action (by its default code). */
export function boundKey(code: string) {
  return settings.keys[code] ?? code;
}

/** Short label for a key code ('KeyE' → 'E', 'ShiftLeft' → 'SHIFT'). */
export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'SHIFT';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'CTRL';
  if (code === 'AltLeft' || code === 'AltRight') return 'ALT';
  if (code === 'Space') return 'SPACE';
  return code.replace(/(Left|Right)$/, '').toUpperCase();
}

/** default label → action code, for rewriting key hints in prompts and toasts */
const BY_LABEL = new Map(ACTIONS.map((a) => [keyLabel(a.code), a.code]));

/**
 * Rewrite key names inside <kbd>/<b> tags (e.g. "<kbd>E</kbd>", "<b>TAB/Q</b>") to whatever the
 * player has bound those actions to.
 */
export function rekey(html: string) {
  if (!Object.keys(settings.keys).length) return html;
  return html.replace(/<(kbd|b)>([^<]{1,24})<\/\1>/g, (m, tag: string, inner: string) => {
    // bold text is only a key hint when it's nothing but key names ("E", "TAB/Q", "W / S")
    if (tag === 'b' && !/^[A-Z0-9]+( ?\/ ?[A-Z0-9]+)*$/.test(inner)) return m;
    const out = inner.replace(/[A-Z0-9]+/g, (w) => {
      const code = BY_LABEL.get(w);
      return code && settings.keys[code] ? keyLabel(settings.keys[code]) : w;
    });
    return out === inner ? m : `<${tag}>${out}</${tag}>`;
  });
}
