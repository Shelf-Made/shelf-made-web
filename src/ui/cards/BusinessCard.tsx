import { useMemo, useState, type JSX } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { looksOf, rating, type Review, type ReviewPhoto, type Topic, type Looks } from '@/sim/reviews';
import { PLOTS, DAY_SECONDS } from '@/sim/layout';
import { dayCurve } from '@/sim/tick';
import { PEOPLE_MODELS } from '@/render/People';

/**
 * The shop's business profile on the map app (a made-up one, "Pinpoint"), as its owner sees it: the
 * public listing (photos, the star rating, opening hours, popular times, every review with the
 * photos shoppers took) plus the owner's tools: reply to reviews, and how the profile is doing.
 */
type Tab = 'overview' | 'reviews' | 'photos' | 'performance';
type Sort = 'relevant' | 'newest' | 'highest' | 'lowest';

const TOPIC_WORDS: Record<Topic, string> = { wait: 'checkout', stock: 'stock', price: 'prices', clean: 'clean', looks: 'atmosphere', outside: 'outside', staff: 'staff', parking: 'parking', fresh: 'fresh produce', range: 'selection' };
const AVATAR_COLOURS = ['#E8573F', '#3570BC', '#7E57C2', '#22A699', '#F2702E', '#C2417A', '#5B8FB0', '#8B5A3C'];

const I: Record<string, JSX.Element> = {
  pin: <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" /></svg>,
  directions: <svg viewBox="0 0 24 24"><path d="M21.7 11.3l-9-9a1 1 0 00-1.4 0l-9 9a1 1 0 000 1.4l9 9a1 1 0 001.4 0l9-9a1 1 0 000-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 011-1h5V7.5l3.5 3.5z" /></svg>,
  save: <svg viewBox="0 0 24 24"><path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2zm0 15l-5-2.2L7 18V5h10z" /></svg>,
  nearby: <svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 3h-2.1A7 7 0 0013 5.1V3h-2v2.1A7 7 0 005.1 11H3v2h2.1a7 7 0 005.9 5.9V21h2v-2.1a7 7 0 005.9-5.9H21zm-9 6a5 5 0 110-10 5 5 0 010 10z" /></svg>,
  phone: <svg viewBox="0 0 24 24"><path d="M20 15.5a11.4 11.4 0 01-3.6-.6 1 1 0 00-1 .3l-2.2 2.2a15 15 0 01-6.6-6.6l2.2-2.2a1 1 0 00.3-1A11.4 11.4 0 018.5 4a1 1 0 00-1-1H4a1 1 0 00-1 1 17 17 0 0017 17 1 1 0 001-1v-3.5a1 1 0 00-1-1z" /></svg>,
  share: <svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 00-2.4 1.2l-7-4a3 3 0 000-2.4l7-4A3 3 0 1015 5l-7 4a3 3 0 100 6l7 4a3 3 0 103-3z" /></svg>,
  clock: <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm0 18a8 8 0 118-8 8 8 0 01-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7z" /></svg>,
  globe: <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm6.9 6h-3a15.7 15.7 0 00-1.4-3.6A8 8 0 0118.9 8zM12 4a14 14 0 011.9 4h-3.8A14 14 0 0112 4zM4.3 14a8.2 8.2 0 010-4h3.4a16.5 16.5 0 000 4zm.8 2h3a15.7 15.7 0 001.4 3.6A8 8 0 015.1 16zm3-8h-3a8 8 0 014.3-3.6A15.7 15.7 0 008.1 8zM12 20a14 14 0 01-1.9-4h3.8A14 14 0 0112 20zm2.3-6H9.7a14.7 14.7 0 010-4h4.6a14.7 14.7 0 010 4zm.3 5.6a15.7 15.7 0 001.4-3.6h3a8 8 0 01-4.4 3.6zm1.7-5.6a16.5 16.5 0 000-4h3.4a8.2 8.2 0 010 4z" /></svg>,
  like: <svg viewBox="0 0 24 24"><path d="M2 21h3V9H2zm19-10a2 2 0 00-2-2h-6.3l1-4.6v-.3a1.5 1.5 0 00-.4-1L12.2 2 6.6 7.6A2 2 0 006 9v10a2 2 0 002 2h9a2 2 0 001.8-1.2l3-7.1a2 2 0 00.2-.7z" /></svg>,
  camera: <svg viewBox="0 0 24 24"><path d="M12 9a4 4 0 104 4 4 4 0 00-4-4zm8-3h-3.2L15 4H9L7.2 6H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zm-8 12a5 5 0 115-5 5 5 0 01-5 5z" /></svg>,
  close: <svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z" /></svg>,
  views: <svg viewBox="0 0 24 24"><path d="M12 5C7 5 2.7 8.1 1 12.5 2.7 16.9 7 20 12 20s9.3-3.1 11-7.5C21.3 8.1 17 5 12 5zm0 12.5a5 5 0 115-5 5 5 0 01-5 5zm0-8a3 3 0 103 3 3 3 0 00-3-3z" /></svg>,
  search: <svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 10-.7.7l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z" /></svg>,
};

