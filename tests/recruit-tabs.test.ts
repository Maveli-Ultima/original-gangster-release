import { describe, expect, it } from 'vitest';
import { RECRUIT_TABS, recruitsOnTab, staffHireLabel } from '../src/ui/organizer/recruitTabs';

const people = [{ role: 'hood' }, { role: 'lawyer' }, { role: 'hood' }, { role: 'accountant' }] as const;
const tab = (id: string) => RECRUIT_TABS.find((t) => t.id === id)!;

describe('recruitment tabs', () => {
  it('offers hoods, accountants and lawyers separately, in that order', () => {
    expect(RECRUIT_TABS.map((t) => t.id)).toEqual(['hood', 'accountant', 'lawyer']);
  });

  it('keeps each kind of recruit to its own tab', () => {
    expect(recruitsOnTab(people, 'hood').map((p) => p.role)).toEqual(['hood', 'hood']);
    expect(recruitsOnTab(people, 'accountant').map((p) => p.role)).toEqual(['accountant']);
    expect(recruitsOnTab(people, 'lawyer').map((p) => p.role)).toEqual(['lawyer']);
  });

  it('never strands a recruit of an unexpected role off every tab', () => {
    expect(recruitsOnTab([{ role: 'citizen' }], 'hood')).toHaveLength(1);
  });

  it('tells the player where to find each kind of recruit', () => {
    expect(tab('hood').empty).toMatch(/gym.*pool hall.*docks.*labour exchange/);
    expect(tab('accountant').empty).toMatch(/accountancy firm.*bank/);
    expect(tab('lawyer').empty).toMatch(/law office.*courthouse/);
  });
});

describe('staff hire button', () => {
  it('names the post when it is empty', () => {
    expect(staffHireLabel('lawyer', undefined)).toBe('Hire as lawyer');
    expect(staffHireLabel('accountant', undefined)).toBe('Hire as accountant');
  });

  it('names who gets replaced when the post is filled', () => {
    expect(staffHireLabel('lawyer', 'Joe Kane')).toBe('Replace Joe Kane as lawyer');
    expect(staffHireLabel('accountant', 'Ada Bell')).toBe('Replace Ada Bell as accountant');
  });
});
