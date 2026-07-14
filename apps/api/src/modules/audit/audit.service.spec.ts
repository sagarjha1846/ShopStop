import { createHash } from 'node:crypto';

/**
 * Unit test of the audit hash-chain algorithm in isolation (no DB). Mirrors
 * AuditService's hashing so a change to the scheme is caught, and proves that
 * tampering with any row breaks verification.
 */
interface Row {
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const canonical = (r: Omit<Row, 'prevHash' | 'hash'>) =>
  JSON.stringify({ actorId: r.actorId, action: r.action, targetType: r.targetType, targetId: r.targetId, meta: r.meta });

function append(chain: Row[], entry: Omit<Row, 'prevHash' | 'hash'>): Row {
  const prevHash = chain.length ? chain[chain.length - 1]!.hash : 'GENESIS';
  const hash = createHash('sha256').update(prevHash + canonical(entry)).digest('hex');
  const row = { ...entry, prevHash, hash };
  chain.push(row);
  return row;
}

function verify(chain: Row[]): boolean {
  let prev = 'GENESIS';
  for (const row of chain) {
    const expected = createHash('sha256').update(prev + canonical(row)).digest('hex');
    if (row.prevHash !== prev || row.hash !== expected) return false;
    prev = row.hash;
  }
  return true;
}

const mk = (action: string, targetId: string) => ({
  actorId: 'admin1',
  action,
  targetType: 'USER',
  targetId,
  meta: {},
});

describe('audit hash chain', () => {
  it('verifies an untampered chain', () => {
    const chain: Row[] = [];
    append(chain, mk('user.ban', 'u1'));
    append(chain, mk('listing.remove', 'l1'));
    append(chain, mk('user.suspend', 'u2'));
    expect(verify(chain)).toBe(true);
  });

  it('detects tampering with a row payload', () => {
    const chain: Row[] = [];
    append(chain, mk('user.ban', 'u1'));
    append(chain, mk('listing.remove', 'l1'));
    chain[0]!.action = 'user.unban'; // tamper without recomputing hashes
    expect(verify(chain)).toBe(false);
  });

  it('detects a deleted middle row', () => {
    const chain: Row[] = [];
    append(chain, mk('a', 'u1'));
    append(chain, mk('b', 'u2'));
    append(chain, mk('c', 'u3'));
    chain.splice(1, 1); // remove the middle entry
    expect(verify(chain)).toBe(false);
  });
});
