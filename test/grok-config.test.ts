import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { applyBudget, configNumbers, syncBudgetFile } from '../scripts/lib/grok-config.mts';
const budget = { tokens: 160000, percent: 32, models: ['active.model', 'new-model'] };
const directories: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-config-')); directories.push(dir);
  const input = path.join(dir, 'budget.json');
  fs.writeFileSync(input, JSON.stringify({compactionAtTokens:160000,contextWindowTokens:500000,models:budget.models}));
  return {dir,input,file:path.join(dir,'config.toml')};
}
afterEach(() => { for(const dir of directories.splice(0)) fs.rmSync(dir,{recursive:true,force:true}); });
describe('structural config numbers', () => {
  it('ignores comments, unrelated keys and inactive model tables', () => {
    const text='# compaction_at_tokens = 9\ncompaction_at_tokens = 8\ndefault_model = "active.model"\n[model.inactive]\ncompaction_at_tokens = 7\n[session]\nauto_compact_threshold_percent = 32\n[model."active.model"]\ncompaction_at_tokens = 160000\n';
    expect(configNumbers(text)).toEqual({tokens:160000,pct:32});
    expect(configNumbers(text,'inactive')).toEqual({tokens:7,pct:32});
    expect(configNumbers(text,'unknown')).toEqual({tokens:null,pct:32});
    expect(configNumbers('[model.only]\ncompaction_at_tokens=123\n')).toEqual({tokens:null,pct:null});
  });
  it('supports quoted and inline keys without inventing model.default', () => {
    expect(configNumbers('"session"={"auto_compact_threshold_percent"=40}\nmodel={"x.y"={"compaction_at_tokens"=200000}}\n','x.y')).toEqual({tokens:200000,pct:40});
    expect(configNumbers('model.default="x"\nmodel.x.compaction_at_tokens=2\n')).toEqual({tokens:null,pct:null});
  });
  it('rejects malformed and duplicate TOML without leaking source', () => {
    for(const text of ['secret = "not closed', '[session]\nx=1\nx=2\n']) expect(()=>configNumbers(text)).toThrow('Invalid TOML configuration');
  });
});
describe('comment-preserving structural budget edits', () => {
  it('changes numeric value ranges only and keeps inactive values', () => {
    const text='# auto_compact_threshold_percent = 85\n[session]\nauto_compact_threshold_percent = 90 # preserve percent comment\n[model.inactive]\ncompaction_at_tokens = 9 # inactive\n[model."active.model"]\ncompaction_at_tokens = 1_000 # preserve token comment\n';
    const next=applyBudget(text,budget);
    expect(next).toContain('# auto_compact_threshold_percent = 85');
    expect(next).toContain('auto_compact_threshold_percent = 32 # preserve percent comment');
    expect(next).toContain('compaction_at_tokens = 160000 # preserve token comment');
    expect(next).toContain('compaction_at_tokens = 9 # inactive');
    expect(configNumbers(next,'active.model')).toEqual({tokens:160000,pct:32});
    expect(configNumbers(next,'new-model')).toEqual({tokens:160000,pct:32});
    expect(applyBudget(next,budget)).toBe(next);
  });
  for(const [name,text] of [
    ['quoted table','["session"]\nload_envrc=true\n["model"."active.model"]\nextra=true\n'],
    ['root dotted','session.load_envrc=true\nmodel."active.model".extra=true\n'],
    ['nested inline','session={load_envrc=true}\nmodel={"active.model"={extra=true}}\n'],
    ['inline dotted','session={load_envrc=true}\nmodel={"active.model".extra=true}\n'],
    ['explicit parent','[session]\nload_envrc=true\n[model]\n"active.model".extra=true\n'],
    ['implicit parent','[session.ui]\ncolor="blue"\n[model."active.model".ui]\ncolor="blue"\n'],
    ['empty inline','session={}\nmodel={}\n'],
    ['empty document',''],
  ]) it(`inserts missing keys/tables in ${name}`,()=>{
    const next=applyBudget(text,budget);
    for(const model of budget.models) expect(configNumbers(next,model)).toEqual({tokens:160000,pct:32});
    expect(applyBudget(next,budget)).toBe(next);
  });
  it('supports model identifiers requiring quoted escaping',()=>{
    const model='model "quoted" \\ segment';
    const next=applyBudget('',{...budget,models:[model]});
    expect(configNumbers(next,model)).toEqual({tokens:160000,pct:32});
  });
  it('refuses conflicting scalar tables and wrong value types',()=>{
    expect(()=>applyBudget('session="secret"\n',budget)).toThrow('non-table ancestor');
    expect(()=>applyBudget('[session]\nauto_compact_threshold_percent="secret"\n',budget)).toThrow('numeric');
  });
});
describe('private atomic budget writes',()=>{
  it('creates private config, validates readback, and is idempotent',()=>{
    const f=fixture();syncBudgetFile(f.input,f.file);
    const before=fs.statSync(f.file);const body=fs.readFileSync(f.file,'utf8');
    expect(before.mode&0o777).toBe(0o600);
    syncBudgetFile(f.input,f.file);
    expect(fs.statSync(f.file).ino).toBe(before.ino);
    expect(fs.readFileSync(f.file,'utf8')).toBe(body);
    expect(fs.existsSync(`${f.file}.lock`)).toBe(false);
  });
  it('leaves malformed config bytes untouched and releases the lock',()=>{
    const f=fixture();const body='api_key="synthetic"\n[broken';fs.writeFileSync(f.file,body);
    expect(()=>syncBudgetFile(f.input,f.file)).toThrow('Invalid TOML');
    expect(fs.readFileSync(f.file,'utf8')).toBe(body);expect(fs.existsSync(`${f.file}.lock`)).toBe(false);
  });
  it('refuses an active writer lock without modifying config',()=>{
    const f=fixture();fs.writeFileSync(f.file,'# original\n');fs.writeFileSync(`${f.file}.lock`,'active');
    expect(()=>syncBudgetFile(f.input,f.file)).toThrow('lock');expect(fs.readFileSync(f.file,'utf8')).toBe('# original\n');
    expect(fs.readFileSync(`${f.file}.lock`,'utf8')).toBe('active');
  });
  it('refuses config symlinks and parent symlinks before creating children',()=>{
    const f=fixture();const target=path.join(f.dir,'target');fs.writeFileSync(target,'# untouched\n');fs.symlinkSync(target,f.file);
    expect(()=>syncBudgetFile(f.input,f.file)).toThrow();expect(fs.readFileSync(target,'utf8')).toBe('# untouched\n');
    const outside=path.join(f.dir,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.dir,'linked'));
    expect(()=>syncBudgetFile(f.input,path.join(f.dir,'linked/new/config.toml'))).toThrow('non-symlink');expect(fs.existsSync(path.join(outside,'new'))).toBe(false);
  });
  it('detects an external edit before atomic replacement',()=>{
    const f=fixture();fs.writeFileSync(f.file,'# initial\n');
    const preload=path.join(f.dir,'race.cjs');
    fs.writeFileSync(preload,`const fs=require('node:fs');const original=fs.fsyncSync;let edited=false;fs.fsyncSync=function(fd){if(!edited){edited=true;fs.writeFileSync(process.env.TEST_CONFIG,'# external edit\\n');}return original.call(this,fd);};`);
    const child=spawnSync(process.execPath,['--require',preload,path.resolve('scripts/sync-grok-token-budget.js'),f.input,f.file],{encoding:'utf8',env:{...process.env,TEST_CONFIG:f.file}});
    expect(child.status).toBe(1);expect(child.stderr).toContain('changed during write');expect(fs.readFileSync(f.file,'utf8')).toBe('# external edit\n');
    expect(fs.existsSync(`${f.file}.lock`)).toBe(false);expect(fs.readdirSync(f.dir).some(name=>name.endsWith('.tmp'))).toBe(false);
  });
});
