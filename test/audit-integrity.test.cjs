const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const audit = path.join(root, 'skills/exhaustive-audit/scripts');
const redundancy = path.join(root, 'skills/redundancy-scan/scripts');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-integrity-'));
let checks = 0;
function write(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, value); return file; }
function jsonl(file, rows) { return write(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')); }
function readRows(file) { return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); }
function run(script, args=[], env={}) { return spawnSync(process.execPath, [script, ...args], {encoding:'utf8', env:{...process.env,...env}}); }
function expect(result, status, label) { checks++; assert.equal(result.status, status, `${label}\n${result.stdout}\n${result.stderr}`); }
function inventory(scope, destination) {
  const file = path.join(destination,'manifest.jsonl');
  expect(run(path.join(audit,'manifest-build.js'),['--root',scope,'--out',file]),0,'build valid inventory');
  return {file, rows:readRows(file)};
}
function receipt(row, overrides={}) { return {path:row.path,status:'verified',agent:'test-reviewer',manifest_lines:row.lines,
  lines_read:row.lines===null?undefined:row.lines===0?[0,0]:[1,row.lines],read_sha256:row.sha256,...overrides}; }
try {
  const scope=path.join(temp,'source');write(path.join(scope,'a.ts'),'line one\nline two\n');
  const inv=inventory(scope,path.join(temp,'run'));const row=inv.rows[0];const ledger=path.join(temp,'run/ledger/coverage.jsonl');
  const gate=(rows,extra=[])=>{jsonl(ledger,rows);return run(path.join(audit,'coverage-status.js'),['--manifest',inv.file,'--ledger',ledger,...extra]);};
  expect(gate([receipt(row)]),0,'valid snapshot-backed full read');
  expect(run(path.join(audit,'coverage-status.js'),['--manifest',path.join(temp,'absent'),'--ledger',ledger]),1,'missing manifest fails');
  const empty=jsonl(path.join(temp,'empty.jsonl'),[]);
  expect(run(path.join(audit,'coverage-status.js'),['--manifest',empty,'--ledger',path.join(temp,'empty-ledger')]),1,'empty scope needs authorization');
  expect(run(path.join(audit,'coverage-status.js'),['--manifest',empty,'--ledger',path.join(temp,'empty-ledger'),'--allow-empty']),0,'explicit empty scope');
  for (const span of [[2,3],[0,1],[-1,0],[1,1],[1,3],[2,1],[1.5,2.5],['1',2],[1,'2'],[null,2],[1,null],[1],[1,2,3],null,{},undefined]) {
    expect(gate([receipt(row,{lines_read:span})]),1,`invalid full-read span ${JSON.stringify(span)}`);
  }
  for (const status of ['finding','waived','blocked','skipped-generated','review-required']) {
    expect(gate([receipt(row,{status})]),1,`${status} cannot bypass evidence`);
  }
  expect(gate([receipt(row,{status:'blocked',reason:'permission denied'})]),1,'accounted blocker is incomplete');
  expect(gate([receipt(row,{status:'finding',finding_ids:['missing']})]),1,'dangling finding reference');
  jsonl(path.join(temp,'run/ledger/findings.jsonl'),[{id:'F-1',path:'elsewhere.ts'}]);
  expect(gate([receipt(row,{status:'finding',finding_ids:['F-1']})]),1,'finding must apply to receipt path');
  jsonl(path.join(temp,'run/ledger/findings.jsonl'),[{id:'F-1',path:row.path}]);
  expect(gate([receipt(row,{status:'finding',finding_ids:['F-1']})]),0,'resolved finding and full read');
  expect(gate([receipt(row,{status:'finding',finding_ids:['F-1'],lines_read:undefined})]),1,'finding still requires full read');
  expect(gate([receipt(row,{status:'waived',waiver:{owner:'owner',reason:'recorded disposition'}})]),0,'reviewed owner waiver');
  const allow=write(path.join(temp,'generated.json'),JSON.stringify([row.path]));
  expect(gate([receipt(row,{status:'skipped-generated',generated_evidence:'generator output independently checked'})],['--generated-allowlist',allow]),0,'explicit generated evidence');
  expect(gate([receipt(row,{status:'historical-ok',review_evidence:'dated release record independently reviewed'})]),1,'code mode rejects markdown disposition');
  expect(gate([receipt(row,{status:'historical-ok',review_evidence:'dated release record independently reviewed'})],['--mode','md-truth']),0,'reviewed markdown disposition');
  expect(gate([receipt(row,{status:'historical-ok'})],['--mode','md-truth']),1,'markdown status alone is insufficient');
  for(const hash of [undefined,null,'',7,{},'f'.repeat(64)]) expect(gate([receipt(row,{read_sha256:hash,sha256:row.sha256})]),1,'hash mandatory without opt-in or legacy fallback');
  expect(gate([receipt(row)],['--check-hash']),0,'legacy flag remains safe alias');
  const blob=path.resolve(path.dirname(inv.file),row.snapshot);const original=fs.readFileSync(blob);write(blob,'tampered');
  expect(gate([receipt(row)]),1,'corrupt snapshot blocks coverage');write(blob,original);
  write(path.join(scope,'a.ts'),'later source\n');expect(gate([receipt(row)]),0,'pinned snapshot survives live source changes');
  jsonl(inv.file,[row,row]);expect(gate([receipt(row)]),1,'duplicate inventory paths rejected');jsonl(inv.file,[row]);
  const emptyScope=path.join(temp,'empty-source');write(path.join(emptyScope,'empty.ts'),'');
  const emptyInv=inventory(emptyScope,path.join(temp,'empty-run'));jsonl(ledger,[receipt(emptyInv.rows[0])]);
  expect(run(path.join(audit,'coverage-status.js'),['--manifest',emptyInv.file,'--ledger',ledger]),0,'empty file exact zero range');
  const binScope=path.join(temp,'binary-source');write(path.join(binScope,'a.bin'),Buffer.from([0,1,2]));
  const binInv=inventory(binScope,path.join(temp,'binary-run'));jsonl(ledger,[receipt(binInv.rows[0])]);
  expect(run(path.join(audit,'coverage-status.js'),['--manifest',binInv.file,'--ledger',ledger]),1,'binary requires review method');
  jsonl(ledger,[receipt(binInv.rows[0],{review_method:'format and bytes inspected'})]);
  expect(run(path.join(audit,'coverage-status.js'),['--manifest',binInv.file,'--ledger',ledger]),0,'binary review method');

  const missingFleet=path.join(temp,'missing-fleet');write(path.join(missingFleet,'a/one.ts'),'one\n');
  expect(run(path.join(audit,'manifest-build.js'),['--root',missingFleet,'--fleet','--repos','a,b','--out',path.join(temp,'missing-fleet-run/manifest.jsonl')]),1,'missing explicitly declared fleet component');
  expect(run(path.join(audit,'manifest-build.js'),['--root',missingFleet,'--fleet','--out',path.join(temp,'default-fleet-run/manifest.jsonl')]),1,'missing default declared fleet components');
  expect(run(path.join(audit,'open-run.js'),['--root',missingFleet,'--fleet','--repos','a,b','--slug','missing','--out',path.join(temp,'missing-open')]),1,'open-run rejects incomplete fleet');
  assert(!fs.existsSync(path.join(temp,'missing-open/AUDIT-RUN.yml')));
  const links=path.join(temp,'links');write(path.join(links,'regular.ts'),'source\n');fs.symlinkSync('regular.ts',path.join(links,'valid.ts'));fs.symlinkSync('missing.ts',path.join(links,'broken.ts'));
  const linkInv=inventory(links,path.join(temp,'links-run'));assert.equal(linkInv.rows.length,3);assert.equal(linkInv.rows.filter(x=>x.kind==='symlink').length,2);
  const denied=path.join(links,'denied');write(path.join(denied,'hidden.ts'),'private fixture');fs.chmodSync(denied,0);
  try { expect(run(path.join(audit,'manifest-build.js'),['--root',links,'--out',path.join(temp,'denied-run/manifest.jsonl')]),1,'unreadable directory fails inventory'); }
  finally { fs.chmodSync(denied,0o700); }

  for(const [name,relative,flag] of [['w1-auto-class-md.js','pkg/archive/old.md','--manifest'],['w4-jv-present-md.js','.jv/.claude/rules/security.md','--manifest'],['w5-homes-md.js','grok-home/rules/security.md','--manifest-grok']]) {
    const source=path.join(temp,name,'source');write(path.join(source,relative),name.startsWith('w1')?'':'Unverified security claim.\n');
    const m=inventory(source,path.join(temp,name,'run'));const led=path.join(temp,name,'ledger.jsonl');
    expect(run(path.join(audit,name),[flag,m.file,'--ledger',led]),0,'classifier produces candidates');
    const candidate=readRows(led)[0];assert.equal(candidate.status,'review-required');assert.equal(candidate.mechanical_lines,m.rows[0].lines);assert.equal(candidate.lines_read,undefined);assert.equal(candidate.read_sha256,undefined);
    expect(run(path.join(audit,'coverage-status.js'),['--manifest',m.file,'--ledger',led,'--mode','md-truth']),1,'candidate cannot close audit');
    jsonl(m.file,[{...m.rows[0],lines:100}]);expect(run(path.join(audit,name),[flag,m.file,'--ledger',led]),1,'classifier refuses invented manifest span');
  }
  const fleet=path.join(temp,'fleet');for(const repo of ['alpha','beta']) { write(path.join(fleet,repo,'shared.ts'),'export const shared = true;\n');write(path.join(fleet,repo,'marker.ts'),'// @deprecated\n'); }
  const scan=path.join(temp,'scan');expect(run(path.join(redundancy,'run-scan.js'),['--root',fleet,'--fleet','--out-dir',scan]),0,'fleet scan');
  const found=readRows(path.join(scan,'findings.jsonl'));
  assert(found.some(x=>x.class==='exact-duplicate'&&x.paths.includes('alpha/shared.ts')&&x.paths.includes('beta/shared.ts')));
  assert(found.some(x=>x.class==='basename-collision'&&x.paths.includes('alpha/shared.ts')&&x.paths.includes('beta/shared.ts')));
  assert.equal(new Set(found.map(x=>x.id)).size,found.length);
  const scan2=path.join(temp,'scan2');expect(run(path.join(redundancy,'run-scan.js'),['--root',fleet,'--fleet','--out-dir',scan2]),0,'repeat scan');
  assert.deepEqual(found.map(x=>x.id).sort(),readRows(path.join(scan2,'findings.jsonl')).map(x=>x.id).sort());
  expect(run(path.join(redundancy,'run-scan.js'),['--root',path.join(temp,'absent'),'--out-dir',path.join(temp,'missing-out')]),1,'missing root fails');
  expect(run(path.join(redundancy,'merge-report.js'),['--inputs',path.join(temp,'absent'),'--out-dir',path.join(temp,'missing-merge')]),1,'missing detector input fails');
  const duplicate=jsonl(path.join(temp,'duplicate.jsonl'),[found[0],found[0]]);
  expect(run(path.join(redundancy,'merge-report.js'),['--inputs',duplicate,'--out-dir',path.join(temp,'duplicate-merge')]),1,'duplicate finding IDs fail merge');
  const unreadable=path.join(fleet,'alpha/secret.ts');write(unreadable,'synthetic fixture');fs.chmodSync(unreadable,0);
  try { expect(run(path.join(redundancy,'run-scan.js'),['--root',fleet,'--fleet','--out-dir',path.join(temp,'unreadable-scan')]),1,'read errors fail scan'); }
  finally {fs.chmodSync(unreadable,0o600);}
  const planRoot=path.join(temp,'plan');fs.mkdirSync(planRoot);const names=['my.app','a b','a-b'];const pm=jsonl(path.join(planRoot,'m.jsonl'),names.map(repo=>({repo,path:`${repo}/x.ts`,lines:1})));
  expect(run(path.join(audit,'shard-plan.js'),['--manifest',pm,'--out',path.join(planRoot,'shards.json'),'--by-repo']),0,'build arbitrary repo IDs');
  const shards=JSON.parse(fs.readFileSync(path.join(planRoot,'shards.json'),'utf8')).shards;assert.equal(new Set(shards.map(x=>x.id)).size,3);
  for(const shard of shards) expect(run(path.join(audit,'claim-shard.js'),['--run',planRoot,'--shard',shard.id,'--agent','test']),0,'all generated shard IDs claimable');
  const arc=path.join(temp,'archive');const mr=path.join(arc,'audits/review');const mi=inventory(scope,mr);const ml=path.join(mr,'ledger/coverage.jsonl');jsonl(ml,mi.rows.map(x=>receipt(x)));
  expect(run(path.join(audit,'md-truth-check.js'),['--coverage','--run','review'],{REVEALFLEET_ARCHIVE:arc}),1,'missing expected homes fails');
  expect(run(path.join(audit,'md-truth-check.js'),['--coverage','--run','review','--components','fleet'],{REVEALFLEET_ARCHIVE:arc}),0,'explicit fleet-only scope');
  console.log(`PASS ${checks} CLI checks plus grouping, identity, snapshot, and candidate assertions (F-AUD-001..012)`);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
