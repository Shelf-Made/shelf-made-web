import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { PEOPLE_MODELS } from '@/render/People';

/** Colours on offer (all from the baked palette, so they show exactly), with names for screen readers. */
const SKINS: [string, string][] = [['#FFD7B0', 'Fair'], ['#F3CCA8', 'Light'], ['#DBAB8E', 'Medium'], ['#C8925A', 'Tan'], ['#A87B45', 'Brown'], ['#6E4630', 'Deep']];
const HAIRS: [string, string][] = [['#222226', 'Black'], ['#6E4630', 'Dark brown'], ['#9C6B47', 'Brown'], ['#C9541C', 'Ginger'], ['#E9C46A', 'Blonde'], ['#D8D8DC', 'Grey'], ['#F27CC1', 'Pink'], ['#3F8DBF', 'Blue']];
const TOPS: [string, string][] = [['#E8573F', 'Red'], ['#FF8C42', 'Orange'], ['#FFC044', 'Yellow'], ['#3FA87A', 'Green'], ['#22A699', 'Teal'], ['#4F8FE0', 'Sky blue'], ['#3570BC', 'Blue'], ['#7E57C2', 'Purple'], ['#F27CC1', 'Pink'], ['#FFFFFF', 'White'], ['#38383D', 'Charcoal'], ['#D9A066', 'Tan']];
const BOTTOMS: [string, string][] = [['#38383D', 'Charcoal'], ['#285795', 'Denim'], ['#5A5A62', 'Grey'], ['#7A4E2E', 'Brown'], ['#24603D', 'Green'], ['#C4C0B8', 'Stone'], ['#FFFFFF', 'White'], ['#962E5C', 'Plum']];
const HEIGHTS: [number, string][] = [[0.95, 'Shorter'], [1.04, 'Average'], [1.1, 'Taller']];

type Part = 'skin' | 'hair' | 'top' | 'bottom';

/** The twelve townsfolk the manager can be: the women on even indexes, the men on odd ones. */
const CHARACTERS = PEOPLE_MODELS.slice(0, 12).map((id, index) => ({ id, index, gender: id.includes('female') ? 'girl' as const : 'guy' as const }));

/**
 * Design your manager, in the lobby: a guy or a girl, one of six characters each, then skin,
 * hair, top and trousers colours and a height. Every click shows at once on the shopkeeper standing
 * in front of the demo shop; the design is kept with your settings and worn in every game you play.
 * "Own" keeps the character's own colour.
 */
export function ManagerDesigner({ runtime, snap, onDone }: { runtime: GameRuntime; snap: Snapshot; onDone: () => void }) {
  void snap.settings;
  const look = runtime.managerLook;
  const gender = look.model % 2 === 0 ? 'girl' : 'guy';
  const thumbs = runtime.renderer?.characterThumbs ?? {};
  const row = (part: Part, title: string, options: [string, string][]) => (
    <>
      <h3>{title}</h3>
      <div className="look-swatches" role="radiogroup" aria-label={title}>
        <button role="radio" aria-checked={!look[part]} className={`own${!look[part] ? ' selected' : ''}`} onClick={() => runtime.designManager({ [part]: null })} title="The character's own">Own</button>
        {options.map(([hex, name]) => (
          <button key={hex} role="radio" aria-checked={look[part] === hex} aria-label={name} title={name} className={look[part] === hex ? 'selected' : ''} style={{ background: hex }} onClick={() => runtime.designManager({ [part]: hex })} />
        ))}
      </div>
    </>
  );
  return (
    <div className="designer" role="group" aria-label="Your manager">
      <h3 className="designer-title">Your manager</h3>
      <p className="muted">Try things on: the shopkeeper out front changes as you click. You wear this look in every shop you run.</p>
      <div className="row gender" role="radiogroup" aria-label="Guy or girl">
        {(['girl', 'guy'] as const).map((g) => (
          <button key={g} role="radio" aria-checked={gender === g} className={`btn ${gender === g ? '' : 'ghost'}`} onClick={() => { if (gender !== g) runtime.designManager({ model: g === 'girl' ? 0 : 1 }); }}>{g === 'girl' ? 'Girl' : 'Guy'}</button>
        ))}
      </div>
      <h3>Character</h3>
      <div className="char-grid" role="radiogroup" aria-label="Character">
        {CHARACTERS.filter((c) => c.gender === gender).map((c, k) => (
          <button key={c.id} role="radio" aria-checked={look.model === c.index} aria-label={`${gender === 'girl' ? 'Girl' : 'Guy'} ${k + 1}`} className={look.model === c.index ? 'selected' : ''} onClick={() => runtime.designManager({ model: c.index })}>
            {thumbs[c.id] ? <img src={thumbs[c.id]} alt="" /> : <span>{k + 1}</span>}
          </button>
        ))}
      </div>
      {row('skin', 'Skin', SKINS)}
      {row('hair', 'Hair', HAIRS)}
      {row('top', 'Top', TOPS)}
      {row('bottom', 'Trousers', BOTTOMS)}
      <h3>Height</h3>
      <div className="row" role="radiogroup" aria-label="Height">
        {HEIGHTS.map(([h, name]) => <button key={h} role="radio" aria-checked={Math.abs(look.height - h) < 0.01} className={`btn small ${Math.abs(look.height - h) < 0.01 ? '' : 'ghost'}`} onClick={() => runtime.designManager({ height: h })}>{name}</button>)}
      </div>
      <button className="btn" style={{ marginTop: 14 }} onClick={onDone}>Done</button>
    </div>
  );
}
