import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
import {admitSqliteWrite} from '../../src/db/sqlite-async-admission.js';

async function fixture(run:(db:Database,blocker:Database)=>Promise<void>){
  const ws=createTempWorkspace('async-admission-');const path=join(ws.base,'fixture.db');
  const db=new Database(path);db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE input(value TEXT)');const blocker=new Database(path);
  try{await run(db,blocker);}finally{blocker.close();db.close();ws.cleanup();}
}
const count=(db:Database)=>(db.query('SELECT count(*) AS n FROM input').get() as {n:number}).n;
const timeout=(db:Database)=>(db.query('PRAGMA busy_timeout').get() as {timeout:number}).timeout;

test('contended admission yields while locked and commits once only after release',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');let auth=0,operations=0;
  const pending=admitSqliteWrite(db,()=>{operations++;db.query('INSERT INTO input VALUES(?)').run('one');return 7;},()=>{auth++;},new AbortController().signal);
  await Bun.sleep(10);expect(operations).toBe(0);expect(timeout(db)).toBe(5000);expect(count(db)).toBe(0);
  blocker.exec('ROLLBACK');expect(await pending).toBe(7);expect(count(db)).toBe(1);expect(operations).toBe(1);expect(auth).toBe(2);expect(timeout(db)).toBe(5000);
}));
test('cancelled or revoked admission never writes or publishes success',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');const controller=new AbortController();
  const pending=admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('cancelled')"),()=>{},controller.signal);await Bun.sleep(0);controller.abort(Error('cancelled'));await expect(pending).rejects.toThrow('cancelled');blocker.exec('ROLLBACK');expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
  blocker.exec('BEGIN IMMEDIATE');let allowed=true;
  const revoked=admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('revoked')"),()=>{if(!allowed)throw Error('revoked');},new AbortController().signal);await Bun.sleep(0);allowed=false;blocker.exec('ROLLBACK');await expect(revoked).rejects.toThrow('revoked');expect(count(db)).toBe(0);
}));
test('deadline is bounded and all errors restore connection policy and rollback',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');const start=performance.now();
  await expect(admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('late')"),()=>{},new AbortController().signal,30)).rejects.toThrow();expect(performance.now()-start).toBeLessThan(500);expect(timeout(db)).toBe(5000);blocker.exec('ROLLBACK');expect(count(db)).toBe(0);
  await expect(admitSqliteWrite(db,()=>{db.exec("INSERT INTO input VALUES('bad')");throw Error('unrelated');},()=>{},new AbortController().signal)).rejects.toThrow('unrelated');expect(count(db)).toBe(0);expect(timeout(db)).toBe(5000);
  let checks=0;await expect(admitSqliteWrite(db,()=>db.exec("INSERT INTO input VALUES('post-revoke')"),()=>{if(++checks===2)throw Error('post-revoked');},new AbortController().signal)).rejects.toThrow('post-revoked');expect(count(db)).toBe(0);
}));
test('concurrent read-modify-write retries see fresh committed state without lost updates',async()=>fixture(async(db,blocker)=>{
  blocker.exec('BEGIN IMMEDIATE');const signal=new AbortController().signal;
  const append=(value:string)=>admitSqliteWrite(db,()=>{const before=count(db);db.query('INSERT INTO input VALUES(?)').run(`${before}:${value}`);},()=>{},signal);
  const first=append('a'),second=append('b');await Bun.sleep(0);blocker.exec('ROLLBACK');await Promise.all([first,second]);
  expect(count(db)).toBe(2);expect(db.query('SELECT value FROM input ORDER BY rowid').all()).toEqual([{value:'0:a'},{value:'1:b'}]);expect(timeout(db)).toBe(5000);
}));
