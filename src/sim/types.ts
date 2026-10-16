import type { Sky } from './weather';
import type { TownLife } from './life';
import type { Listing } from './reviews';
import type { Category } from './products';

export interface Vec2 { x: number; z: number }
/**
 * A point on a path. Most are walked to; one with `ride` is reached by riding the stairs, the escalator
 * or the lift `via` that piece (seconds), from the point before it on another floor, facing `yaw` (world).
 */
export interface Waypoint extends Vec2 { ride?: number; via?: number; yaw?: number }

/** Rotation in quarter turns, 0 = facing +z (south, toward the camera). */
export type Rot = 0 | 1 | 2 | 3;

export type FixtureType = 'register' | 'shelf' | 'fridge' | 'freezer' | 'produce' | 'endcap' | 'kiosk' | 'rack' | 'sign' | 'plant' | 'bench' | 'basketStack' | 'pallet' | 'storeRack'
  /** More displays: an ice-cream chest, chilled produce, a wall shelf, a glass counter, a display table, a bakery case, a clothes rail, a vending machine. */
  | 'iceChest' | 'coolProduce' | 'wallShelf' | 'glassCase' | 'displayTable' | 'bakeryCase' | 'clothesRail' | 'vending'
  | 'sofa' | 'cafe' | 'desk' | 'bin' | 'trolleys' | 'speaker' | 'screen' | 'bookcase'
  | 'flowers' | 'rug' | 'doormat'
  | 'wall' | 'wallWindow' | 'doorway' | 'railing' | 'gate' | 'window' | 'tallWall'
  | 'floorLamp' | 'wallLight' | 'pendant' | 'neon'
  /** Security: a camera on the wall, a dome on the ceiling, a smart dome, and tag gates by the door. */
  | 'camera' | 'dome' | 'smartCam' | 'tagGate'
  /** Out on the lot. */
  | 'flowerBed' | 'tree' | 'planter' | 'parkBench' | 'bikeRack' | 'billboard'
  /** Up to the next floor. */
  | 'stairs' | 'escalator' | 'elevator';

/** The Build card's tabs. */
export type BuildCategory = 'checkout' | 'shelves' | 'furniture' | 'decor' | 'walls' | 'lights' | 'security' | 'outside' | 'storeys';
/** What a tile of the lot is laid with (grass where none is). */
export type LotSurface = 'gravel' | 'asphalt' | 'paving' | 'brick';
/** The shop floor's finish (the warm checker lino it starts with, or one bought). */
export type FloorStyle = 'lino' | 'wood' | 'checker' | 'stone' | 'colour' | 'concrete';
/** The inside finish of a stretch of outer wall. */
export type WallStyle = 'plain' | 'bands' | 'tiles' | 'wood' | 'brick';
/** The shell walls (old saves put windows in a whole wall at a time; see windowsFromSides). */
export type WindowSide = 'left' | 'right' | 'back';

export interface FixtureDef {
  type: FixtureType;
  name: string;
  price: number;
  /** Footprint in tiles. */
  w: number; d: number;
  /** Product slots (0 for decor). */
  slots: number;
  capacity: number;
  chilled: boolean;
  /** Daily running cost (electricity). */
  upkeep: number;
  /** Which categories fit (undefined = any non-chilled). */
  accepts?: Category[];
  /** Which tab of the Build card it is on. */
  category: BuildCategory;
  /** People walk over or under it (a rug, a doorway, a light on the wall): it never blocks a tile. */
  walkable?: boolean;
  /** Hangs on a wall: its back must be against the shop's outer wall. */
  onWall?: boolean;
  /** Hangs from the ceiling: it shares its tile with whatever stands on the floor under it. */
  overhead?: boolean;
  /** Chilled, but takes goods that need no fridge too (fruit and veg on the chilled stand, crisps in the vending machine). */
  mixed?: boolean;
  /** What it adds to how the shop looks (decor, 0..1 in all), for up to `looksCap` of them. */
  looks?: number; looksCap?: number;
  /**
   * How far it reaches forward from the back of its tile (pieces stand flush at the back), when that is
   * no more than about half: the front of the tile is open floor people can walk across. Unset: all of it.
   */
  depth?: number;
  /** Stands out on the lot, on its own grid (see lotTile): never on the shop floor. */
  outdoor?: boolean;
  /** Out on the lot: what it adds to how the lot looks from the street, for up to `looksCap` of them. */
  curb?: number;
}

