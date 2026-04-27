import { getLeafLocations } from '@strudel/mini';
import { parse } from 'acorn';
import escodegen from 'escodegen';
import { walk } from 'estree-walker';

let widgetMethods = [];
export function registerWidgetType(type) {
  widgetMethods.push(type);
}

let languages = new Map();
// config = { getLocations: (code: string, offset?: number) => number[][] }
// see mondough.mjs for example use
// the language will kick in when the code contains a template literal of type
// example: mondo`...` will use language of type "mondo"
// TODO: refactor tidal.mjs to use this
export function registerLanguage(type, config) {
  languages.set(type, config);
}

export function transpiler(input, options = {}) {
  const { wrapAsync = false, addReturn = true, emitMiniLocations = true, emitWidgets = true } = options;

  let ast = parse(input, {
    ecmaVersion: 2022,
    allowAwaitOutsideFunction: true,
    locations: true,
  });

  let miniLocations = [];
  const collectMiniLocations = (value, node) => {
    const minilang = languages.get('minilang');
    if (minilang) {
      const code = `[${value}]`;
      const locs = minilang.getLocations(code, node.start);
      miniLocations = miniLocations.concat(locs);
    } else {
      const leafLocs = getLeafLocations(`"${value}"`, node.start, input);
      miniLocations = miniLocations.concat(leafLocs);
    }
  };
  let widgets = [];

  const isIdentifierNamed = (node, name) => node?.type === 'Identifier' && node.name === name;
  const isMemberExpressionNamed = (node, name) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === name;
  const shouldAnnotateStackCall = (callee) => isIdentifierNamed(callee, 'stack') || isMemberExpressionNamed(callee, 'stack');
  const shouldAnnotateArrangeCall = (callee) =>
    isIdentifierNamed(callee, 'arrange') || isMemberExpressionNamed(callee, 'arrange');
  const literalNode = (value) => ({ type: 'Literal', value, raw: String(value) });
  const trackPatternRefLocation = (node) => {
    const start = node?.start;
    const end = node?.end;
    if (typeof start === 'number' && typeof end === 'number') {
      miniLocations = miniLocations.concat([[start, end]]);
    }
  };
  const withPatternRefLocationCall = (expression) => {
    if (!expression || expression.type !== 'Identifier') {
      return expression;
    }
    const { start, end } = expression;
    if (typeof start !== 'number' || typeof end !== 'number') {
      return expression;
    }
    trackPatternRefLocation(expression);
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'withPatternRefLocation' },
      arguments: [
        expression,
        literalNode(start),
        literalNode(end),
      ],
      optional: false,
    };
  };
  const annotateStackArgument = (arg) => {
    if (!arg) {
      return arg;
    }
    if (arg.type === 'SpreadElement') {
      const annotated = withPatternRefLocationCall(arg.argument);
      return annotated === arg.argument ? arg : { ...arg, argument: annotated };
    }
    const annotated = withPatternRefLocationCall(arg);
    return annotated;
  };
  const annotateArrangeSection = (section) => {
    if (!section || section.type !== 'ArrayExpression') {
      return section;
    }
    const elements = section.elements.map((element, index) => {
      if (index === 1) {
        const annotated = withPatternRefLocationCall(element);
        return annotated;
      }
      return element;
    });
    return { ...section, elements };
  };

  walk(ast, {
    enter(node, parent /* , prop, index */) {
      if (isLanguageLiteral(node)) {
        const { name } = node.tag;
        const language = languages.get(name);
        const code = node.quasi.quasis[0].value.raw;
        const offset = node.quasi.start + 1;
        if (emitMiniLocations) {
          const locs = language.getLocations(code, offset);
          miniLocations = miniLocations.concat(locs);
        }
        this.skip();
        return this.replace(languageWithLocation(name, code, offset));
      }
      if (isTemplateLiteral(node, 'tidal')) {
        const raw = node.quasi.quasis[0].value.raw;
        const offset = node.quasi.start + 1;
        if (emitMiniLocations) {
          const stringLocs = collectHaskellMiniLocations(raw, offset);
          miniLocations = miniLocations.concat(stringLocs);
        }
        this.skip();
        return this.replace(tidalWithLocation(raw, offset));
      }
      if (isBackTickString(node, parent)) {
        const { quasis } = node;
        const { raw } = quasis[0].value;
        this.skip();
        emitMiniLocations && collectMiniLocations(raw, node);
        return this.replace(miniWithLocation(raw, node));
      }
      if (isStringWithDoubleQuotes(node)) {
        const { value } = node;
        this.skip();
        emitMiniLocations && collectMiniLocations(value, node);
        return this.replace(miniWithLocation(value, node));
      }
      if (isSliderFunction(node)) {
        const sliderArgs = getSliderArgs(node, parent);
        emitWidgets &&
          sliderArgs &&
          widgets.push({
            from: sliderArgs.valueNode.start,
            to: sliderArgs.valueNode.end,
            value: sliderArgs.valueNode.raw, // don't use value!
            min: sliderArgs.minNode?.value ?? 0,
            max: sliderArgs.maxNode?.value ?? 1,
            step: sliderArgs.stepNode?.value,
            name: sliderArgs.name,
            ...(sliderArgs.bindingName ? { bindingName: sliderArgs.bindingName } : {}),
            type: 'slider',
          });
        if (sliderArgs) {
          return this.replace(sliderWithLocation(node, sliderArgs));
        }
      }
      if (isWidgetMethod(node)) {
        const type = node.callee.property.name;
        const index = widgets.filter((w) => w.type === type).length;
        const widgetConfig = {
          to: node.end,
          index,
          type,
          id: options.id,
        };
        emitWidgets && widgets.push(widgetConfig);
        return this.replace(widgetWithLocation(node, widgetConfig));
      }
      if (isBareSamplesCall(node, parent)) {
        return this.replace(withAwait(node));
      }
      if (isLabelStatement(node)) {
        return this.replace(labelToP(node));
      }
      if (node.type === 'CallExpression') {
        if (shouldAnnotateStackCall(node.callee)) {
          node.arguments = node.arguments.map(annotateStackArgument);
        }
        if (shouldAnnotateArrangeCall(node.callee)) {
          node.arguments = node.arguments.map(annotateArrangeSection);
        }
      }
    },
    leave(node, parent, prop, index) {},
  });

  let { body } = ast;

  if (!body.length) {
    console.warn('empty body -> fallback to silence');
    body.push({
      type: 'ExpressionStatement',
      expression: {
        type: 'Identifier',
        name: 'silence',
      },
    });
  } else if (!body?.[body.length - 1]?.expression) {
    throw new Error('unexpected ast format without body expression');
  }

  // add return to last statement
  if (addReturn) {
    const { expression } = body[body.length - 1];
    body[body.length - 1] = {
      type: 'ReturnStatement',
      argument: expression,
    };
  }
  let output = escodegen.generate(ast);
  if (wrapAsync) {
    output = `(async ()=>{${output}})()`;
  }
  if (!emitMiniLocations) {
    return { output };
  }
  return { output, miniLocations, widgets };
}

