/* ---------------------------------------------------------------------------
   A thread's name, as a reader sees it.

   Titles written before autoTitle learned to strip markdown are still in the
   store — "# LOONG AUTONOMOUS BUILD MISSION ## Project: PIZZA DIMENSION" is a
   heading that arrived as a title. The store is not rewritten (a title the
   reader typed is theirs); it is normalised on the way to the screen, so old
   threads read correctly too.
   --------------------------------------------------------------------------- */

export function displayTitle(raw: string): string {
  const clean = raw
    .replace(/^\s*#{1,6}\s*/gm, '')
    /* '## Project:' glued after a sentence is still a heading; a lone # (C#)
       is not */
    .replace(/\s#{2,6}\s+/g, ' ')
    .replace(/\*\*|__|\*|_|`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  /* a heading that was ALL CAPS in markdown is still shouting */
  if (clean.length > 40 && clean === clean.toUpperCase()) {
    return clean.charAt(0) + clean.slice(1).toLowerCase()
  }
  return clean || raw.trim()
}
