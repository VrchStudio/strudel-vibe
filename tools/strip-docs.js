#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const inputPath = path.join(repoRoot, 'doc.json');
const outputPath = path.join(repoRoot, 'website', 'public', 'docs.min.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const stripHtml = (value) =>
  value.replace(/<\/?[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');

const stripMarkdown = (value) =>
  stripHtml(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');

const cleanWhitespace = (value) =>
  value
    .replace(/\r?\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, arr) => line.length || (arr[index - 1] && arr[index - 1].length))
    .join('\n')
    .replace(/\s+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

const toPlainText = (value) => cleanWhitespace(stripMarkdown(value));

const coerceType = (type) => {
  if (!type) return undefined;
  if (Array.isArray(type.names)) {
    return cleanWhitespace(type.names.join(' | '));
  }
  if (typeof type === 'string') {
    return cleanWhitespace(type);
  }
  return undefined;
};

const cleanParam = (param) => {
  const result = {};
  if (param.name) result.name = param.name.trim();

  const paramType = coerceType(param.type);
  if (paramType) result.type = paramType;

  if (param.description) {
    const description = toPlainText(param.description);
    if (description) result.description = description;
  }

  return Object.keys(result).length ? result : undefined;
};

const rawDocs = readJson(inputPath);
const docs = Array.isArray(rawDocs.docs) ? rawDocs.docs : [];

const stripped = docs
  .map((doc) => {
    const entry = {};

    if (doc.name) entry.name = doc.name.trim();

    if (doc.description) {
      const description = toPlainText(doc.description);
      if (description) entry.description = description;
    }

    const docType = coerceType(doc.type);
    if (docType) entry.type = docType;

    if (Array.isArray(doc.params)) {
      const parameters = doc.params
        .map((param) => cleanParam(param))
        .filter(Boolean);

      if (parameters.length) entry.parameters = parameters;
    }

    if (Array.isArray(doc.examples)) {
      const examples = doc.examples
        .map((example) => example.trim())
        .filter(Boolean);

      if (examples.length) entry.examples = examples;
    }

    return entry;
  })
  .filter((doc) => Object.keys(doc).length);

const output = { docs: stripped };
const serialized = `${JSON.stringify(output)}\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, serialized, 'utf8');
console.log(`Wrote ${stripped.length} docs to ${path.relative(repoRoot, outputPath)}`);