export interface Slot { productId: string | null; qty: number; }

export interface Fixture {
  id: number;
  type: FixtureType;
  /** Tile position of the footprint's min corner, store-relative. */
  x: number; z: number;
  rot: Rot;
  slots: Slot[];
  /** Register only: queue of person ids, front first. */
  queue?: number[];
  /** Register only: id of the person being served. */
  serving?: number | null;
  /** Register only: items scanned so far for the current customer. */
  scanned?: number;
  /** Register only: id of the staff member working it. */
  staffId?: number | null;
  /** Bike rack only: who has a bike in each stand (a person id), or null. */
  bikes?: (number | null)[];
}

export type CustomerType = 'bargain' | 'convenience' | 'loyalist' | 'impulse';

export type PersonState =
  | 'driving' | 'toDoor' | 'entering' | 'shopping' | 'browsing' | 'toQueue' | 'queued' | 'paying' | 'leaving' | 'toCar' | 'walking' | 'gone'
  | 'idle' | 'toStock' | 'pickBox' | 'carrying' | 'stocking' | 'toRegister' | 'working' | 'inRival' | 'loading'
  /** A shoplifter making a run for the door, and the staff member after them. */
  | 'fleeing' | 'chasing'
  /** Came by bike: riding over to the rack, and walking back to it to ride home. */
  | 'toRack' | 'toBike'
  /** Sat on a bench or at the café table, or asking at the help desk (see Person.rest). */
  | 'resting';

export type Anim = 'idle' | 'walk' | 'browse' | 'carry' | 'pay' | 'sit';

/**
 * How someone looks: which character, its outfit variant and height. The manager can also be designed:
 * skin, hair, top and trousers colours (hex), each left out for the character's own.
 */
export interface Look { model: number; variant: number; height: number; dog?: boolean; skin?: string; hair?: string; top?: string; bottom?: string }