function isStringWithDoubleQuotes(node, locations, code) {
  if (node.type !== 'Literal') {
    return false;
  }
  return typeof node.raw === 'string' && node.raw[0] === '"';
}

function isBackTickString(node, parent) {
  return node.type === 'TemplateLiteral' && parent.type !== 'TaggedTemplateExpression';
}

function miniWithLocation(value, node) {
  const { start: fromOffset } = node;

  const minilang = languages.get('minilang');
  let name = 'm';
  if (minilang && minilang.name) {
    name = minilang.name; // name is expected to be exported from the package of the minilang
  }

  return {
    type: 'CallExpression',
    callee: {
      type: 'Identifier',
      name,
    },
    arguments: [
      { type: 'Literal', value },
      { type: 'Literal', value: fromOffset },
    ],
    optional: false,
  };
}

// these functions are connected to @strudel/codemirror -> slider.mjs
// maybe someday there will be pluggable transpiler functions, then move this there
function isSliderFunction(node) {
  return node.type === 'CallExpression' && node.callee.name === 'slider';
}

function isStringLiteral(node) {
  return node?.type === 'Literal' && typeof node.value === 'string';
}

function inferSliderName(parent) {
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return parent.id.name;
  }
  if (parent?.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') {
    return parent.left.name;
  }
  if (parent?.type === 'Property') {
    if (parent.key?.type === 'Identifier') {
      return parent.key.name;
    }
    if (isStringLiteral(parent.key)) {
      return parent.key.value;
    }
  }
}

function inferSliderBindingName(parent) {
  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return parent.id.name;
  }
}

