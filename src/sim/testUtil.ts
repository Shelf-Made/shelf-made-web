import { newGame } from './newGame';
import { quickSetup } from './setup';
import { resetGridCache } from './state';
import type { GameState } from './types';

/** A new game fitted out and open, the way a player would have it after the first five minutes. */
export function openGame(opts: Parameters<typeof newGame>[0]): GameState {
  resetGridCache();
  const s = newGame(opts);
  quickSetup(s);
  return s;
}
