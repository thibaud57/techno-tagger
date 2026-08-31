import { Injectable } from '@angular/core';

/**
 * Frontiere unique entre la webview et le metier. Detient l'etat du run et la
 * file d'arbitrage : les composants lisent et emettent, ils ne calculent rien.
 */
@Injectable({ providedIn: 'root' })
export class SidecarService {
  // TODO: implement, Command.sidecar('binaries/tagger') puis spawn(), abonnement a
  // command.stdout, etat du run et file d'arbitrage portes par des signals.
}
