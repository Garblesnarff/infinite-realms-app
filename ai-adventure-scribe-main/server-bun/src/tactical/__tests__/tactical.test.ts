import { describe, expect, it } from 'vitest';
import { checkLineOfSight, findPath, getAoETargets, getCover, getDistance, getValidMoves, moveEntity } from '../engine';
import { generateMap, validateGeneratedMap } from '../generator';
import { mapToAscii } from '../serialize';
import { buildTacticalDigest } from '../tactical-context';
import type { Cell, TacticalMap } from '../types';

const floor = (): Cell => ({ terrain:'floor', blocksMovement:false, blocksSight:false, cover:0, elevation:0 });
const map = (): TacticalMap => ({ id:'m', sessionId:'s', width:8, height:8, cells:Array.from({length:8},()=>Array.from({length:8},floor)), entities:[
  {id:'pc',x:1,y:1,size:'medium',type:'pc',speedFeet:30,movementRemaining:30},
  {id:'monster',x:6,y:1,size:'medium',type:'monster',speedFeet:30,movementRemaining:30},
] , round:1, sceneDescription:'' });

describe('tactical engine', () => {
  it('uses Chebyshev distance and nearest occupied cells', () => { const m=map(); m.entities[1] = {...m.entities[1],x:4,y:4,size:'large'}; expect(getDistance(m.entities[0],m.entities[1])).toBe(15); });
  it('handles walls, diagonal gaps, and lines around corners', () => { const m=map(); m.cells[1][3] = {...floor(),blocksSight:true,blocksMovement:true,terrain:'wall',cover:3}; expect(checkLineOfSight(m,'pc','monster')).toBe(false); m.entities[1].y=3; expect(checkLineOfSight(m,'pc','monster')).toBe(true); m.cells[2][3] = {...floor(),blocksSight:true,blocksMovement:true,terrain:'wall',cover:3}; expect(checkLineOfSight(m,'pc','monster')).toBe(false); });
  it('computes cover from cells and creatures', () => { const m=map(); m.cells[1][3] = {...floor(),cover:2}; expect(getCover(m,'pc','monster')).toBe(2); m.cells[1][3]=floor(); m.entities.push({id:'ally',x:3,y:1,size:'medium',type:'pc',speedFeet:30,movementRemaining:30}); expect(getCover(m,'pc','monster')).toBe(1); });
  it('intersects sphere, cone, line and cube against multi-cell targets', () => { const m=map(); m.entities[1]={...m.entities[1],x:3,y:1,size:'large'}; expect(getAoETargets(m,'sphere',{x:2,y:1},{radiusFeet:5}).map(x=>x.id)).toContain('monster'); expect(getAoETargets(m,'cone',{x:1,y:1},{lengthFeet:20,direction:{x:1,y:1}}).map(x=>x.id)).toContain('monster'); expect(getAoETargets(m,'line',{x:1,y:1},{lengthFeet:20,widthFeet:5,direction:{x:1,y:0}}).map(x=>x.id)).toContain('monster'); expect(getAoETargets(m,'cube',{x:2,y:1},{sizeFeet:10}).map(x=>x.id)).toContain('monster'); });
  it('charges difficult terrain, refuses insufficient movement, and flood-fill agrees', () => { const m=map(); m.cells[1][2]={...floor(),terrain:'difficult'}; for (const y of [0,2]) for (let x=1;x<=4;x++) m.cells[y][x]={...floor(),terrain:'wall',blocksMovement:true,blocksSight:true,cover:3}; const path=findPath(m,'pc',4,1)!; expect(path.costFeet).toBe(20); m.entities[0].movementRemaining=15; expect(moveEntity(m,'pc',4,1)).toMatchObject({success:false,reason:'insufficient_movement',needsFeet:20,hasFeet:15}); expect(getValidMoves(m,'pc').some(p=>p.x===4&&p.y===1)).toBe(false); });
  it('does not let a large creature cross a one-cell corridor', () => { const m=map(); m.entities[0]={...m.entities[0],size:'large',x:1,y:3}; for(let y=0;y<8;y++) for(let x=0;x<8;x++) if (y!==3) m.cells[y][x]={...floor(),terrain:'wall',blocksMovement:true,blocksSight:true,cover:3}; expect(findPath(m,'pc',5,3)).toBeNull(); });
});

describe('serialization and generator', () => {
  it('is seeded, connected, and keeps ASCII/digest compact', () => { const spec={environment:'cave' as const,size:'medium' as const,seed:42}; const a=generateMap(spec), b=generateMap(spec); expect(a.cells).toEqual(b.cells); const v=validateGeneratedMap(a); expect(v.connected).toBe(true); expect(v.tacticalElements).toBeGreaterThanOrEqual(2); expect(v.entitiesValid).toBe(true); const ascii=mapToAscii(a); expect(ascii.split(/\s+/).length).toBeLessThanOrEqual(300); expect(buildTacticalDigest(a)).toContain('vs['); });
  it('generates each environment without putting entities on blocking cells', () => { for (const environment of ['dungeon_room','cave','tavern','forest_clearing','road','ruins','ship_deck','open_field','corridor'] as const) { const result=validateGeneratedMap(generateMap({environment,seed:3})); expect(result.entitiesValid).toBe(true); expect(result.connected).toBe(true); } });
});
