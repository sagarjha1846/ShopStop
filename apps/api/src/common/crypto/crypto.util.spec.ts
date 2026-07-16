import { encryptSecret, decryptSecret } from './crypto.util';

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('crypto util (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, KEY)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same', KEY)).not.toEqual(encryptSecret('same', KEY));
  });

  it('fails to decrypt with the wrong key (auth tag)', () => {
    const enc = encryptSecret('secret', KEY);
    const wrong = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
    expect(() => decryptSecret(enc, wrong)).toThrow();
  });

  it('tolerates a short dev key by padding', () => {
    const enc = encryptSecret('x', 'abcd');
    expect(decryptSecret(enc, 'abcd')).toBe('x');
  });
});
