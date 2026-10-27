/* Every test process gets a throwaway data directory before any server module
   is imported. config.ts reads LOONG_DATA_DIR at import time, so a test that
   forgets to set it — or imports too early — used to read and write the real
   ~/.loong: sessions, memory, hook trust, journals. A test suite that needs
   the user's data to pass is not a test suite. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.LOONG_DATA_DIR) {
  process.env.LOONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'loong-test-data-'))
}
