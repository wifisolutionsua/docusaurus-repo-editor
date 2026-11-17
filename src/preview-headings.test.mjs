import assert from 'node:assert/strict';
import test from 'node:test';
import {matchingSourceHeading, sourceHeadings} from './preview-headings.mjs';

test('matching duplicate headings uses their occurrence on the page', () => {
  const source = [
    {level: 2, text: 'Setup', from: 10},
    {level: 2, text: 'Setup', from: 60},
  ];
  const rendered = [{level: 2, text: 'Setup'}, {level: 2, text: 'Setup\u200b'}];
  assert.equal(matchingSourceHeading(source, rendered, 1)?.from, 60);
  assert.equal(matchingSourceHeading(source, rendered.slice(0, 1), 0), undefined);
});

test('Docusaurus heading IDs map to the original offset after front matter', () => {
  const frontMatter = '---\ntitle: Start\n---\n';
  const heading = '## **Setup** {/* #configure */}';
  const parser = {
    parse(body) {
      assert.equal(body, heading);
      return {iterate({enter}) { enter({name: 'ATXHeading2', from: 0, to: body.length}); }};
    },
  };
  const source = sourceHeadings(parser, frontMatter + heading, (text) => text);
  assert.deepEqual(source, [{level: 2, text: 'Setup', id: 'configure', from: frontMatter.length}]);
  assert.equal(matchingSourceHeading(source, [{level: 2, text: 'Configure', id: 'configure'}], 0), source[0]);
});
