// Latin subsets only (all game text is English) – keeps ~28 unused font files out of the build
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import './style.css';
import './land.css';
import './ui/combat.css';
import { Game } from './game/Game';
const params = new URLSearchParams(location.search);
const viewer = params.get('viewer');
if (viewer) {
  // dev-only model viewers: /?viewer=chars or /?viewer=ships
  import('./dev/viewer').then((m) => (viewer === 'ships' ? m.runShipViewer() : m.runViewer(viewer)));
} else {
  const game = new Game();
  (window as unknown as { game: Game }).game = game;
  game.init().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;z-index:99;color:#fff;background:#300;padding:20px;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
  });
}