function getSliderArgs(node, parent) {
  const hasExplicitName = isStringLiteral(node.arguments[0]);
  const [nameNode, valueNode, minNode, maxNode, stepNode] = hasExplicitName
    ? node.arguments
    : [undefined, ...node.arguments];
  if (!valueNode) {
    return;
  }
  return {
    name: hasExplicitName ? nameNode.value : inferSliderName(parent),
    bindingName: inferSliderBindingName(parent),
    hasExplicitName,
    valueNode,
    minNode,
    maxNode,
    stepNode,
  };
}

function isWidgetMethod(node) {
  return node.type === 'CallExpression' && widgetMethods.includes(node.callee.property?.name);
}

function sliderWithLocation(node, sliderArgs) {
  const id = 'slider_' + sliderArgs.valueNode.start; // use loc of value arg for id
  // add loc as identifier to first argument
  // the sliderWithID function is assumed to be sliderWithID(id, name?, value, min?, max?)
  const nextArguments = [
    {
      type: 'Literal',
      value: id,
      raw: id,
    },
    {
      type: 'Literal',
      value: sliderArgs.name ?? null,
    },
  ];
  if (sliderArgs.hasExplicitName) {
    nextArguments.push(...node.arguments.slice(1));
  } else {
    nextArguments.push(...node.arguments);
  }
  node.arguments = nextArguments;
  node.callee.name = 'sliderWithID';
  return node;
}

export function getWidgetID(widgetConfig) {
  // the widget id is used as id for the dom element + as key for eventual resources
  // for example, for each scope widget, a new analyser + buffer (large) is created
  // that means, if we use the index index of line position as id, less garbage is generated
  // return `widget_${widgetConfig.to}`; // more gargabe
  //return `widget_${widgetConfig.index}_${widgetConfig.to}`; // also more garbage
  return `${widgetConfig.id || ''}_widget_${widgetConfig.type}_${widgetConfig.index}`; // less garbage
}

function widgetWithLocation(node, widgetConfig) {
  const id = getWidgetID(widgetConfig);
  // add loc as identifier to first argument
  // the sliderWithID function is assumed to be sliderWithID(id, value, min?, max?)
  node.arguments.unshift({
    type: 'Literal',
    value: id,
    raw: id,
  });
  return node;
}

function isBareSamplesCall(node, parent) {
  return node.type === 'CallExpression' && node.callee.name === 'samples' && parent.type !== 'AwaitExpression';
}

function withAwait(node) {
  return {
    type: 'AwaitExpression',
    argument: node,
  };
}

function isLabelStatement(node) {
  return node.type === 'LabeledStatement';
}

// converts label expressions to p calls: "x: y" to "y.p('x')"
// see https://codeberg.org/uzu/strudel/issues/990
function labelToP(node) {
  return {
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: node.body.expression,
        property: {
          type: 'Identifier',
          name: 'p',
        },
      },
      arguments: [
        {
          type: 'Literal',
          value: node.label.name,
          raw: `'${node.label.name}'`,
        },
      ],
    },
  };
}

function isLanguageLiteral(node) {
  return node.type === 'TaggedTemplateExpression' && languages.has(node.tag.name);
}

// tidal highlighting
// this feels kind of stupid, when we also know the location inside the string op (tidal.mjs)
// but maybe it's the only way

function isTemplateLiteral(node, value) {
  return node.type === 'TaggedTemplateExpression' && node.tag.name === value;
}

function collectHaskellMiniLocations(haskellCode, offset) {
  return haskellCode
    .split('')
    .reduce((acc, char, i) => {
      if (char !== '"') {
        return acc;
      }
      if (!acc.length || acc[acc.length - 1].length > 1) {
        acc.push([i + 1]);
      } else {
        acc[acc.length - 1].push(i);
      }
      return acc;
    }, [])
    .map(([start, end]) => {
      const miniString = haskellCode.slice(start, end);
      return getLeafLocations(`"${miniString}"`, offset + start - 1);
    })
    .flat();
}

function tidalWithLocation(value, offset) {
  return {
    type: 'CallExpression',
    callee: {
      type: 'Identifier',
      name: 'tidal',
    },
    arguments: [
      { type: 'Literal', value },
      { type: 'Literal', value: offset },
    ],
    optional: false,
  };
}

function languageWithLocation(name, value, offset) {
  return {
    type: 'CallExpression',
    callee: {
      type: 'Identifier',
      name: name,
    },
    arguments: [
      { type: 'Literal', value },
      { type: 'Literal', value: offset },
    ],
    optional: false,
  };
}