export interface Person {
  id: number;
  kind: 'customer' | 'staff' | 'walker' | 'owner';
  /** Which mesh and recolour variant the renderer uses. */
  look: Look;
  x: number; z: number; yaw: number;
  px: number; pz: number;
  state: PersonState;
  anim: Anim;
  path: Waypoint[];
  pathIdx: number;
  speed: number;
  /** Seconds left in the current state (browsing, paying...). */
  timer: number;
  // customer
  ctype?: CustomerType;
  list?: { productId: string; qty: number }[];
  basket?: { productId: string; qty: number; price: number }[];
  listIdx?: number;
  missed?: number;
  budget?: number;
  patience?: number;
  maxPatience?: number;
  carId?: number | null;
  registerId?: number | null;
  queueSlot?: number;
  targetFixture?: number | null;
  mood?: number;
  arrivedTick?: number;
  queuedTick?: number;
  walked?: number;
  crowded?: number;
  // staff / owner
  role?: StaffRole;
  task?: { type: 'carry'; fixtureId: number; productId: string; qty: number } | null;
  carrying?: { productId: string; qty: number } | null;
  wage?: number;
  skill?: number;
  morale?: number;
  name?: string;
  stuckTicks?: number;
  hiredDay?: number;
  shift?: 'full' | 'morning' | 'evening';
  /** Owner only: the direction the player is steering (world space), or null. */
  moveDir?: { x: number; z: number } | null;
  /** Out on the streets: path indices where a zebra starts (wait for the walk light there). */
  xings?: number[];
  /** Shoppers bound for a rival: which one, and whether they carry its bags home. */
  rivalId?: string;
  bags?: boolean;
  /** Our customers: paid at the till, so they leave with our bags. */
  paid?: boolean;
  /** The walk animation to resume after waiting at a kerb. */
  heldAnim?: Anim;
  /** Shoppers: the store they chose ('player' or a rival id) and the two scores that most drove it. */
  store?: string;
  why?: (keyof StoreScores)[];
  // Town life (walkers): who they are beyond a passer-by, and what they are up to.
  /** A teenager hanging about with friends, or a driver out of a car after a bump. */
  life?: 'teen' | 'driver';
  /** Teenagers: the group they are with (while it lasts). */
  hangout?: number;
  /** Teenagers: lights up while hanging about. */
  smoking?: boolean;
  /** Teenagers: the tick they last dropped something (the renderer flicks a hand). */
  throwTick?: number;
  /** Drivers: the bump they got out of their car for. */
  bumpId?: number;
  /** Dog walkers: seconds of walking before the dog needs to stop, and the seconds left of the stop. */
  poopIn?: number;
  dogStop?: number;
  // What a shopper noticed on the visit (for the review they may write).
  /** Products they wanted and could not find, and ones they put back as too dear. */
  missedIds?: string[];
  priceyIds?: string[];
  /** Walked in to a messy floor. */
  sawMess?: boolean;
  /** Who rang them up: a cashier (and how good), the owner, or a self-checkout kiosk. */
  servedBy?: 'staff' | 'owner' | 'kiosk';
  servedSkill?: number;
  /** A shoplifter: shops like anyone else, then runs for the door instead of the till. Caught: `busted`. */
  thief?: boolean;
  busted?: boolean;
  /** Staff: the shoplifter they are after. */
  chase?: number | null;
  /** A shoplifter held still a moment by a smart camera (seconds left), and whether one has already (it works once). */
  frozen?: number;
  zapped?: boolean;
  /** Bought something at the vending machine (paid there): served, even with nothing for the till. */
  vended?: boolean;
  /** A shoplifter who has run through the tag gates (they sound once). */
  gated?: boolean;
  /** Staff: experience from the job (scans, boxes shelved, spills, arrests); it sets their level, 1 to 5. */
  xp?: number;
  /** Staff: on a break (half pay, off the floor, keeps their experience). */
  onBreak?: boolean;
  /** Staff: the tick they last said what they need to do their job. */
  needTick?: number;
  /** Staff: seconds at their post with nothing to do (they go and tidy a shelf after a while). */
  idleFor?: number;
  /** Came by bike: the rack and stand it is locked to, and whether they are riding it now. */
  bike?: { rackId: number; slot: number } | null;
  riding?: boolean;
  /** Sitting down (a bench, the café table) or asking at the help desk: where, which place, and what next. */
  rest?: { kind: 'seat' | 'cafe' | 'desk'; fixtureId: number; seat: number; productId?: string } | null;
  /** Has had a sit down this visit. */
  rested?: boolean;
  /** On the stairs, the escalator or in the lift: how far through the ride (seconds) to the next waypoint. */
  climb?: number;
  /** The manager, just off a ride: where they stepped off (no riding straight back until they step away or let go). */
  rideLock?: Vec2;
}

export type StaffRole = 'cashier' | 'stocker' | 'cleaner' | 'orderer' | 'manager' | 'guard';
export type CardId = 'stock' | 'prices' | 'build' | 'staff' | 'marketing' | 'stats' | 'settings' | 'reviews' | null;

export interface Candidate { id: number; name: string; role: StaffRole; skill: number; speed: number; wage: number; look: { model: number; variant: number; height: number } }
export interface ManagerRules {
  reorderPoint: number; spendCap: number; priceMin: number; priceMax: number; wageCap: number; adBudget: number;
  /** How full to stock up to when reordering, times what the shelves hold (0.5 to 2; 1.5 when unset). */
  stockTarget?: number;
  /** Reorders come by instant delivery (25% more, no truck to wait for). */
  instant?: boolean;
}

/**
 * When a manager places a saved order: every morning, every few days, when the pallet runs low, when
 * one product (on the shelves and the pallet together) runs low.
 */
export type OrderRule =
  | { kind: 'never' }
  | { kind: 'daily' }
  | { kind: 'everyDays'; days: number }
  | { kind: 'palletBelow'; units: number }
  | { kind: 'productBelow'; productId: string; units: number };

