/* ===========================================================================
   The mark and the creature now live in one place: Dragon.tsx. This module is a
   thin re-export so the older `import { Mark } from './Mark'` sites keep working
   without a second, divergent copy of the drawing. One source, one ink.
   =========================================================================== */

export { Mark, Dragon, Working, Logo } from './Dragon'
/** `Creature` was the earlier name for the animal; kept as an alias. */
export { Dragon as Creature } from './Dragon'
