/**
 * Money beyond the till: bills with terms, loans with interest, theft, payroll tax, and the
 * fail state. Everything here is applied at closing time.
 */
import type { GameState, Bill, Loan } from './types';
import { withRng, popup, cue } from './state';
import { doorOutside } from './people';

export const PAYROLL_TAX = 0.12;
export const CARD_FEE = 0.018;

export const LOAN_OFFERS: { id: string; name: string; amount: number; dailyRate: number; days: number }[] = [
  { id: 'small', name: 'Shopkeeper loan', amount: 600, dailyRate: 0.012, days: 10 },
  { id: 'medium', name: 'Growth loan', amount: 1800, dailyRate: 0.01, days: 15 },
  { id: 'large', name: 'Expansion loan', amount: 5000, dailyRate: 0.009, days: 20 },
];

export function takeLoan(state: GameState, offerId: string): string | null {
  const offer = LOAN_OFFERS.find((o) => o.id === offerId);
  if (!offer) return 'No such loan.';
  if (state.loans.length >= 2) return 'The bank will not lend more than two loans at once.';
  if (state.loans.some((l) => l.offerId === offer.id)) return 'You already have that loan.';
  const loan: Loan = { id: state.nextId++, offerId: offer.id, name: offer.name, principal: offer.amount, balance: offer.amount, dailyRate: offer.dailyRate, daysLeft: offer.days, takenDay: state.day };
  state.loans.push(loan);
  state.cash += offer.amount;
  state.notices.push({ day: state.day, text: `${offer.name}: +$${offer.amount}. Repaid over ${offer.days} days at ${(offer.dailyRate * 100).toFixed(1)}% a day.`, kind: 'money' });
  cue(state, 'cash');
  return null;
}

export function repayLoan(state: GameState, loanId: number, amount: number): string | null {
  const loan = state.loans.find((l) => l.id === loanId);
  if (!loan) return 'No such loan.';
  const pay = Math.min(amount, loan.balance, state.cash);
  if (pay <= 0) return 'Not enough cash.';
  loan.balance -= pay; state.cash -= pay;
  if (loan.balance <= 0.5) { state.loans = state.loans.filter((l) => l !== loan); state.notices.push({ day: state.day, text: `${loan.name} paid off.`, kind: 'money' }); }
  return null;
}

/** An invoice to pay in `days` days (bulk suppliers sell on terms). */
export function addBill(state: GameState, name: string, amount: number, days: number): void {
  const bill: Bill = { id: state.nextId++, name, amount: Math.round(amount * 100) / 100, dueDay: state.day + days };
  state.bills.push(bill);
}

/** Charges at close: loan instalments, due invoices, theft. Returns the total taken. */
export function closingCharges(state: GameState): { loans: number; bills: number; theft: number } {
  let loans = 0, bills = 0;
  for (const l of state.loans) {
    const interest = l.balance * l.dailyRate;
    const instalment = Math.min(l.balance + interest, l.principal / Math.max(1, l.daysLeft + 1) + interest);
    l.balance = Math.max(0, l.balance + interest - instalment);
    l.daysLeft = Math.max(0, l.daysLeft - 1);
    loans += instalment;
  }
  state.loans = state.loans.filter((l) => l.balance > 0.5);
  const due = state.bills.filter((b) => b.dueDay <= state.day);
  for (const b of due) bills += b.amount;
  state.bills = state.bills.filter((b) => b.dueDay > state.day);
  // Theft: a little shrink every day, less with staff on the floor.
  const staffOnFloor = state.people.filter((p) => p.kind === 'staff').length;
  const shrink = withRng(state, 'theft', (r) => (r.chance(0.35 - staffOnFloor * 0.08) ? r.range(0.004, 0.012) * Math.max(0, state.today.revenue) : 0));
  const theft = Math.round(shrink * 100) / 100;
  if (theft > 0) popup(state, doorOutside(state), `-$${theft.toFixed(2)} shoplifted`, 'bad', 1.5);
  state.cash -= loans + bills + theft;
  return { loans: Math.round(loans * 100) / 100, bills: Math.round(bills * 100) / 100, theft };
}

/** Upcoming money out, for the finance card. */
export function upcoming(state: GameState): { name: string; amount: number; day: number }[] {
  const out: { name: string; amount: number; day: number }[] = [];
  for (const b of state.bills) out.push({ name: b.name, amount: b.amount, day: b.dueDay });
  for (const l of state.loans) out.push({ name: `${l.name} instalment`, amount: Math.round((l.principal / Math.max(1, l.daysLeft + 1) + l.balance * l.dailyRate) * 100) / 100, day: state.day + 1 });
  return out.sort((a, b) => a.day - b.day);
}

/** Fail state: bills due and no cash for two closes in a row. One rescue loan is offered the first time. */
export function checkFailState(state: GameState): void {
  if (state.sandbox) return;
  if (state.cash < 0) {
    state.brokeDays++;
    if (state.brokeDays === 1 && !state.rescueOffered) {
      state.rescueOffered = true;
      state.notices.push({ day: state.day, text: 'You are out of cash. The bank offers one rescue loan; take it from the Money card before tomorrow night.', kind: 'money' });
    } else if (state.brokeDays >= 2) state.gameOver = true;
  } else state.brokeDays = 0;
}