/** An order you saved to place again (yourself, or the manager by its rule). */
export interface SavedOrder {
  id: number;
  name: string;
  supplierId: string;
  lines: { productId: string; qty: number }[];
  when: OrderRule;
  /** Only when there is at least this much in the till after paying for it. */
  minCash: number;
  /** The day it was last placed (a manager places each at most once a day). */
  lastDay?: number;
}
export interface Litter { id: number; x: number; z: number }

export type CarState = 'arriving' | 'parking' | 'parked' | 'leaving' | 'passing' | 'delivering' | 'unloading' | 'gone' | 'turnedAway';

export interface Car {
  id: number;
  model: number;
  x: number; z: number; yaw: number;
  px: number; pz: number; pyaw: number;
  path: Vec2[];
  pathIdx: number;
  speed: number;
  /** How fast it is actually going: eases toward the speed it wants (gentle off the mark, firmer on the brakes). */
  v?: number;
  state: CarState;
  bay: number | null;
  /** Whose lot the bay is in: undefined = the player's, a rival id, or 'street' for Elm Street's shared bays. */
  lot?: string;
  ownerId: number | null;
  timer: number;
  /** Delivery trucks: the order they carry. */
  orderId?: number;
  /** Backing out of a bay: the car moves along its path facing the other way. */
  reversing?: boolean;
  /** Backing out: the heading at each point of the path (the back-out arc, worked out on the rear axle). */
  yaws?: number[];
  /** The path to follow once the car has backed out. */
  next?: Vec2[];
  /** Seconds spent held up behind another car (breaks rare deadlocks). */
  waited?: number;
  /** Waiting at a junction for a gap in the traffic. */
  yielding?: boolean;
  /** Distance to the car ahead in its lane (render-free scratch, recomputed each tick). */
  gap?: number;
  /** The car holding this one up, if any (to break two-car standoffs). */
  blocker?: number;
}

export interface ParkingBay { x: number; z: number; yaw: number; carId: number | null }

export interface Order {
  id: number;
  supplierId: string;
  lines: { productId: string; qty: number; unitCost: number }[];
  total: number;
  placedDay: number;
  placedTime: number;
  /** Game seconds until arrival (counts down). */
  eta: number;
  state: 'pending' | 'arriving' | 'delivered';
  /** Placed from a saved order (its id). */
  savedId?: number;
}

export interface StockEntry { productId: string; qty: number; /** day received, for spoilage */ day: number }

export type CornerId = 'nw' | 'ne' | 'sw' | 'se';

export interface Plot {
  id: string;
  name: string;
  blurb: string;
  /** Which corner of the crossroads the plot is. */
  corner: CornerId;
  rent: number;
  /** Multipliers on each customer type's arrival rate. */
  mix: Record<CustomerType, number>;
  traffic: number;
}

export interface Shop {
  name: string;
  plotId: string;
  /** World offset: store-relative (0,0) is the front door's tile centre. */
  originX: number; originZ: number;
  /** South corners: the shop-relative frame is turned half round (the door faces north). */
  flip?: boolean;
  /** Interior bounds in store-relative tiles: the floor's bounding rectangle (see `gaps`). */
  floor: { x0: number; z0: number; x1: number; z1: number };
  /** Tiles inside `floor` that are not floor yet (the shop grows a tile at a time), keys "x,z" of their corner. */
  gaps?: string[];
  /** Floor finish tile by tile, where it differs from `floorStyle` (keys as `gaps`). */
  tileStyles?: Record<string, FloorStyle>;
  storeroom: { x0: number; z0: number; x1: number; z1: number };
  door: Vec2;
  backDoor: Vec2;
  fixtures: Fixture[];
  storage: StockEntry[];
  /** Room on the delivery pallet the shop came with (each extra Pallet adds PALLET_UNITS; see storageCap). */
  storageCapacity: number;
  bays: ParkingBay[];
  reputation: number;
  awareness: number;
  cleanliness: number;
  /** Sign lettering: plain, or lit after dark (a goal reward). */
  signStyle?: 'classic' | 'lit';
  /** Bumped whenever fixtures or walls change, so the pathfinding grid is rebuilt. */
  layoutVersion: number;
  /** Abandoned baskets and mess on the floor. */
  litter: Litter[];
  sizeId: string;
  lotRows: number;
  /** Store-relative tiles where delivered boxes are stacked. */
  delivery: { x0: number; z0: number; x1: number; z1: number };
  /** The shop's colour scheme (an id from SHOP_SCHEMES). */
  scheme: string;
  /** The floor's finish (older saves: the checker lino). */
  floorStyle?: FloorStyle;
  /** The inside finish of the outer walls, stretch by stretch where it differs from `wallStyle` (keys from wallKey). Old saves had painted bands, said nowhere: written down on loading (bandsWrittenDown). */
  wallStyle?: WallStyle;
  wallStyles?: Record<string, WallStyle>;
  /** Windows bought for the side and back walls. */
  /** Old saves only: whole walls of windows, turned into Window pieces on load. */
  windows?: Partial<Record<WindowSide, boolean>>;
  /**
   * Ceiling panels, floor by floor: `ceilings[L]` holds the tiles (keys "x,z") with a panel over floor L.
   * A panel is also the floor of the storey above, so `ceilings[0]` is the first floor up. Old saves: none.
   */
  ceilings?: string[][];
  /** The lot, tile by tile (keys from lotKey): what is laid where it is not grass. */
  lotTiles?: Record<string, LotSurface>;
  /** Which parking bays are painted, by slot (see baySlots), in the order they were painted (`bays` follows it). Old saves: every slot of `lotRows` rows. */
  bayPlan?: number[];
}

