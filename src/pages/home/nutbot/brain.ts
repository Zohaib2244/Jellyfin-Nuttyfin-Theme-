/**
 * NutBot's brain interface. Today a scripted local brain answers (local.ts); later the helper service's LLM
 * plugs in behind the same `ask`. The chat UI only knows this file.
 */
import type { SeerrResult, Title } from '../../../api/types';

/** Something NutBot suggests: a library item (Play) or something Seerr could fetch (Request). */
export type Pick =
  | { kind: 'library'; title: Title; why: string }
  | { kind: 'request'; result: SeerrResult; why: string };

export interface NutAnswer {
  /** plain-language sentence(s) shown in the speech bubble */
  reply: string;
  picks: Pick[];
  /** follow-up chips the UI may offer ("Shorter", "Something else") */
  quick?: string[];
}

export interface NutBrain {
  ask(text: string): Promise<NutAnswer>;
}
