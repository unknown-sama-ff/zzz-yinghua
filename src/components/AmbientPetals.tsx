import type { CSSProperties } from 'react';

const PETALS = [
  { left: '4%', size: '11px', delay: '-5s', duration: '25s', mid: '34px', end: '58px', rotation: '-24deg', opacity: '0.34' },
  { left: '10%', size: '7px', delay: '-17s', duration: '21s', mid: '-24px', end: '-44px', rotation: '18deg', opacity: '0.24' },
  { left: '17%', size: '13px', delay: '-12s', duration: '29s', mid: '42px', end: '20px', rotation: '42deg', opacity: '0.28' },
  { left: '25%', size: '8px', delay: '-23s', duration: '24s', mid: '-34px', end: '-64px', rotation: '-12deg', opacity: '0.2' },
  { left: '32%', size: '10px', delay: '-8s', duration: '27s', mid: '28px', end: '52px', rotation: '26deg', opacity: '0.3' },
  { left: '39%', size: '6px', delay: '-19s', duration: '22s', mid: '-18px', end: '16px', rotation: '56deg', opacity: '0.22' },
  { left: '46%', size: '12px', delay: '-2s', duration: '31s', mid: '36px', end: '-14px', rotation: '-38deg', opacity: '0.26' },
  { left: '53%', size: '8px', delay: '-15s', duration: '23s', mid: '-30px', end: '-54px', rotation: '8deg', opacity: '0.32' },
  { left: '60%', size: '14px', delay: '-26s', duration: '30s', mid: '24px', end: '66px', rotation: '34deg', opacity: '0.25' },
  { left: '67%', size: '7px', delay: '-10s', duration: '20s', mid: '-38px', end: '-18px', rotation: '-50deg', opacity: '0.2' },
  { left: '74%', size: '10px', delay: '-21s', duration: '26s', mid: '30px', end: '48px', rotation: '14deg', opacity: '0.3' },
  { left: '81%', size: '12px', delay: '-6s', duration: '28s', mid: '-28px', end: '-60px', rotation: '66deg', opacity: '0.24' },
  { left: '88%', size: '8px', delay: '-18s', duration: '24s', mid: '40px', end: '18px', rotation: '-18deg', opacity: '0.28' },
  { left: '95%', size: '11px', delay: '-29s', duration: '32s', mid: '-22px', end: '42px', rotation: '38deg', opacity: '0.22' },
  { left: '7%', size: '6px', delay: '-31s', duration: '23s', mid: '20px', end: '-36px', rotation: '-64deg', opacity: '0.18' },
  { left: '22%', size: '9px', delay: '-27s', duration: '27s', mid: '-26px', end: '34px', rotation: '28deg', opacity: '0.23' },
  { left: '57%', size: '7px', delay: '-34s', duration: '25s', mid: '32px', end: '-48px', rotation: '-30deg', opacity: '0.2' },
  { left: '84%', size: '13px', delay: '-14s', duration: '30s', mid: '-32px', end: '12px', rotation: '52deg', opacity: '0.26' },
] as const;

type PetalStyle = CSSProperties & Record<`--${string}`, string>;

export function AmbientPetals() {
  return (
    <div className="ambient-petals" aria-hidden="true">
      {PETALS.map((petal, index) => {
        const style: PetalStyle = {
          '--petal-left': petal.left,
          '--petal-size': petal.size,
          '--petal-delay': petal.delay,
          '--petal-duration': petal.duration,
          '--petal-drift-mid': petal.mid,
          '--petal-drift-end': petal.end,
          '--petal-rotation': petal.rotation,
          '--petal-opacity': petal.opacity,
        };

        return <span className="ambient-petal" key={index} style={style} />;
      })}
    </div>
  );
}
