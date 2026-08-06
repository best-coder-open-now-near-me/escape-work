// Surface entry for relocation that is not walking: shove, pull, swap. The
// flight has no step/distance beats; this resolves exactly one entry at the
// body's final free-point stance and seeds the ordinary travel clock there.
import { seedTravelExposureAtLanding } from './travel-exposure.js';
import { surfaceEffect } from './step-rules.js';

export function resolveSurfaceLanding(v, px, pz, d) {
  const floor = d.floorAt(px, pz);
  seedTravelExposureAtLanding(v.ref, floor);
  const sfx = surfaceEffect(floor);
  if (!sfx) return { died: false, damage: 0, label: null };

  if (sfx.applies === 'gum') {
    if (d.stickGum(px, pz)) {
      d.applyStatus(v.statusTarget, 'gum');
      d.statusFxAt(v.member ? v.body : v.ref, 'gum');
      if (!v.member) d.syncUnitSpeed(v.ref);
    }
  } else if (sfx.applies && d.applyStatus(v.statusTarget, sfx.applies)) {
    d.statusFxAt(v.member ? v.body : v.ref, sfx.applies);
  }

  const damage = v.hazardAt(px, pz);
  if (damage <= 0) return { died: false, damage: 0, label: null };
  if (sfx.bleed) d.applyStatus(v.statusTarget, 'bleed', { duration: sfx.bleed });
  const died = v.hurt(damage);
  d.onDamage?.(damage);
  d.impact(px, pz);
  d.damageText(px, pz, damage, v.dmgColor, died);
  if (died) v.onDeath();
  return {
    died,
    damage,
    label: floor.electrified ? 'LIVE water' : floor.surfaceId || 'hazard',
  };
}
