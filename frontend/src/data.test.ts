import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFavorites,readSavedRoute} from './data';

afterEach(()=>vi.unstubAllGlobals());
function storage(value:string){vi.stubGlobal('localStorage',{getItem:()=>value});}

describe('local user data',()=>{
  it('ignores malformed favorites instead of breaking the app',()=>{
    storage('{broken');expect(readFavorites()).toEqual([]);
    storage(JSON.stringify([{name:'Hospital',lat:-9.6,lon:-35.7},{name:'Invalid',lat:100,lon:0}]));
    expect(readFavorites()).toHaveLength(1);
  });
  it('works when browser storage is blocked',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');}});
    expect(readFavorites()).toEqual([]);expect(readSavedRoute()).toBeNull();
  });
  it('rejects corrupted saved geometry and accepts a valid snapshot',()=>{
    const snapshot={destination:{name:'Hospital',lat:-9.6,lon:-35.7},savedAt:new Date().toISOString(),warnings:[],route:{distance:100,duration:30,geometry:{type:'LineString',coordinates:[[-35.7,-9.6],[-35.71,-9.61]]},steps:[]}};
    storage(JSON.stringify(snapshot));expect(readSavedRoute()?.destination.name).toBe('Hospital');
    snapshot.route.geometry.coordinates[0][0]=200;
    storage(JSON.stringify(snapshot));expect(readSavedRoute()).toBeNull();
  });
});
