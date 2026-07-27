'use strict';

/**
 * Component state resolution (current-phase-plan.md § 2c, Phase 6 slice
 * 2 — the review's most load-bearing correction). Two distinct axes,
 * deliberately never conflated:
 *
 *  - Type-level (`SectionDefinition.state`): 'managed'|'extended'|
 *    'registered_custom'. Describes the componentKey itself, shared by
 *    every instance of it across every page of every website.
 *  - Instance-level (a section object's own `state` inside
 *    draftSchema/WebsiteVersion.schema): 'inherited'|'detached'.
 *    'inherited' (the default when the field is absent, so every
 *    pre-slice-2 schema stays valid with no migration) defers to the
 *    type's own state; 'detached' ejects this ONE instance, on this
 *    one page, from generated management — no other instance of the
 *    same componentKey anywhere else is affected.
 *
 * `resolveEffectiveComponentState` is the single place both the
 * generator (§ 2f) and the builder-side authorization check (§ 2d)
 * must go through to answer "what state does this specific section
 * instance actually have" — never re-derive it separately in each
 * place, the same lesson ADR 0007 already established for visibility.
 */

const INSTANCE_STATES = ['inherited', 'detached'];

function resolveEffectiveComponentState(sectionInstance, sectionDefinition) {
  if (sectionInstance?.state === 'detached') return 'detached';
  return sectionDefinition?.state || 'managed';
}

module.exports = { INSTANCE_STATES, resolveEffectiveComponentState };
