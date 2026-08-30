import { routes } from './app.routes';

/**
 * L'absence de page 404 est une decision, pas un oubli : un deep-link mort
 * ramene au premier onglet (cf. app.routes.ts).
 */
describe('routes', () => {
  it('redirige la racine et les URLs inconnues vers playlist', () => {
    const root = routes.find((r) => r.path === '');
    const wildcard = routes.find((r) => r.path === '**');

    expect(root?.redirectTo).toBe('playlist');
    expect(wildcard?.redirectTo).toBe('playlist');
    expect(routes.at(-1)?.path).toBe('**');
  });
});
