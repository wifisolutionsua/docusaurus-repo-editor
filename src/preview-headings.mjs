const headingType = /^(ATX|Setext)Heading([1-6])$/;
const explicitId = /\s*\{(?:#([^\s}]+)|\/\*\s*#([^\s*}]+)\s*\*\/)\}\s*$/;
const normalize = (text) => text.replace(/[\s\u200b]+/g, ' ').trim();

export function sourceHeadings(parser, source, decodeEntities) {
  const frontMatter = /^---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
  const offset = frontMatter?.[0].length || 0;
  const body = source.slice(offset);
  const headings = [];
  parser.parse(body).iterate({
    enter(node) {
      const match = headingType.exec(node.name);
      if (!match) return;
      const raw = body.slice(node.from, node.to);
      const markup = match[1] === 'ATX'
        ? raw.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '')
        : raw.replace(/\r?\n[ \t]*[=-]+[ \t]*$/, '');
      const id = explicitId.exec(markup);
      const text = markup.replace(explicitId, '')
        .replace(/!?\[([^\]]+)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
        .replace(/<\/?[A-Za-z][^>]*>/g, '')
        .replace(/(\*{1,3}|_{1,3}|`+|~~)(\S(?:.*?\S)?)\1/g, '$2')
        .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^`_{|}~])/g, '$1');
      headings.push({
        level: Number(match[2]),
        text: normalize(decodeEntities(text)),
        id: id?.[1] || id?.[2],
        from: offset + node.from,
      });
      return false;
    },
  });
  return headings;
}

export function matchingSourceHeading(source, rendered, index) {
  const target = rendered[index];
  if (!target) return undefined;
  const byId = target.id && source.find(({id, level}) => id === target.id && level === target.level);
  if (byId) return byId;

  const sameHeading = ({text, level}) => level === target.level && normalize(text) === normalize(target.text);
  const candidates = source.filter(sameHeading);
  if (!candidates.length || candidates.length !== rendered.filter(sameHeading).length) return undefined;
  return candidates[rendered.slice(0, index).filter(sameHeading).length];
}
