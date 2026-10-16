import { type Mocked, vi } from "vitest"

import type { Language } from "../app/core/i18n/language"
import {
  DEFAULT_EXTRACTION_MODE,
  DEFAULT_SOUND_SIGNAL,
  type PreferencesService,
} from "../app/core/platform/preferences.service"
import type { ExtractionMode, ThresholdsPayload } from "../app/core/sidecar/protocol"

// Faux `PreferencesService` des specs de composants et de services : il garde les valeurs en
// memoire, comme le store et repart des defauts du vrai service. Type contre la vraie classe.

export type PreferencesStub = Mocked<PreferencesService>

interface Preferences {
  extractionMode: ExtractionMode
  soundSignal: boolean
  language: Language | null
  thresholds: ThresholdsPayload | null
  lastDestination: string | null
}

/** `stored` : ce que le store contient deja au montage ; le reste suit les defauts du service. */
export const preferencesStub = (stored: Partial<Preferences> = {}): PreferencesStub => {
  const values: Preferences = {
    extractionMode: DEFAULT_EXTRACTION_MODE,
    soundSignal: DEFAULT_SOUND_SIGNAL,
    language: null,
    thresholds: null,
    lastDestination: null,
    ...stored,
  }

  return {
    readExtractionMode: vi.fn<PreferencesService["readExtractionMode"]>(() =>
      Promise.resolve(values.extractionMode),
    ),
    writeExtractionMode: vi.fn<PreferencesService["writeExtractionMode"]>((value) => {
      values.extractionMode = value

      return Promise.resolve()
    }),
    readSoundSignal: vi.fn<PreferencesService["readSoundSignal"]>(() =>
      Promise.resolve(values.soundSignal),
    ),
    writeSoundSignal: vi.fn<PreferencesService["writeSoundSignal"]>((value) => {
      values.soundSignal = value

      return Promise.resolve()
    }),
    readLanguage: vi.fn<PreferencesService["readLanguage"]>(() => Promise.resolve(values.language)),
    writeLanguage: vi.fn<PreferencesService["writeLanguage"]>((value) => {
      values.language = value

      return Promise.resolve()
    }),
    readThresholds: vi.fn<PreferencesService["readThresholds"]>(() =>
      Promise.resolve(values.thresholds),
    ),
    writeThresholds: vi.fn<PreferencesService["writeThresholds"]>((value) => {
      values.thresholds = value

      return Promise.resolve()
    }),
    readLastDestination: vi.fn<PreferencesService["readLastDestination"]>(() =>
      Promise.resolve(values.lastDestination),
    ),
    writeLastDestination: vi.fn<PreferencesService["writeLastDestination"]>((value) => {
      values.lastDestination = value

      return Promise.resolve()
    }),
  }
}
