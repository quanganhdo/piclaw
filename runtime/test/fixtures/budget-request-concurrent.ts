import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { writeFileSync, existsSync } from 'node:fs';
import { reserveBudgetRequest } from '../../src/db/budget-request-reservations.js';
const [path, marker, release, id] = process.argv.slice(2);
assert(path && marker && release && id);
const db = new Database(path);
db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
writeFileSync(marker,'ready');
const deadline = Date.now()+3000;
while(!existsSync(release)){if(Date.now()>=deadline)throw Error('Fixture barrier deadline');await Bun.sleep(5);}
const binding = { id, workId: 'concurrent-child', chatJid: 'web:concurrent-child', providerId: 'fixture', modelId: 'fixture-model', accountRef: 'fixture-account', amountMicros: 60 };
let accepted = false;
try { reserveBudgetRequest(binding,{},db); accepted=true; } catch(error) { assert.equal((error as {code?:string}).code,'budget_denied'); }
assert.equal((db.query('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode,'wal');
db.close(); console.log(JSON.stringify({accepted,id}));
