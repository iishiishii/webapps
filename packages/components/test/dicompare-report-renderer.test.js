import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DicompareReportRenderer } from '../src/ui/DicompareReportRenderer.js';

const schema = {
  name: 'QSM Consensus Guidelines',
  version: '1.0',
  description: 'Consensus recommendations for QSM acquisition.\nSecond line is omitted.',
  authors: ['Alice', 'Bob'],
  acquisitions: {
    'GRE multi-echo': {
      tags: ['qsm', 'analysis:phase'],
      detailed_description: '## Protocol\n\nUse **monopolar** readout.\n\n- item one\n- item two',
      fields: [
        { field: 'EchoTime', tag: '(0018,0081)' },
        { field: 'FlipAngle', tag: '(0018,1314)' },
      ],
      rules: [{ name: 'Echo spacing', description: 'Echo spacing is consistent across echoes.', fields: ['EchoTime'] }],
    },
  },
};

const data = {
  schema,
  acquisitions: [{
    name: 'GRE multi-echo',
    acquisitionFields: [
      { keyword: 'EchoTime', tag: '(0018,0081)', value: [4, 8] },
      { keyword: 'Manufacturer', tag: '(0008,0070)', value: 'Siemens <Healthineers>' },
    ],
  }],
  complianceResults: [{
    acquisitionName: 'GRE multi-echo',
    results: [
      { fieldName: 'EchoTime', expectedValue: [4, 8], actualValue: [4, 8], status: 'pass' },
      { fieldName: 'FlipAngle', expectedValue: 15, actualValue: 20, status: 'fail', message: 'Flip angle exceeds guideline.' },
      { fieldName: 'Unknown', status: 'na' },
      { rule_name: 'Echo spacing', status: 'warning', message: 'Only two echoes.' },
    ],
  }],
};

function renderInto(html = '<!doctype html><body><div id="report"></div></body>') {
  const dom = new JSDOM(html);
  const container = dom.window.document.getElementById('report');
  new DicompareReportRenderer().render(container, structuredClone(data));
  return { dom, container };
}

test('render builds the schema header, summary badges, field and rule tables without a global document', () => {
  assert.equal(globalThis.document, undefined);
  const { container } = renderInto();

  assert.equal(container.querySelector('.dicompare-schema-header h4').textContent, 'QSM Consensus Guidelines v1.0');
  assert.equal(container.querySelector('.dicompare-schema-header p').textContent, 'Consensus recommendations for QSM acquisition.');
  assert.equal(container.querySelector('.dicompare-schema-authors').textContent, 'Authors: Alice, Bob');

  const badges = [...container.querySelectorAll('.dicompare-summary-badge')].map((el) => el.textContent);
  assert.deepEqual(badges, ['1 Passed', '1 Failed', '1 Warning', '1 N/A']);

  const labels = [...container.querySelectorAll('.dicompare-section-label')].map((el) => el.textContent);
  assert.deepEqual(labels, ['Field Checks', 'Validation Rules']);

  const fieldRows = container.querySelectorAll('.dicompare-table')[0].querySelectorAll('tbody tr');
  assert.equal(fieldRows.length, 3);
  assert.equal(fieldRows[0].querySelector('.dicompare-field-tag').textContent, '((0018,0081))');
  assert.deepEqual([...fieldRows[0].querySelectorAll('td')].slice(1, 3).map((td) => td.textContent), ['4, 8', '4, 8']);
  assert.equal(fieldRows[1].querySelector('.dicompare-status').textContent, 'Fail');
  assert.equal(fieldRows[1].querySelector('.dicompare-status-message').textContent, 'Flip angle exceeds guideline.');
  assert.equal(fieldRows[2].querySelector('.dicompare-status').textContent, 'N/A');
  assert.equal(fieldRows[2].querySelectorAll('td')[1].textContent, '—');

  const ruleRow = container.querySelectorAll('.dicompare-table')[1].querySelector('tbody tr');
  assert.equal(ruleRow.querySelector('.dicompare-rule-description').textContent, 'Echo spacing is consistent across echoes.');
  assert.equal(ruleRow.querySelector('.dicompare-status').textContent, 'Warning');
});

test('unchecked fields are listed behind a toggle and only include fields outside the schema', () => {
  const { container } = renderInto();
  const toggle = container.querySelector('.dicompare-unchecked-toggle');
  const content = container.querySelector('.dicompare-unchecked-content');
  assert.match(toggle.textContent, /^1 field in data not validated by schema/);
  assert.equal(content.style.display, 'none');
  const row = content.querySelector('tbody tr');
  assert.equal(row.querySelector('.dicompare-field-name').textContent, 'Manufacturer');
  assert.equal(row.querySelectorAll('td')[1].textContent, 'Siemens <Healthineers>');
  toggle.click();
  assert.equal(content.style.display, '');
  toggle.click();
  assert.equal(content.style.display, 'none');
});

test('render replaces previous content and reports empty acquisitions', () => {
  const { container } = renderInto();
  new DicompareReportRenderer().render(container, { acquisitions: [], complianceResults: [], schema });
  assert.equal(container.children.length, 1);
  assert.equal(container.querySelector('.dicompare-empty').textContent, 'No acquisitions found in DICOM files.');
});

test('generatePrintHtml is a standalone escaped document with rules, fields, unchecked fields and README', () => {
  const html = new DicompareReportRenderer().generatePrintHtml(structuredClone(data));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>QSM Consensus Guidelines - dicompare Report<\/title>/);
  assert.match(html, /<span class="badge pass">1 Passed<\/span>/);
  assert.match(html, /<span class="badge warning">1 Warning<\/span>/);
  assert.match(html, /<span class="tag">qsm<\/span><span class="tag tag-analysis">analysis:phase<\/span>/);
  assert.match(html, /<h2>Validation Rules<\/h2>/);
  assert.match(html, /<span class="field-tag-badge">EchoTime<\/span>/);
  assert.match(html, /<td class="fail">Flip angle exceeds guideline\.<\/td>/);
  assert.match(html, /1 field in data not validated by schema/);
  assert.match(html, /Siemens &lt;Healthineers&gt;/);
  assert.doesNotMatch(html, /<Healthineers>/);
  assert.match(html, /<h4 class="readme-h2">Protocol<\/h4>/);
  assert.match(html, /<strong>monopolar<\/strong>/);
  assert.match(html, /<ul><li>item one<\/li><li>item two<\/li><\/ul>/);
});

test('the dicompare embed file is a byte-identical mirror of the shared renderer', async () => {
  const shared = await readFile(new URL('../src/ui/DicompareReportRenderer.js', import.meta.url), 'utf8');
  const embed = await readFile(new URL('../../../apps/dicompare/public/embed/DicompareReportRenderer.js', import.meta.url), 'utf8');
  assert.equal(embed, shared, 'sync apps/dicompare/public/embed/DicompareReportRenderer.js from packages/components/src/ui/');
  assert.doesNotMatch(shared, /^\s*import\s/m, 'the renderer must stay import-free so the embed can be served verbatim');
});
