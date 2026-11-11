import {describe,it,expect} from 'vitest';
import {distance,project} from './navigation';
describe('navigation geometry',()=>{it('measures distance in metres',()=>{expect(distance({lat:0,lon:0},{lat:0,lon:.001})).toBeCloseTo(111.195,1);});it('projects onto route segments, not just vertices',()=>{const p=project({lat:0,lon:.005},[[0,0],[.01,0]]);expect(p.progress).toBeCloseTo(.5);expect(p.offset).toBeLessThan(1);});it('detects deviation',()=>{expect(project({lat:.01,lon:.005},[[0,0],[.01,0]]).offset).toBeGreaterThan(1000);});});
