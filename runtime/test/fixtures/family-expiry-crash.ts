import Database from "bun:sqlite";
import { recoverExpiredFamilyScheduledExecutions } from "../../src/db/family-scheduled-executions.js";

// Parent supplies only a disposable copied test database, server clock and crash phase.
const [path,clock,phase]=process.argv.slice(2);
if(!path||!clock||!['before-commit','after-commit'].includes(phase!))throw Error('Invalid crash fixture');
Date.now=()=>Number(clock);
const database=new Database(path);
database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
const hold=()=>{process.stdout.write('EXPIRY_CRASH_READY\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
if(phase==='before-commit')database.transaction(()=>{recoverExpiredFamilyScheduledExecutions(database);hold();}).immediate();
else{recoverExpiredFamilyScheduledExecutions(database);hold();}
