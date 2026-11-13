import { describe, expect, it } from 'vitest';
import { chooseServerUrl, normalizeServerAddress } from '../src/net/address.ts';

describe('indirizzo del server', () => {
  it('accetta l\'indirizzo come lo si scrive e lo trasforma in WebSocket', () => {
    expect(normalizeServerAddress('')).toBe('');
    expect(normalizeServerAddress('  gioco.example.com ')).toBe('wss://gioco.example.com');
    expect(normalizeServerAddress('https://gioco.example.com/')).toBe('wss://gioco.example.com');
    expect(normalizeServerAddress('http://192.168.1.10:2567')).toBe('ws://192.168.1.10:2567');
    expect(normalizeServerAddress('192.168.1.10:2567')).toBe('ws://192.168.1.10:2567');
    expect(normalizeServerAddress('localhost:2567')).toBe('ws://localhost:2567');
    expect(normalizeServerAddress('wss://gioco.example.com:8443/blockstrike')).toBe('wss://gioco.example.com:8443/blockstrike');
  });

  it('rifiuta ciò che non è un server', () => {
    expect(normalizeServerAddress('ftp://gioco.example.com')).toBeNull();
    expect(normalizeServerAddress('wss://gioco.example.com/?x=1')).toBeNull();
    expect(normalizeServerAddress('http://')).toBeNull();
    expect(normalizeServerAddress('a b c')).toBeNull();
  });

  it('sceglie: giocatore, poi build, poi la pagina; nell\'app senza indirizzo nessuno', () => {
    const page = { protocol: 'https:', hostname: 'gioco.example.com', host: 'gioco.example.com' };
    expect(chooseServerUrl({ user: 'altro.example.com', configured: 'wss://build', page, dev: false })).toBe('wss://altro.example.com');
    expect(chooseServerUrl({ user: '', configured: 'wss://build', page, dev: false })).toBe('wss://build');
    expect(chooseServerUrl({ user: '', configured: '', page, dev: false })).toBe('wss://gioco.example.com');
    expect(chooseServerUrl({ user: '', configured: '', page: { protocol: 'http:', hostname: 'localhost', host: 'localhost:5173' }, dev: true })).toBe('ws://localhost:2567');
    expect(chooseServerUrl({ user: '', configured: '', page: null, dev: false })).toBeNull();
    // Un indirizzo non valido del giocatore non conta.
    expect(chooseServerUrl({ user: 'ftp://x', configured: 'wss://build', page: null, dev: false })).toBe('wss://build');
  });
});