/** What went wrong for shoppers today, counted as it happens (the night card's "why"). */
export interface Complaints {
  /** Wanted it and the shelf was bare (or it is not sold here), by product. */
  outOfStock: Record<string, number>;
  /** Put it back: too dear for them, by product. */
  pricey: Record<string, number>;
  /** Gave up waiting in line. */
  queue: number;
  /** Drove past a full lot. */
  lotFull: number;
  /** Walked in to a messy floor. */
  dirty: number;
}

export interface DayStats {
  day: number;
  revenue: number;
  cogs: number;
  rent: number;
  wages: number;
  utilities: number;
  other: number;
  loans: number;
  bills: number;
  /** What shoplifters got away with today, at cost (the shop paid for it, nobody paid it back). */
  theft: number;
  /** Shoplifters caught today, and the ones who got away. */
  caught?: number;
  escaped?: number;
  tax: number;
  customers: number;
  served: number;
  walkedOut: number;
  turnedAway: number;
  missedItems: number;
  itemsSold: number;
  satisfaction: number;
  satisfactionN: number;
  profit: number;
  endCash: number;
  complaints: Complaints;
  /** Shoppers at each store on the crossroads today ('player', a rival's id, or 'corner-<id>' for a bought corner), filled at close. */
  shoppers?: Record<string, number>;
  /** The player's customers today by type (counted as they arrive). */
  byType?: Record<CustomerType, number>;
  /** What the rivals watch, recorded at close: the player's price index, share of each type, and reputation. */
  mine?: { priceIndex: number; share: Record<CustomerType, number>; reputation: number };
  /** What the night card said about the goal and tomorrow, kept so every day's log can be read again in Stats. */
  log?: DayLogNotes;
}

export interface DayLogNotes {
  goal: { title: string; frac: number; delta: number; text: string; reward: string } | null;
  tomorrow: { weather: string | null; festival: string | null; rumours: string[]; sky?: Sky } | null;
}

export interface StoreScores { price: number; availability: number; layout: number; wait: number; parking: number; awareness: number }

