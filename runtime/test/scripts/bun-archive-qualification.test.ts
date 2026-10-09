import { expect, test } from 'bun:test';
import { qualifyArchive, tarEntry } from '../../../scripts/qualify-bun-archive';

test('ustar fixture preserves header identity, checksum and padding', () => {
  const entry = tarEntry('../escape', '0', 'hostile');
  expect(entry.length).toBe(1024);
  expect(entry.subarray(0, 9).toString()).toBe('../escape');
  expect(entry.subarray(257, 262).toString()).toBe('ustar');
  const sum = parseInt(entry.subarray(148, 154).toString(), 8);
  const header = Buffer.from(entry.subarray(0, 512)); header.fill(32, 148, 156);
  expect(header.reduce((total, byte) => total + byte, 0)).toBe(sum);
});

test('archive qualification reports metadata and bounded hostile-entry outcomes without changing production', async () => {
  const result = await qualifyArchive();
  expect(result.bunVersion).toBe(Bun.version);
  expect(result.productionExtractor).toBe('external tar (unchanged)');
  for (const [name, mode] of [['file-644', '644'], ['file-600', '600'], ['file-755', '755'], ['empty', '700']]) {
    expect(result.observations[name].reference.mode).toBe(mode);
    expect(result.observations[name].bun).not.toBeNull();
  }
  expect(result.observations.hardlink.reference.nlink).toBe(2);
  for (const name of ['traversal', 'absolute', 'symlink-escape', 'hardlink-escape', 'device', 'overwrite']) {
    const observation = result.observations[name];
    expect(typeof observation.rejected).toBe('boolean');
    expect(observation.escaped).toBe(false);
    expect(observation.outsidePreserved).toBe(true);
    expect(observation.deviceCreated).toBe(false);
  }
}, 15000);
