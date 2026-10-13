// `nativeElement` d'un fixture est un `any` : le typer une fois ici evite un cast dans chaque spec.
export const hostOf = (fixture: { nativeElement: unknown }): HTMLElement =>
  fixture.nativeElement as HTMLElement
