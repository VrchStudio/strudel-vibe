/*
transpiler.test.mjs - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/transpiler/test/transpiler.test.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, it, expect } from 'vitest';
import { transpiler } from '../transpiler.mjs';

const simple = { wrapAsync: false, addReturn: false, simpleLocs: true };

describe('transpiler', () => {
  it('wraps double quote string with mini and adds location', () => {
    expect(transpiler('"c3"', simple).output).toEqual("m('c3', 0);");
    expect(transpiler('stack("c3","bd sd")', simple).output).toEqual("stack(m('c3', 6), m('bd sd', 11));");
  });
  it('wraps backtick string with mini and adds location', () => {
    expect(transpiler('`c3`', simple).output).toEqual("m('c3', 0);");
  });
  it('annotates stack identifier arguments for highlighting', () => {
    expect(transpiler('stack(foo)', simple).output).toEqual('stack(withPatternRefLocation(foo, 6, 9));');
  });
  it('annotates arrange section identifiers for highlighting', () => {
    expect(transpiler('arrange([2, foo])', simple).output).toEqual(
      'arrange([\n    2,\n    withPatternRefLocation(foo, 12, 15)\n]);',
    );
  });
  it('adds identifier locations to miniLocations for highlighting', () => {
    const config = { ...simple, emitMiniLocations: true };
    expect(transpiler('stack(foo)', config).miniLocations).toContainEqual([6, 9]);
    expect(transpiler('arrange([2, foo])', config).miniLocations).toContainEqual([12, 15]);
  });
  it('keeps tagged template literal as is', () => {
    expect(transpiler('xxx`c3`', simple).output).toEqual('xxx`c3`;');
  });
  it('supports top level await', () => {
    expect(transpiler("await samples('xxx');", simple).output).toEqual("await samples('xxx');");
  });
  it('adds await to bare samples call', () => {
    expect(transpiler("samples('xxx');", simple).output).toEqual("await samples('xxx');");
  });
  it('infers slider names from const assignments', () => {
    const result = transpiler('const midi1Cutoff = slider(800, 200, 4000, 1); midi1Cutoff', {
      ...simple,
      emitMiniLocations: true,
    });
    expect(result.output).toEqual(
      "const midi1Cutoff = sliderWithID('slider_27', 800, 200, 4000, 1);\nmidi1Cutoff;",
    );
    expect(result.widgets).toContainEqual({
      from: 27,
      to: 30,
      value: '800',
      min: 200,
      max: 4000,
      step: 1,
      name: 'midi1Cutoff',
      bindingName: 'midi1Cutoff',
      type: 'slider',
    });
  });
  it('keeps the original slider call signature for inline sliders', () => {
    const result = transpiler('slider(0.4, 0, 1, 0.01)', { ...simple, emitMiniLocations: true });
    expect(result.output).toEqual("sliderWithID('slider_7', 0.4, 0, 1, 0.01);");
    expect(result.widgets).toContainEqual({
      from: 7,
      to: 10,
      value: '0.4',
      min: 0,
      max: 1,
      step: 0.01,
      type: 'slider',
    });
  });
  it('keeps binding names for const sliders', () => {
    const result = transpiler('const cutoff = slider(0.4, 0, 1); cutoff', {
      ...simple,
      emitMiniLocations: true,
    });
    expect(result.widgets).toContainEqual({
      from: 22,
      to: 25,
      value: '0.4',
      min: 0,
      max: 1,
      step: undefined,
      name: 'cutoff',
      bindingName: 'cutoff',
      type: 'slider',
    });
  });
  /*   it('parses dynamic imports', () => {
    expect(
      transpiler("const { default: foo } = await import('https://bar.com/foo.js');", {
        wrapAsync: false,
        addReturn: false,
      }),
    ).toEqual("const {default: foo} = await import('https://bar.com/foo.js');");
  }); */
  it('collections locations', () => {
    const { miniLocations } = transpiler(`s("bd", "hh oh")`, { ...simple, emitMiniLocations: true });
    expect(miniLocations).toEqual([
      [3, 5],
      [9, 11],
      [12, 14],
    ]);
  });
});
