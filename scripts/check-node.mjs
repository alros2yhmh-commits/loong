const major = Number(process.versions.node.split('.')[0])
if (major !== 24) {
  console.error(`Loong development requires Node.js 24 LTS; found ${process.versions.node}. Install Node 24 and run npm ci again.`)
  process.exit(1)
}
