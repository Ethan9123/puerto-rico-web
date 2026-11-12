'use strict';
// Synthetic fixtures only: no NN inference, training, network or user files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = fs.readFileSync(path.join(__dirname, '../tools/run_arm.sh'), 'utf8');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arm-input-regression-'));
function command(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {encoding: 'utf8', timeout: 15000, ...opts});
  assert.ifError(result.error);
  return result;
}
const fakeWorker = `
const fs = require('fs'), crypto = require('crypto');
const [nn, lo, s0, e0, file] = process.argv.slice(2), s = +s0, e = +e0;
fs.appendFileSync(process.env.CALLS, s + '\\n');
if (process.env.MUTATE_WHEN === 'worker') {
 if (process.env.REMOVE_INPUT === '1') fs.unlinkSync(process.env.INPUT);
 else fs.writeFileSync(process.env.INPUT, 'changed-model');
}
const text = Array.from({length:e-s}, (_,i)=>JSON.stringify({g:s+i})+'\\n').join('');
fs.writeFileSync(file, text);
fs.writeFileSync(file+'.done', JSON.stringify({rows:e-s,gStart:s,gEnd:e,sha256:crypto.createHash('sha256').update(text).digest('hex')}));
`;
function fixture(name, {knob = false, external = false, mutation = '', remove = false, crn = '1'} = {}) {
  const root = path.join(temp, name), engine = path.join(root, 'engine');
  fs.mkdirSync(path.join(engine, 'tools'), {recursive:true});
  fs.writeFileSync(path.join(engine, 'tools/run_arm.sh'), script);
  fs.writeFileSync(path.join(engine, 'tools/eval_paired_worker.js'), fakeWorker);
  fs.writeFileSync(path.join(engine, '.gitignore'), 'ignored-model.json\ndata/\n');
  const input = path.join(external ? root : engine, external ? 'external-model.json' : 'ignored-model.json');
  fs.writeFileSync(input, 'registered-model');
  for (const args of [['init','-q'],['add','.'],['-c','user.name=Offline Test','-c','user.email=offline@example.invalid','commit','-qm','fixture']]) {
    assert.equal(command('git', args, {cwd:engine}).status, 0);
  }
  const calls = path.join(root, 'calls');
  const env = {...process.env, TAG:'fixture', GAMES:'2', CHUNK:'1', JOBS:'1', ENGINE_ROOT:engine,
    NN:knob ? 'DEPLOY' : input, L6_KNOBS:knob ? JSON.stringify({__MCTS_VALUE_VNET__:input}) : '',
    MODS:'', EVAL_CRN:crn, EVAL_RP_K:'', L6_SOLVER:'', L6_SOLVER_CAP:'', STATUS:'0', ALLOW_DIRTY:'0',
    MAX_S_PER_GAME:'2', CALLS:calls, INPUT:input, MUTATE_WHEN:mutation, REMOVE_INPUT:remove?'1':'0'};
  // Mutate after finish_chunk's input check, either while validating output
  // or while copying output into the temporary merged file.
  if (mutation === 'merge' || mutation === 'publish') {
    const tool = mutation === 'merge' ? 'sha256sum' : 'cat';
    const original = command('which', [tool]).stdout.trim();
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    const hook = tool === 'cat' ? '[[ "$*" == *c-0-1.jsonl* ]]' : 'true';
    fs.writeFileSync(path.join(bin, tool), `#!/usr/bin/env bash\nif ${hook} && [ ! -f '${root}/changed' ]; then printf changed > "$INPUT"; touch '${root}/changed'; fi\nexec '${original}' "$@"\n`, {mode:0o755});
    env.PATH = bin + path.delimiter + env.PATH;
    env.GAMES = '1';
  }
  const result = command('bash', ['tools/run_arm.sh'], {cwd:engine,env});
  const output = path.join(engine,'data/paired/fixture');
  if (!mutation) {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(fs.existsSync(path.join(output,'merged.jsonl')));
    assert.equal(fs.readFileSync(calls,'utf8'), '0\n1\n');
  } else {
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.ok(!fs.existsSync(path.join(output,'merged.jsonl')), 'changed inputs must not publish merged output');
    if (mutation === 'worker') {
      assert.equal(fs.readFileSync(calls,'utf8'), '0\n', 'stop before dispatching a second chunk');
      assert.ok(!fs.existsSync(path.join(output,'c-0-1.jsonl.done')), 'in-flight drift invalidates acceptance');
      assert.ok(!fs.existsSync(path.join(output,'c-0-1.attempts')), 'input drift is not a worker failure');
    }
  }
}
try {
  fixture('stable');
  fixture('stable-no-crn', {crn:'0'});
  fixture('ignored-nn', {mutation:'worker'});
  fixture('external-knob', {knob:true,external:true,mutation:'worker'});
  fixture('deleted-nn', {mutation:'worker',remove:true});
  fixture('before-merge', {mutation:'merge'});
  fixture('before-publish', {mutation:'publish'});
  console.log('PASS run_arm input fingerprints: stable, changed/deleted NN, external knob, merge and publication gates');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
