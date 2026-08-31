import { MASK, scrub } from './scrub';

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin.
 */
describe('scrub', () => {
  it('masque le nom d utilisateur des trois formes de chemin, a toute profondeur', () => {
    const event = {
      message: 'cannot read C:\\Users\\thibaud\\Music\\set.flac',
      extra: {
        posix: '/home/thibaud/Music/set.flac',
        macos: '/Users/thibaud/Music/set.flac',
        tracks: 42,
      },
    };

    const scrubbed = scrub(event as never, {} as never) as unknown as Record<string, unknown>;

    expect(scrubbed['message']).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`);
    expect(scrubbed['extra']).toEqual({
      posix: `/home/${MASK}/Music/set.flac`,
      macos: `/Users/${MASK}/Music/set.flac`,
      tracks: 42,
    });
  });

  it('masque un nom de compte porteur d une espace', () => {
    const event = { message: 'cannot read C:\\Users\\Jean Dupont\\Music\\set.flac' };

    const scrubbed = scrub(event as never, {} as never) as unknown as Record<string, unknown>;

    expect(scrubbed['message']).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`);
  });

  it('masque un nom de compte porteur d une apostrophe', () => {
    const event = { message: "cannot read C:\\Users\\O'Brien\\Music\\set.flac" };

    const scrubbed = scrub(event as never, {} as never) as unknown as Record<string, unknown>;

    expect(scrubbed['message']).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`);
  });

  it('masque la cle d un mapping autant que sa valeur', () => {
    const event = { extra: { 'C:\\Users\\thibaud\\Music': 'locked' } };

    const scrubbed = scrub(event as never, {} as never) as unknown as Record<string, unknown>;

    expect(scrubbed['extra']).toEqual({ [`C:\\Users\\${MASK}\\Music`]: 'locked' });
  });
});
