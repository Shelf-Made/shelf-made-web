import type { Category } from './products';

export interface Vec2 { x: number; z: number }

/** Rotation in quarter turns, 0 = facing +z (south, toward the camera). */
export type Rot = 0 | 1 | 2 | 3;

export type FixtureType = 'register' | 'shelf' | 'fridge' | 'freezer' | 'produce' | 'endcap' | 'kiosk' | 'rack' | 'sign' | 'plant' | 'bench' | 'basketStack';

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
}

export type CustomerType = 'bargain' | 'convenience' | 'loyalist' | 'impulse';

export type PersonState =
  | 'driving' | 'toDoor' | 'entering' | 'shopping' | 'browsing' | 'toQueue' | 'queued' | 'paying' | 'leaving' | 'toCar' | 'walking' | 'gone'
  | 'idle' | 'toStock' | 'pickBox' | 'carrying' | 'stocking' | 'toRegister' | 'working';

export type Anim = 'idle' | 'walk' | 'browse' | 'carry' | 'pay' | 'sit';

export interface Person {
  id: number;
  kind: 'customer' | 'staff' | 'walker' | 'owner';
  /** Which mesh and recolour variant the renderer uses. */
  look: { model: number; variant: number; height: number; dog?: boolean };
  x: number; z: number; yaw: number;
  px: number; pz: number;
  state: PersonState;
  anim: Anim;
  path: Vec2[];
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
}

export type StaffRole = 'cashier' | 'stocker' | 'cleaner' | 'orderer' | 'manager';
export type CardId = 'stock' | 'prices' | 'build' | 'staff' | 'marketing' | 'stats' | 'settings' | null;

export interface Candidate { id: number; name: string; role: StaffRole; skill: number; speed: number; wage: number; look: { model: number; variant: number; height: number } }
export interface ManagerRules { reorderPoint: number; spendCap: number; priceMin: number; priceMax: number; wageCap: number; adBudget: number }
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
  state: CarState;
  bay: number | null;
  ownerId: number | null;
  timer: number;
  /** Delivery trucks: the order they carry. */
  orderId?: number;
  /** Backing out of a bay: the car moves along its path facing the other way. */
  reversing?: boolean;
  /** The path to follow once the car has backed out. */
  next?: Vec2[];
  /** Seconds spent held up behind another car (breaks rare deadlocks). */
  waited?: number;
  /** Waiting at a junction for a gap in the traffic. */
  yielding?: boolean;
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
}

export interface StockEntry { productId: string; qty: number; /** day received, for spoilage */ day: number }

export interface Plot {
  id: string;
  name: string;
  blurb: string;
  /** World x of the plot centre (the store origin). Plots sit on the north side of the main road. */
  x: number;
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
  /** Interior bounds in store-relative tiles. */
  floor: { x0: number; z0: number; x1: number; z1: number };
  storeroom: { x0: number; z0: number; x1: number; z1: number };
  door: Vec2;
  backDoor: Vec2;
  fixtures: Fixture[];
  storage: StockEntry[];
  storageCapacity: number;
  bays: ParkingBay[];
  reputation: number;
  awareness: number;
  cleanliness: number;
  /** Bumped whenever fixtures or walls change, so the pathfinding grid is rebuilt. */
  layoutVersion: number;
  /** Abandoned baskets and mess on the floor. */
  litter: Litter[];
  sizeId: string;
  lotRows: number;
  /** Store-relative tiles where delivered boxes are stacked. */
  delivery: { x0: number; z0: number; x1: number; z1: number };
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
  theft: number;
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
}

export interface StoreScores { price: number; availability: number; layout: number; wait: number; parking: number; awareness: number }

export interface RivalState {
  id: string; name: string; kind: 'discount' | 'premium' | 'chain';
  opensDay: number; open: boolean;
  /** Their prices over the town average. */
  priceIndex: number;
  availability: number; quality: number; service: number; parking: number; awareness: number; reputation: number;
  saleDaysLeft: number; nextSaleDay: number;
  x: number; z: number;
  stores: number; cash: number;
}

export interface Bill { id: number; name: string; amount: number; dueDay: number }
export interface Loan { id: number; offerId: string; name: string; principal: number; balance: number; dailyRate: number; daysLeft: number; takenDay: number }

export interface Campaign { id: number; kind: 'flyers'; areaId: string; startDay: number; strength: number }
export interface Promotion { kind: 'lossLeader' | 'buyTwo'; productId: string }
export interface AdTemplate { kind: 'product' | 'discount' | 'target'; productId?: string; percent?: number; target?: CustomerType }

export interface Franchise {
  id: number; plotId: string; name: string; manager: Candidate; openedDay: number;
  stockLevel: number; reputation: number; cashToday: number;
  history: { day: number; customers: number; served: number; revenue: number; profit: number }[];
  alerts: string[];
}

export interface Notice { day: number; text: string; kind: 'rival' | 'event' | 'money' | 'staff' | 'info' }

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
  marketing: { campaigns: Campaign[]; billboards: string[]; promotion: Promotion | null; ad: AdTemplate | null; outsideSign: boolean };
  franchises: Franchise[];
}
