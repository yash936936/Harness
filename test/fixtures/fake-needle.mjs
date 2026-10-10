// Stand-in for a Needle wrapper (the stdio contract in router/backends.ts). argv[2] = mode.
const mode = process.argv[2]
let buf = ''
process.stdin.on('data', (d) => (buf += d))
process.stdin.on('end', () => {
  const req = JSON.parse(buf.trim())
  if (mode === 'hang') return setInterval(() => {}, 1000)
  if (mode === 'invalid') return console.log('not json')
  if (mode === 'invented') return console.log(JSON.stringify({ choice: 'rm_everything' }))
  if (mode === 'abstain') return console.log(JSON.stringify({ choice: null }))
  console.log(JSON.stringify({ choice: req.candidates[req.candidates.length - 1].id, seen: req.candidates.map((c) => c.id) }))
})