export interface RivalState {
  id: string; name: string; kind: 'discount' | 'premium' | 'chain';
  opensDay: number; open: boolean;
  /** Their prices over the town average. */
  priceIndex: number;
  availability: number; quality: number; service: number; parking: number; awareness: number; reputation: number;
  saleDaysLeft: number; nextSaleDay: number;
  /** The corner it trades from, and the world point just outside its front door. */
  corner: CornerId;
  x: number; z: number;
  /** Shop size it builds (for its footprint and lot) and its parking bays, in world space. */
  sizeId: string; lotRows: number;
  bays: ParkingBay[];
  /** Branches off the map (MegaMart grows), shown as road signs. */
  stores: number; cash: number;
  branches: string[];
  /** Closing nights in a row with cash below zero (five and it shuts). */
  brokeDays: number;
  /** The day it closed for good: the corner is for sale until it is bought or a challenger moves in. */
  closedDay?: number;
  /** The day the player bought the corner: it trades as one of the player's branches. */
  boughtDay?: number;
  /** A challenger that took over an empty corner (its own colours). */
  challenger?: boolean;
  /** Moves made in answer to the player (each fades out by its last day). */
  responses?: RivalResponse[];
  /** The day this rival may make its next move, and per move. */
  cooldown?: number;
  moveCooldown?: Partial<Record<RivalMove, number>>;
  /** Today's effect of its moves on its own scores (recomputed each morning). */
  mods?: RivalMods;
  /** Closed for a renovation until this day (Fresh & Fine). */
  renovatingUntil?: number;
  /** A billboard site it holds (MegaMart). */
  billboard?: string;
  /** Yesterday's trade, from the daily P&L. */
  lastShoppers?: number;
  lastSales?: number;
  lastProfit?: number;
}

/** What a rival does in answer to the player. */
export type RivalMove = 'priceMatch' | 'renovation' | 'renovated' | 'tasting' | 'loyalty' | 'bigSale' | 'billboard' | 'longHours';
export interface RivalResponse { move: RivalMove; from: number; until: number }
/** A rival's moves added to its own scores: a lower price index, better quality and service, more awareness, fuller shelves. */
export interface RivalMods { price: number; quality: number; service: number; awareness: number; availability: number; saleDepth: number }

export interface Bill { id: number; name: string; amount: number; dueDay: number }
export interface Loan { id: number; offerId: string; name: string; principal: number; balance: number; dailyRate: number; daysLeft: number; takenDay: number }

export interface Campaign { id: number; kind: 'flyers'; areaId: string; startDay: number; strength: number }
export interface Promotion { kind: 'lossLeader' | 'buyTwo'; productId: string }
export interface AdTemplate { kind: 'product' | 'discount' | 'target'; productId?: string; percent?: number; target?: CustomerType }

export interface Franchise {
  /** siteId: one of OFFMAP_SITES, or `corner-<id>` for a rival's corner the player bought. */
  id: number; siteId: string; name: string; manager: Candidate; openedDay: number;
  /** On the crossroads: the corner it trades from (a bought rival building). */
  corner?: CornerId;
  stockLevel: number; reputation: number; cashToday: number;
  history: { day: number; customers: number; served: number; revenue: number; profit: number }[];
  alerts: string[];
}

/** "Too pricey", "Out of stock", "Long queue", "Great deal", "Love this place". */
export type ReactionKind = 'pricey' | 'outOfStock' | 'queue' | 'deal' | 'love' | 'ew' | 'thief';
export interface Reaction { id: number; personId: number; kind: ReactionKind; tick: number }

export interface Notice { day: number; text: string; kind: 'rival' | 'event' | 'money' | 'staff' | 'info' }

/** The shop's ladder of goals: one active at a time, checked as things happen and at close. */
export interface GoalState {
  /** Index of the active goal in GOALS (GOALS.length once the ladder is done). */
  index: number;
  done: { id: string; day: number }[];
  /** Rewards that unlock something: 'signLit', 'openingEvent', 'franchises'. */
  unlocked: string[];
  /** The day the active goal became active. */
  since: number;
  /** Closing nights in a row the active goal's daily test has passed (out-selling Cheapo). */
  run: number;
  /** The active goal's progress (0..1) when the day opened, for "today's change". */
  dayStart: number;
  /** The latest goal reached, for the celebration (the UI shows it once). */
  celebrate: { id: string; tick: number } | null;
  /** Owns the crossroads: the ending card has been earned (and shown). */
  champion: boolean;
  championSeen: boolean;
}

