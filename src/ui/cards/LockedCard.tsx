export function LockedCard({ what, blurb }: { what: string; blurb: string }) {
  return (
    <>
      <h3>{what} is not open yet</h3>
      <p>{blurb}</p>
      <p className="muted">You will see a "New!" badge on the button when it unlocks.</p>
    </>
  );
}
