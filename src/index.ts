import './localization';
import { LunchdayApp } from './lunchdayApp';
import options from './options';
import { Roulette } from './roulette';

const roulette = new Roulette({
  enableKeywordSprites: false,
  showUiOverlays: false,
});

(window as any).roulette = roulette;
(window as any).options = options;

const app = new LunchdayApp(roulette);
app.init();