/** What tomorrow brings, rolled at close so the night card can say it, and applied when the day opens. */
export interface DayPlan {
  day: number;
  /** Demand multiplier from the weekday, festival, holiday, weather and any event. */
  eventDemand: number;
  weather: string | null;
  festival: string | null;
  /** A one-off event (road works, a blogger...): a surprise, not shown the night before. */
  event: { text: string; rep?: number; spoil?: boolean } | null;
  /** Notices that go up when the day opens (weekday, festival, holiday, weather). */
  notices: string[];
  rivals: { id: string; opens?: boolean; sale?: number; nextSaleDay?: number; branch?: boolean; move?: RivalMove; site?: string }[];
  /** What the town is saying tonight: "Cheapo is printing flyers...". */
  rumours: string[];
  /** The kind of sky the day has (from its forecast; older plans have none). */
  sky?: Sky;
}

export interface Popup { id: number; x: number; z: number; y: number; text: string; kind: 'money' | 'info' | 'bad'; tick: number }

export interface TutorialState {
  enabled: boolean;
  step: number;
  done: boolean;
  completed: string[];
  rewardsPaid: number;
}

export interface Unlocks { prices: boolean; stock: boolean; build: boolean; staff: boolean; marketing: boolean; stats: boolean; newBadges: string[] }

export type Difficulty = 'relaxed' | 'standard' | 'hard';

export interface GameState {
  version: number;
  seed: number;
  difficulty: Difficulty;
  sandbox: boolean;
  tick: number;
  day: number;
  /** Game seconds since 08:00. The store opens at 0 and closes at CLOSE_TIME. */
  time: number;
  /** Sim speed the player chose (1, 2, 4). The manager walks in real time whatever it is. */
  timeScale: number;
  /** setup: the shop is being fitted out; the clock is stopped and nobody shops until Open shop. */
  phase: 'picking' | 'setup' | 'open' | 'closing' | 'night';
  cash: number;
  shop: Shop;
  prices: Record<string, number>;
  people: Person[];
  cars: Car[];
  orders: Order[];
  today: DayStats;
  history: DayStats[];
  popups: Popup[];
  /** Short-lived reactions (what a shopper thinks), shown as icon bubbles over their head. Newest last; trimmed to a few. */
  reactions: Reaction[];
  tutorial: TutorialState;
  unlocks: Unlocks;
  nextId: number;
  rng: Record<string, number>;
  /** Pending sound cues emitted this tick (drained by the runtime). */
  sounds: string[];
  /** Count of stuck-watchdog rescues, for tests. */
  stuckRescues: number;
  /** Ambient traffic and walkers spawn timers. */
  spawn: { customer: number; traffic: number; walker: number };
  /** Price bands customers saw today, for the town-average comparison. */
  townAvgIndex: number;
  rivals: RivalState[];
  /** Shared parallel bays on Elm Street: anyone's customers may park there. */
  streetBays: ParkingBay[];
  /** Rival shoppers' spawn accumulator (visual only). */
  rivalSpawn: number;
  /** Rolling service measurements feeding the store scores. */
  scores: { avgWait: number; waitSum: number; waitSamples: number; last: StoreScores | null };
  notices: Notice[];
  /** Town demand before plot, awareness and reputation multipliers. */
  demandBase: number;
  /** Multiplier from holidays, weather and events. */
  eventDemand: number;
  market: { priceMul: Record<Category, number>; shortages: Record<string, number> };
  bills: Bill[];
  loans: Loan[];
  brokeDays: number;
  rescueOffered: boolean;
  gameOver: boolean;
  staffPool: Candidate[];
  rules: ManagerRules;
  /** Orders you saved, and when the manager should place them. */
  savedOrders?: SavedOrder[];
  marketing: { campaigns: Campaign[]; billboards: string[]; promotion: Promotion | null; ad: AdTemplate | null; outsideSign: boolean; openingEventDay?: number };
  franchises: Franchise[];
  goals: GoalState;
  /** Tomorrow, rolled at close (null during the day). */
  tomorrow: DayPlan | null;
  /** Today's sky: how the weather moves through the day follows from it (older saves have none: fair). */
  sky?: Sky;
  /** Town life: litter in the streets, teenagers hanging about, bumps on Main Road (made when first needed). */
  life?: TownLife;
  /** The shop's listing on the map app: reviews, stars, photos (older saves have none). */
  listing?: Listing;
}
