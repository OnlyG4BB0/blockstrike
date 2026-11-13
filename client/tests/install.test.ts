import { describe, expect, it } from 'vitest';
import { installMessage } from '../src/pwa/install.ts';

describe('installazione come app', () => {
  it('spiega sempre perché si può o non si può installare', () => {
    expect(installMessage('insecure', 'android')).toContain('https');
    expect(installMessage('ready', 'android')).toContain('schermata Home');
    expect(installMessage('manual', 'android')).toContain('Installa app');
    expect(installMessage('manual', 'ios')).toContain('Condividi');
    expect(installMessage('manual', 'desktop')).toContain('barra degli indirizzi');
    expect(installMessage('app', 'android')).toContain('installata');
  });
});
