'use strict';

const { resolveEffectiveComponentState } = require('../core/websites/componentState');

describe('resolveEffectiveComponentState (unit)', () => {
  test('with no instance state, defers to the SectionDefinition type-level state', () => {
    expect(resolveEffectiveComponentState({}, { state: 'managed' })).toBe('managed');
    expect(resolveEffectiveComponentState({}, { state: 'extended' })).toBe('extended');
    expect(resolveEffectiveComponentState({}, { state: 'registered_custom' })).toBe('registered_custom');
  });

  test('an absent sectionDefinition.state defaults to managed', () => {
    expect(resolveEffectiveComponentState({}, {})).toBe('managed');
  });

  test('instance state "inherited" defers to the type-level state, same as absent', () => {
    expect(resolveEffectiveComponentState({ state: 'inherited' }, { state: 'extended' })).toBe('extended');
  });

  test('instance state "detached" always wins, regardless of the type-level state', () => {
    expect(resolveEffectiveComponentState({ state: 'detached' }, { state: 'managed' })).toBe('detached');
    expect(resolveEffectiveComponentState({ state: 'detached' }, { state: 'extended' })).toBe('detached');
    expect(resolveEffectiveComponentState({ state: 'detached' }, { state: 'registered_custom' })).toBe('detached');
  });

  /**
   * The exact regression the closing review's Critical finding was
   * about: two section instances sharing the SAME SectionDefinition
   * (same componentKey, e.g. two different websites both using the
   * platform "hero" section) must resolve their effective state
   * completely independently — detaching one instance must never make
   * the OTHER instance (or the type itself) read as detached too.
   */
  test('two instances of the same SectionDefinition resolve independently — detaching one never affects the other', () => {
    const heroDefinition = { componentKey: 'hero', state: 'managed' };
    const websiteAHeroInstance = { id: 'a1', componentKey: 'hero', state: 'detached' };
    const websiteBHeroInstance = { id: 'b1', componentKey: 'hero' }; // untouched, no instance state at all

    expect(resolveEffectiveComponentState(websiteAHeroInstance, heroDefinition)).toBe('detached');
    expect(resolveEffectiveComponentState(websiteBHeroInstance, heroDefinition)).toBe('managed');
    // The shared type-level row itself is never mutated by detaching an instance.
    expect(heroDefinition.state).toBe('managed');
  });
});
