/* ---------------------------------------------------------------------------
   A stub for the BiDi transport playwright-core never uses here.

   playwright-core bundles a WebDriver-BiDi transport for Firefox and remote
   WebDriver sessions. Loong launches the machine's own Chromium over CDP, so
   those code paths never run — but their `require` sits at the top of
   playwright's bundle, and a bundler must resolve it or fail.

   esbuild aliases the package to this file. If a BiDi path is ever taken by
   accident, it fails with this clear message instead of a module-not-found
   from inside a 40,000-line bundle.
   --------------------------------------------------------------------------- */

const notUsed = () => {
  throw new Error(
    'Loong drives Chromium over CDP; the WebDriver-BiDi transport is not part of this build.',
  )
}

export class BidiMapper {
  constructor() {
    notUsed()
  }
}

export class CdpConnection {
  constructor() {
    notUsed()
  }
}
