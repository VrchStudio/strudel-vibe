/*
 * Sonic Pink Transparent
 * Transparent variant of the Sonic Pink syntax theme.
 */
import { tags as t } from '@lezer/highlight';
import { createTheme } from './theme-helper.mjs';

const hex = ['#1e1e1e', '#fbde2d', '#ff1493', '#4c83ff', '#ededed', '#cccccc', '#ffffff30', '#dc2f8c'];

export const settings = {
  background: 'transparent',
  lineBackground: 'transparent',
  foreground: hex[4],
  selection: hex[6],
  gutterBackground: 'transparent',
  gutterForeground: hex[5],
  gutterBorder: 'transparent',
  lineHighlight: 'transparent',
};

export default createTheme({
  theme: 'dark',
  settings,
  styles: [
    {
      tag: [t.function(t.variableName), t.function(t.propertyName), t.url, t.processingInstruction],
      color: hex[4],
    },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: hex[3] },

    { tag: t.comment, color: '#54636D' },
    { tag: [t.variableName, t.propertyName, t.labelName], color: hex[4] },
    { tag: [t.attributeName, t.number], color: hex[3] },
    { tag: t.keyword, color: hex[1] },
    { tag: [t.string, t.regexp, t.special(t.propertyName)], color: hex[2] },
  ],
});
