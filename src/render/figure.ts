/**
 * How big people are drawn, against the character models as they come: a little smaller, so they sit right in the
 * shop's scale (shelves, doors, cars). Drawing only: where people stand and walk is the same either way.
 */
export const FIGURE = 0.85;

/** How tall someone is drawn: their look's height, at the figure's scale. */
export const statureOf = (look: { height: number }): number => FIGURE * look.height;