/** Five stars, the last partly filled for a fractional rating. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value.toFixed(1)} stars`} style={{ ['--s' as string]: `${size}px` }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const f = Math.max(0, Math.min(1, value - i));
        return <svg key={i} viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id={`st${i}-${Math.round(f * 100)}`}><stop offset={`${f * 100}%`} stopColor="#FBBC04" /><stop offset={`${f * 100}%`} stopColor="#DADCE0" /></linearGradient></defs><path fill={`url(#st${i}-${Math.round(f * 100)})`} d="M12 17.3l6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7z" /></svg>;
      })}
    </span>
  );
}

/** "2 days ago", the way the map app writes it. */
function ago(nowDay: number, nowT: number, day: number, t: number): string {
  const d = nowDay - day;
  if (d <= 0) { const h = Math.round((nowT - t) * 12); return h <= 0 ? 'just now' : h === 1 ? 'an hour ago' : `${h} hours ago`; }
  if (d === 1) return 'a day ago';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return 'a week ago';
  if (d < 28) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 60) return 'a month ago';
  return `${Math.floor(d / 30)} months ago`;
}

function Photo({ url, alt, onOpen, className = '' }: { url: string | null; alt: string; onOpen?: () => void; className?: string }) {
  if (!url) return <span className={`ph loading ${className}`} aria-label={`${alt} (loading)`} />;
  return onOpen ? <button className={`ph ${className}`} onClick={onOpen} aria-label={alt}><img src={url} alt={alt} /></button> : <span className={`ph ${className}`}><img src={url} alt={alt} /></span>;
}

const KIND_ALT: Record<ReviewPhoto['kind'], string> = { outside: 'Outside the shop', aisle: 'Inside the shop', haul: 'What they bought', selfie: 'A selfie with their shopping' };

/** Suggested replies, by how the review went. */
function replyIdeas(rv: Review, shop: string): string[] {
  const first = rv.author.split(' ')[0];
  if (rv.stars >= 4) return [`Thank you so much, ${first}! We're so glad you enjoyed your visit. See you again soon!`, `Thanks for the lovely review, ${first}. It means a lot to the whole team at ${shop}.`, `Cheers ${first}! Glad you found what you needed.`];
  if (rv.stars === 3) return [`Thanks for the honest feedback, ${first}. We're working on it and hope to earn that extra star next time.`, `Thank you ${first}. Sorry it wasn't perfect, we've taken your comments on board.`];
  return [`We're really sorry, ${first}. That isn't the standard we aim for. We've spoken to the team and fixed it, please give us another try.`, `Sorry to hear this, ${first}. Thanks for telling us, we're putting it right.`];
}

