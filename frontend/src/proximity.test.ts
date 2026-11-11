import {describe,expect,it} from 'vitest';
import {nearestPlaces,shouldRefreshReference} from './proximity';
import {isInMaceio} from './region';

describe('Maceió and proximity',()=>{
  it('keeps Maceió neighbourhoods and rejects São Paulo',()=>{
    expect(isInMaceio({lat:-9.6498,lon:-35.7089})).toBe(true);
    expect(isInMaceio({lat:-9.663,lon:-35.699})).toBe(true);
    expect(isInMaceio({lat:-23.5505,lon:-46.6333})).toBe(false);
  });
  it('ranks the hospital at the origin first and skips invalid coordinates',()=>{
    const point={lat:-9.65,lon:-35.72};
    const places=[{name:'Mais longe',lat:-9.67,lon:-35.72},{name:'Na origem',...point},{name:'Sem coordenadas',lat:0,lon:0,routable:false},{name:'Próximo',lat:-9.651,lon:-35.72}];
    expect(nearestPlaces(point,places).map(p=>p.name)).toEqual(['Na origem','Próximo','Mais longe']);
  });
  it('updates a manually changed origin immediately and limits repeated GPS searches',()=>{
    const point={lat:-9.65,lon:-35.72};
    expect(shouldRefreshReference(null,point,true,0)).toBe(true);
    expect(shouldRefreshReference(point,{...point,lat:-9.652},true,1000)).toBe(false);
    expect(shouldRefreshReference(point,{...point,lat:-9.652},true,16000)).toBe(true);
    expect(shouldRefreshReference(point,{...point,lat:-9.651},false,0)).toBe(true);
  });
});