export function BusinessCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion; void snap.photoVersion; void snap.reviews.count;
  const [tab, setTab] = useState<Tab>('overview');
  const [sort, setSort] = useState<Sort>('relevant');
  const [topic, setTopic] = useState<Topic | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);
  const [photoFilter, setPhotoFilter] = useState<'all' | 'food' | 'inside' | 'outside' | 'owner'>('all');
  const listing = s.listing;
  const reviews = listing?.reviews ?? [];
  const count = listing?.count ?? 0;
  const avg = rating(s);
  const nowT = Math.min(1, s.time / DAY_SECONDS);
  const plot = PLOTS.find((p) => p.id === s.shop.plotId);
  const street = (plot?.name ?? 'Main Road corner').replace(/ corner$/, '');
  const open = s.phase === 'open';
  const thumbs = runtime.renderer?.characterThumbs ?? {};
  const looks = useMemo(() => looksOf(s), [s, snap.stateVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const allPhotos = useMemo(() => reviews.flatMap((rv) => rv.photos.map((ph) => ({ ph, rv }))), [reviews, snap.reviews.count]); // eslint-disable-line react-hooks/exhaustive-deps
  const photoCount = allPhotos.length + 2;
  const covers = { outside: runtime.coverUrl('outside'), aisle: runtime.coverUrl('aisle') };
  const latestCustomer = allPhotos.find((x) => runtime.photoUrl(x.ph.id));

  const topics = useMemo(() => {
    const m = new Map<Topic, number>();
    for (const rv of reviews) for (const t of rv.topics) m.set(t.topic, (m.get(t.topic) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [reviews, snap.reviews.count]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    let list = topic ? reviews.filter((rv) => rv.topics.some((t) => t.topic === topic)) : reviews.slice();
    if (sort === 'newest') list = list.slice();
    else if (sort === 'highest') list.sort((a, b) => b.stars - a.stars || b.day - a.day);
    else if (sort === 'lowest') list.sort((a, b) => a.stars - b.stars || b.day - a.day);
    else { const weight = (rv: Review) => (rv.text.length > 40 ? 1 : 0) + rv.photos.length * 0.6 + rv.likes * 0.4 + (rv.reply ? 0.3 : 0) - (s.day - rv.day) * 0.15; list.sort((a, b) => weight(b) - weight(a)); }
    return list;
  }, [reviews, sort, topic, snap.reviews.count]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => runtime.closeCard();
  const openPhoto = (url: string | null, caption: string) => { if (url) setLightbox({ url, caption }); };

  const header = (
    <div className="biz-hero">
      <Photo url={covers.outside} alt="The shopfront" className="big" onOpen={() => openPhoto(covers.outside, `${s.shop.name} · by the owner`)} />
      <div className="side">
        <Photo url={covers.aisle} alt="Inside the shop" onOpen={() => openPhoto(covers.aisle, `${s.shop.name} · by the owner`)} />
        <Photo url={latestCustomer ? runtime.photoUrl(latestCustomer.ph.id) : covers.aisle} alt="Latest photo from a customer" onOpen={() => { setTab('photos'); setPhotoFilter('all'); }} />
      </div>
      <button className="see-photos" onClick={() => setTab('photos')}>{I.camera}<span>{photoCount} photos</span></button>
    </div>
  );

  const summary = (
    <div className="biz-summary">
      <div className="big"><b>{count ? avg.toFixed(1) : '–'}</b><Stars value={avg} size={16} /><span>{count.toLocaleString()} review{count === 1 ? '' : 's'}</span></div>
      <div className="bars">
        {[5, 4, 3, 2, 1].map((n) => {
          const c = listing?.stars[n - 1] ?? 0;
          return <div key={n} className="bar"><span>{n}</span><i><b style={{ width: `${count ? (c / count) * 100 : 0}%` }} /></i></div>;
        })}
      </div>
    </div>
  );

  const reviewList = (
    <>
      {topics.length > 0 && (
        <div className="chips" role="group" aria-label="Mentioned in reviews">
          <button className={`chip${topic === null ? ' on' : ''}`} onClick={() => setTopic(null)}>All</button>
          {topics.map(([t, n]) => <button key={t} className={`chip${topic === t ? ' on' : ''}`} onClick={() => setTopic(topic === t ? null : t)}>{TOPIC_WORDS[t]} <span>{n}</span></button>)}
        </div>
      )}
      <div className="chips sort" role="group" aria-label="Sort reviews">
        {(['relevant', 'newest', 'highest', 'lowest'] as Sort[]).map((k) => <button key={k} className={`chip${sort === k ? ' on' : ''}`} onClick={() => setSort(k)}>{k === 'relevant' ? 'Most relevant' : k[0]!.toUpperCase() + k.slice(1)}</button>)}
      </div>
      {count === 0 && <p className="biz-empty">No reviews yet.</p>}
      <ol className="biz-reviews" aria-label="Reviews">
        {shown.slice(0, 40).map((rv) => <ReviewItem key={rv.id} rv={rv} runtime={runtime} nowDay={s.day} nowT={nowT} shop={s.shop.name} thumb={thumbs[PEOPLE_MODELS[Math.min(rv.look.model, PEOPLE_MODELS.length - 2)]!] ?? null} onPhoto={openPhoto} />)}
      </ol>
    </>
  );

  // Popular times: the town's usual day, and how busy it is in there right now.
  const hourNow = Math.floor(s.time / 60);
  const inShop = s.people.filter((p) => p.kind === 'customer').length;
  const usual = dayCurve(Math.min(s.time, DAY_SECONDS)) * 4;
  const live = open ? (inShop > usual * 1.3 ? 'Busier than usual' : inShop < usual * 0.6 ? 'Not too busy' : 'Usually as busy as it is now') : null;

  const overview = (
    <>
      <ul className="biz-info">
        <li>{I.pin}<span>{12 + (s.seed % 80)} {street}, The Crossroads</span></li>
        <li>{I.clock}<span><b className={open ? 'open' : 'shut'}>{open ? 'Open' : 'Closed'}</b> · {open ? 'Closes 8 pm' : 'Opens 8 am'}</span></li>
        <li>{I.globe}<span>{s.shop.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.shop</span></li>
        <li>{I.phone}<span>555-01{String(10 + (s.seed % 90)).padStart(2, '0')}</span></li>
      </ul>
      <section className="biz-section">
        <h4>Popular times</h4>
        <div className="popular" aria-label="Popular times">
          {Array.from({ length: 12 }, (_, h) => {
            const v = dayCurve(h * 60 + 30) / 2.3;
            const now = open && h === hourNow;
            return <i key={h} className={now ? 'now' : ''} style={{ height: `${Math.round(18 + v * 64)}%` }} title={`${((h + 7) % 12) + 1} ${h + 8 < 12 ? 'am' : 'pm'}`} />;
          })}
        </div>
        <div className="popular-axis"><span>8a</span><span>11a</span><span>2p</span><span>5p</span><span>8p</span></div>
        {live && <p className="live"><b>Live</b> · {live}</p>}
      </section>
      <section className="biz-section">
        <h4>Review summary</h4>
        {summary}
        {reviews.slice(0, 3).length > 0 && <ol className="biz-reviews" aria-label="Top reviews">{reviews.filter((rv) => rv.text).slice(0, 3).map((rv) => <ReviewItem key={rv.id} rv={rv} runtime={runtime} nowDay={s.day} nowT={nowT} shop={s.shop.name} thumb={thumbs[PEOPLE_MODELS[Math.min(rv.look.model, PEOPLE_MODELS.length - 2)]!] ?? null} onPhoto={openPhoto} compact />)}</ol>}
        {count > 3 && <button className="biz-more" onClick={() => setTab('reviews')}>More reviews ({count})</button>}
      </section>
    </>
  );

  const photosTab = (
    <>
      <div className="chips" role="group" aria-label="Photo categories">
        {(['all', 'food', 'inside', 'outside', 'owner'] as const).map((k) => <button key={k} className={`chip${photoFilter === k ? ' on' : ''}`} onClick={() => setPhotoFilter(k)}>{k === 'all' ? 'All' : k === 'food' ? 'Food & drink' : k === 'inside' ? 'Inside' : k === 'outside' ? 'Outside' : 'By owner'}</button>)}
      </div>
      <div className="biz-grid">
        {(photoFilter === 'all' || photoFilter === 'owner' || photoFilter === 'outside') && <Photo url={covers.outside} alt="The shopfront (by the owner)" onOpen={() => openPhoto(covers.outside, 'By the owner')} />}
        {(photoFilter === 'all' || photoFilter === 'owner' || photoFilter === 'inside') && <Photo url={covers.aisle} alt="Inside the shop (by the owner)" onOpen={() => openPhoto(covers.aisle, 'By the owner')} />}
        {photoFilter !== 'owner' && allPhotos.filter(({ ph }) => photoFilter === 'all' || (photoFilter === 'food' ? ph.kind === 'haul' || ph.kind === 'selfie' : photoFilter === 'inside' ? ph.kind === 'aisle' : ph.kind === 'outside')).slice(0, 60).map(({ ph, rv }) => {
          const url = runtime.photoUrl(ph.id);
          return <Photo key={ph.id} url={url} alt={`${KIND_ALT[ph.kind]}, by ${rv.author}`} onOpen={() => openPhoto(url, `${rv.author} · ${ago(s.day, nowT, rv.day, rv.t)}`)} />;
        })}
      </div>
    </>
  );

  return (
    <div className="card biz t-reviews" role="dialog" aria-label="Business Profile">
      <header className="biz-bar">
        <span className="biz-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7z" fill="#1A9E8F" /><circle cx="12" cy="9" r="3.2" fill="#fff" /></svg></span>
        <span className="biz-brand"><b>Pinpoint</b> Business Profile</span>
        <span className="biz-you">You manage this profile</span>
        <button className="biz-close" onClick={close} aria-label="Close">{I.close}</button>
      </header>
      <div className="biz-scroll">
        {header}
        <div className="biz-title">
          <h2>{s.shop.name}</h2>
          <div className="rating-line"><b>{count ? avg.toFixed(1) : 'No reviews'}</b>{count > 0 && <Stars value={avg} />}{count > 0 && <button className="link" onClick={() => setTab('reviews')}>({count.toLocaleString()})</button>}<span>· $</span></div>
          <div className="cat">Grocery store · {open ? <b className="open">Open</b> : <b className="shut">Closed</b>}</div>
        </div>
        <nav className="biz-tabs" role="tablist" aria-label="Profile">
          {(['overview', 'reviews', 'photos', 'performance'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'performance' ? 'Performance' : t[0]!.toUpperCase() + t.slice(1)}</button>)}
        </nav>
        {tab === 'overview' && (
          <div className="biz-actions">
            {[['directions', 'Directions'], ['save', 'Save'], ['nearby', 'Nearby'], ['phone', 'Call'], ['share', 'Share']].map(([k, label], i) => <span key={k} className={`act${i === 0 ? ' primary' : ''}`}><i>{I[k!]}</i>{label}</span>)}
          </div>
        )}
        <div className="biz-body">
          {tab === 'overview' && overview}
          {tab === 'reviews' && <>{summary}{reviewList}</>}
          {tab === 'photos' && photosTab}
          {tab === 'performance' && <Performance runtime={runtime} looks={looks} />}
        </div>
      </div>
      {lightbox && (
        <div className="biz-lightbox" role="dialog" aria-label="Photo" onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.caption} />
          <span>{lightbox.caption}</span>
          <button className="biz-close" aria-label="Close photo">{I.close}</button>
        </div>
      )}
    </div>
  );
}

function ReviewItem({ rv, runtime, nowDay, nowT, shop, thumb, onPhoto, compact = false }: { rv: Review; runtime: GameRuntime; nowDay: number; nowT: number; shop: string; thumb: string | null; onPhoto: (url: string | null, caption: string) => void; compact?: boolean }) {
  const [more, setMore] = useState(false);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const long = rv.text.length > 170;
  const text = long && !more ? `${rv.text.slice(0, 160).replace(/\s+\S*$/, '')}…` : rv.text;
  const when = ago(nowDay, nowT, rv.day, rv.t);
  const colour = AVATAR_COLOURS[rv.id % AVATAR_COLOURS.length]!;
  return (
    <li className="biz-review">
      <div className="who">
        {thumb && rv.id % 3 !== 0 ? <img className="avatar" src={thumb} alt="" /> : <span className="avatar" style={{ background: colour }} aria-hidden="true">{rv.author[0]}</span>}
        <div><b>{rv.author}</b><small>{rv.guide ? 'Local Guide · ' : ''}{rv.authorReviews} review{rv.authorReviews === 1 ? '' : 's'}{rv.authorPhotos ? ` · ${rv.authorPhotos} photo${rv.authorPhotos === 1 ? '' : 's'}` : ''}</small></div>
      </div>
      <div className="meta"><Stars value={rv.stars} size={13} /><span>{when}</span>{nowDay === rv.day && <em>NEW</em>}</div>
      {rv.text && <p>{text}{long && <button className="link" onClick={() => setMore(!more)}>{more ? ' Less' : ' More'}</button>}</p>}
      {rv.photos.length > 0 && !compact && (
        <div className="shots">{rv.photos.map((ph) => { const url = runtime.photoUrl(ph.id); return <Photo key={ph.id} url={url} alt={`${KIND_ALT[ph.kind]}, by ${rv.author}`} onOpen={() => onPhoto(url, `${rv.author} · ${when}`)} />; })}</div>
      )}
      {!compact && <div className="rv-actions"><span className="like">{I.like}{rv.likes ? rv.likes : 'Like'}</span><span className="like">{I.share}Share</span>{!rv.reply && !replying && <button className="link reply" onClick={() => { setReplying(true); setDraft(replyIdeas(rv, shop)[0]!); }}>Reply</button>}</div>}
      {replying && (
        <div className="replybox">
          <div className="ideas">{replyIdeas(rv, shop).map((t) => <button key={t} className="chip" onClick={() => setDraft(t)}>{t.length > 46 ? `${t.slice(0, 44)}…` : t}</button>)}</div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Your reply" rows={3} />
          <div className="row"><button className="biz-btn ghost" onClick={() => setReplying(false)}>Cancel</button><button className="biz-btn" disabled={!draft.trim()} onClick={() => { if (runtime.dispatch({ type: 'replyReview', reviewId: rv.id, text: draft }).ok) setReplying(false); }}>Post reply</button></div>
        </div>
      )}
      {rv.reply && <div className="owner-reply"><b>Response from the owner</b> <span>{ago(nowDay, nowT, rv.reply.day, nowT)}</span><p>{rv.reply.text}</p></div>}
    </li>
  );
}

/** The owner's numbers: how many people saw the profile, and what shoppers notice about the shop. */
function Performance({ runtime, looks }: { runtime: GameRuntime; looks: Looks }) {
  const s = runtime.state!;
  const week = s.history.slice(-7);
  const visits = week.reduce((a, d) => a + d.customers, 0);
  const n = s.listing?.count ?? 0;
  const views = Math.round(visits * 2.4 + n * 9 + s.shop.awareness * 120);
  const searches = Math.round(views * 0.62), directions = Math.round(visits * 0.18 + n * 0.8), calls = Math.round(visits * 0.03 + 1);
  const recent = (s.listing?.reviews ?? []).filter((rv) => rv.day > s.day - 7);
  const replied = (s.listing?.reviews ?? []).filter((rv) => rv.reply).length;
  const parts: [keyof Looks, string, string][] = [
    ['decor', 'Decor', 'Plants, aisle signs, a bench and baskets by the door'],
    ['shelves', 'Full shelves', 'Shelves stocked to the top look generous'],
    ['tidy', 'Clean floor', 'Spills mopped, nothing left lying about'],
    ['space', 'Room to move', 'Not bare, not crammed'],
    ['outside', 'Frontage', 'No litter, no gang by the door'],
    ['extras', 'Extras', 'A lit sign, a bigger shop, a produce stand'],
  ];
  return (
    <div className="biz-perf">
      <p className="muted">Last 7 days</p>
      <div className="tiles">
        <div>{I.views}<b>{views.toLocaleString()}</b><span>Profile views</span></div>
        <div>{I.search}<b>{searches.toLocaleString()}</b><span>Searches</span></div>
        <div>{I.directions}<b>{directions.toLocaleString()}</b><span>Directions</span></div>
        <div>{I.phone}<b>{calls.toLocaleString()}</b><span>Calls</span></div>
      </div>
      <p className="muted">{recent.length} new review{recent.length === 1 ? '' : 's'} this week{recent.length ? `, averaging ${(recent.reduce((a, r) => a + r.stars, 0) / recent.length).toFixed(1)}★` : ''} · {replied} replied to</p>
      <h4>What shoppers notice</h4>
      <p className="muted">How the shop looks feeds every review. Overall: <b>{Math.round(looks.score * 100)}/100</b></p>
      <ul className="looks">
        {parts.map(([k, label, tip]) => {
          const v = looks[k];
          return <li key={k}><span className="l">{label}<small>{tip}</small></span><i><b style={{ width: `${Math.round(v * 100)}%`, background: v > 0.66 ? '#1E8E3E' : v > 0.33 ? '#F9AB00' : '#D93025' }} /></i></li>;
        })}
      </ul>
    </div>
  );
}
